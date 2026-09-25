import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL(
  "../data/musicbrainz-industrial-project-discovery.json",
  import.meta.url,
);
const api = "https://musicbrainz.org/ws/2";
const pauseMs = 1100;
const candidateLimit = Number(
  process.argv
    .find((argument) => argument.startsWith("--limit="))
    ?.split("=")[1] || 25,
);
const requestedOffset = Number(
  process.argv
    .find((argument) => argument.startsWith("--offset="))
    ?.split("=")[1] || 0,
);
const graph = JSON.parse(await readFile(graphUrl));
let lastRequestAt = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const slug = (value) =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project";

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

function uniqueId(label, mbid) {
  const existing = new Set(graph.nodes.map((node) => node.id));
  const base = slug(label);
  return existing.has(base) ? `${base}-${mbid.slice(0, 8)}` : base;
}

const search = await request(
  `/artist?query=${encodeURIComponent("tag:industrial AND type:group")}&limit=${candidateLimit}&offset=${requestedOffset}`,
);
const knownIds = new Set(
  graph.nodes.map((node) =>
    node.musicbrainz?.entity === "artist" ? node.musicbrainz.id : null,
  ),
);
const report = {
  provider: "MusicBrainz",
  retrievedAt: new Date().toISOString(),
  pacingMs: pauseMs,
  query: "tag:industrial AND type:group",
  candidateLimit,
  offset: requestedOffset,
  added: [],
  skipped: [],
};

for (const candidate of search.artists || []) {
  if (knownIds.has(candidate.id)) {
    report.skipped.push({
      id: candidate.id,
      label: candidate.name,
      reason: "Already represented",
    });
    continue;
  }
  process.stdout.write(`candidate: ${candidate.name}\n`);
  const detail = await request(`/artist/${candidate.id}?inc=tags`);
  const industrial = (detail.tags || []).find(
    (tag) => tag.name.toLocaleLowerCase() === "industrial",
  );
  if (!industrial) {
    report.skipped.push({
      id: candidate.id,
      label: candidate.name,
      reason: "No explicit industrial tag on canonical artist record",
    });
    continue;
  }
  const project = {
    id: uniqueId(detail.name, detail.id),
    label: detail.name,
    type: "project",
    relevance: "core",
    summary:
      "Industrial project indexed by MusicBrainz; relationships are awaiting separate, cited research.",
    musicbrainz: {
      id: detail.id,
      entity: "artist",
      url: `https://musicbrainz.org/artist/${detail.id}`,
    },
    provenance: [
      {
        title: `MusicBrainz: ${detail.name}`,
        url: `https://musicbrainz.org/artist/${detail.id}`,
        note: "Canonical artist record explicitly carries the industrial tag.",
      },
    ],
  };
  graph.nodes.push(project);
  knownIds.add(detail.id);
  report.added.push({
    id: project.id,
    label: project.label,
    musicbrainzId: detail.id,
    industrialTagCount: industrial.count || null,
  });
}

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
console.log(
  `Added ${report.added.length} industrial projects from ${candidateLimit} searched candidates. Graph now has ${graph.nodes.length} nodes and ${graph.edges.length} edges.`,
);
