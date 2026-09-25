import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL(
  "../data/musicbrainz-discographies.json",
  import.meta.url,
);
const api = "https://musicbrainz.org/ws/2";
const pauseMs = 1100;
const pageSize = 100;
const graph = JSON.parse(await readFile(graphUrl));
const requestedOffset = Number(
  process.argv
    .find((argument) => argument.startsWith("--offset="))
    ?.split("=")[1] || 0,
);
const requestedLimit = Number(
  process.argv
    .find((argument) => argument.startsWith("--limit="))
    ?.split("=")[1] || Infinity,
);
let lastRequestAt = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const year = (value) =>
  value ? Number.parseInt(value.slice(0, 4), 10) : undefined;
const slug = (value) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "release";
const matchesArtist = (node, id) =>
  node.musicbrainz?.entity === "artist" &&
  (node.musicbrainz.id === id || node.musicbrainz.alternateIds?.includes(id));

async function request(path) {
  const remaining = pauseMs - (Date.now() - lastRequestAt);
  if (remaining > 0) await sleep(remaining);
  const response = await fetch(
    `${api}${path}${path.includes("?") ? "&" : "?"}fmt=json`,
    {
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        "User-Agent":
          "IndustrialKnowledgeGraph/0.1 (https://github.com/dphunct/Knowledge-Graph-of-Industrial-Music)",
      },
    },
  );
  lastRequestAt = Date.now();
  if (!response.ok)
    throw new Error(
      `MusicBrainz returned ${response.status} ${response.statusText}: ${path}`,
    );
  return response.json();
}

function uniqueId(label, mbid) {
  const existing = new Set(graph.nodes.map((node) => node.id));
  const base = slug(label);
  return existing.has(base) ? `${base}-${mbid.slice(0, 8)}` : base;
}

function source(release, artist) {
  return {
    title: `MusicBrainz release group: ${release.title}`,
    url: `https://musicbrainz.org/release-group/${release.id}`,
    note: `The release-group artist credit includes ${artist.name}.`,
  };
}

function addSource(edge, item) {
  edge.provenance ||= [];
  if (
    !edge.provenance.some(
      (sourceItem) =>
        sourceItem.url === item.url && sourceItem.note === item.note,
    )
  )
    edge.provenance.push(item);
}

function addRelease(release) {
  let node = graph.nodes.find(
    (item) =>
      item.musicbrainz?.entity === "release-group" &&
      item.musicbrainz.id === release.id,
  );
  if (node) return node;
  const releaseYear = year(release["first-release-date"]);
  node = {
    id: uniqueId(release.title, release.id),
    label: release.title,
    type: "release",
    summary: `Release group documented by MusicBrainz.`,
    ...(releaseYear ? { validFrom: releaseYear } : {}),
    musicbrainz: {
      id: release.id,
      entity: "release-group",
      url: `https://musicbrainz.org/release-group/${release.id}`,
    },
    provenance: [
      {
        title: `MusicBrainz release group: ${release.title}`,
        url: `https://musicbrainz.org/release-group/${release.id}`,
        note: "Canonical release-group record returned from an exact artist discography query.",
      },
    ],
  };
  graph.nodes.push(node);
  return node;
}

const artists = graph.nodes
  .filter((node) => node.type === "person" || node.type === "project")
  .filter(
    (node) => node.musicbrainz?.entity === "artist" && node.musicbrainz.id,
  )
  .sort((left, right) => left.label.localeCompare(right.label));
const batch = artists.slice(requestedOffset, requestedOffset + requestedLimit);
const report = {
  provider: "MusicBrainz",
  retrievedAt: new Date().toISOString(),
  pacingMs: pauseMs,
  pageSize,
  batch: {
    offset: requestedOffset,
    limit: Number.isFinite(requestedLimit) ? requestedLimit : null,
    totalEligible: artists.length,
  },
  method:
    "Every release group is retrieved by exact MusicBrainz artist identity, with pagination. Only release groups returned for a current person or project are added; each relationship preserves the exact release-group artist credit as provenance.",
  artists: [],
  addedReleases: [],
  addedRelationships: [],
};

for (const artist of batch) {
  process.stdout.write(`discography: ${artist.label}\n`);
  let offset = 0;
  let total = Infinity;
  let releaseCount = 0;
  while (offset < total) {
    const page = await request(
      `/release-group?artist=${artist.musicbrainz.id}&limit=${pageSize}&offset=${offset}&inc=artist-credits`,
    );
    total = page["release-group-count"] || 0;
    const groups = page["release-groups"] || [];
    for (const release of groups) {
      const existed = graph.nodes.some(
        (node) =>
          node.musicbrainz?.entity === "release-group" &&
          node.musicbrainz.id === release.id,
      );
      const releaseNode = addRelease(release);
      if (!existed)
        report.addedReleases.push({
          id: releaseNode.id,
          label: releaseNode.label,
          musicbrainzId: release.id,
          firstReleaseDate: release["first-release-date"] || null,
        });
      for (const credit of release["artist-credit"] || []) {
        const creditedNode = graph.nodes.find((node) =>
          matchesArtist(node, credit.artist?.id),
        );
        if (!creditedNode) continue;
        const validFrom = year(release["first-release-date"]);
        let edge = graph.edges.find(
          (item) =>
            item.source === creditedNode.id &&
            item.target === releaseNode.id &&
            item.type === "released",
        );
        if (!edge) {
          edge = {
            source: creditedNode.id,
            target: releaseNode.id,
            type: "released",
            roles: [],
            ...(validFrom ? { validFrom } : {}),
            sourceStatus: "verified",
            provenance: [],
          };
          graph.edges.push(edge);
          report.addedRelationships.push({
            source: creditedNode.id,
            target: releaseNode.id,
            releaseGroupId: release.id,
          });
        } else if (!edge.validFrom && validFrom) edge.validFrom = validFrom;
        addSource(edge, source(release, credit.artist));
      }
      releaseCount += 1;
    }
    offset += groups.length;
    if (!groups.length) break;
  }
  report.artists.push({
    id: artist.id,
    label: artist.label,
    musicbrainzId: artist.musicbrainz.id,
    releaseGroupCount: releaseCount,
  });
}

await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Imported discographies for ${report.artists.length} people/projects; added ${report.addedReleases.length} release groups and ${report.addedRelationships.length} release relationships. Graph now has ${graph.nodes.length} nodes and ${graph.edges.length} edges.`,
);
