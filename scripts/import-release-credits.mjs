import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL(
  "../data/musicbrainz-release-credits.json",
  import.meta.url,
);
const api = "https://musicbrainz.org/ws/2";
const pauseMs = 1100;
const graph = JSON.parse(await readFile(graphUrl));
let lastRequestAt = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const year = (value) =>
  value ? Number.parseInt(value.slice(0, 4), 10) : undefined;

async function request(path) {
  const remaining = pauseMs - (Date.now() - lastRequestAt);
  if (remaining > 0) await sleep(remaining);
  const response = await fetch(
    `${api}${path}${path.includes("?") ? "&" : "?"}fmt=json`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "IndustrialKnowledgeGraph/0.1 (https://github.com/dphunct/Knowledge-Graph-of-Industrial-Music)",
      },
    },
  );
  lastRequestAt = Date.now();
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}: ${path}`);
  return response.json();
}

function provenance(release, artistName) {
  return {
    title: `MusicBrainz: ${release.label}`,
    url: release.musicbrainz.url,
    note: `Release-group artist credit lists ${artistName}.`,
  };
}

const report = {
  provider: "MusicBrainz",
  retrievedAt: new Date().toISOString(),
  pacingMs: pauseMs,
  releases: [],
  skipped: [],
};
for (const release of graph.nodes.filter((node) => node.type === "release")) {
  if (
    !release.musicbrainz?.id ||
    release.musicbrainz.entity !== "release-group"
  ) {
    report.skipped.push({
      id: release.id,
      label: release.label,
      reason: "No verified MusicBrainz release-group identity",
    });
    continue;
  }
  process.stdout.write(`release: ${release.label}\n`);
  const detail = await request(
    `/release-group/${release.musicbrainz.id}?inc=artists+releases`,
  );
  const credited = (detail["artist-credit"] || [])
    .map((credit) => credit.artist)
    .filter(Boolean);
  const validFrom = year(detail["first-release-date"] || release.validFrom);
  const matched = [];
  for (const artist of credited) {
    const node = graph.nodes.find(
      (item) =>
        item.musicbrainz?.entity === "artist" &&
        item.musicbrainz.id === artist.id,
    );
    if (!node) continue;
    matched.push({ id: node.id, label: node.label, musicbrainzId: artist.id });
    const edge = graph.edges.find(
      (item) =>
        item.source === node.id &&
        item.target === release.id &&
        item.type === "released",
    );
    if (edge) {
      if (!edge.validFrom && validFrom) edge.validFrom = validFrom;
      continue;
    }
    graph.edges.push({
      source: node.id,
      target: release.id,
      type: "released",
      roles: [],
      ...(validFrom ? { validFrom } : {}),
      sourceStatus: "verified",
      provenance: [provenance(release, artist.name)],
    });
  }
  report.releases.push({
    id: release.id,
    label: release.label,
    musicbrainzId: release.musicbrainz.id,
    firstReleaseDate: detail["first-release-date"] || null,
    matchedArtists: matched,
    unmatchedArtistCredits: credited
      .filter(
        (artist) => !matched.some((item) => item.musicbrainzId === artist.id),
      )
      .map((artist) => ({ name: artist.name, id: artist.id })),
  });
}

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
console.log(
  `Imported release-group credits for ${report.releases.length} releases; ${report.skipped.length} items skipped. Graph now has ${graph.nodes.length} nodes and ${graph.edges.length} edges.`,
);
