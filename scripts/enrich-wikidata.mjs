import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL("../data/wikidata-enrichment.json", import.meta.url);
const api = "https://www.wikidata.org/w/api.php";
const pauseMs = 1100;
const graph = JSON.parse(await readFile(graphUrl));
let lastRequestAt = 0;
const requestedOffset = Number(
  process.argv
    .find((argument) => argument.startsWith("--offset="))
    ?.split("=")[1] || 0,
);
const requestedLimit = Number(
  process.argv
    .find((argument) => argument.startsWith("--limit="))
    ?.split("=")[1] || 20,
);
const missingOnly = process.argv.includes("--missing-only");

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const chunks = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
const normalize = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const claimValues = (entity, property) =>
  (entity.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter(Boolean);

async function request(parameters) {
  const remaining = pauseMs - (Date.now() - lastRequestAt);
  if (remaining > 0) await sleep(remaining);
  const url = new URL(api);
  Object.entries({
    action: "wbsearchentities",
    format: "json",
    language: "en",
    origin: "*",
    ...parameters,
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "User-Agent":
        "IndustrialKnowledgeGraph/0.1 (https://github.com/dphunct/Knowledge-Graph-of-Industrial-Music)",
    },
  });
  lastRequestAt = Date.now();
  if (!response.ok)
    throw new Error(
      `Wikidata API returned ${response.status} ${response.statusText}`,
    );
  return response.json();
}

function addProvenance(node, title, url, note) {
  node.provenance ||= [];
  if (!node.provenance.some((item) => item.url === url))
    node.provenance.push({ title, url, note });
}

const eligibleNodes = graph.nodes.filter(
  (item) => item.musicbrainz?.id && (!missingOnly || !item.wikidata),
);
const batch = eligibleNodes.slice(
  requestedOffset,
  requestedOffset + requestedLimit,
);
const candidates = [];
for (const node of batch) {
  process.stdout.write(`Wikidata candidate: ${node.label}\n`);
  const result = await request({ search: node.label, limit: "8" });
  const match = (result.search || []).find(
    (item) => normalize(item.label || "") === normalize(node.label),
  );
  if (match) candidates.push({ node, qid: match.id });
}

const entities = new Map();
for (const group of chunks(candidates, 40)) {
  const result = await request({
    action: "wbgetentities",
    ids: group.map((item) => item.qid).join("|"),
    props: "claims",
  });
  Object.entries(result.entities || {}).forEach(([id, entity]) =>
    entities.set(id, entity),
  );
}

const mappings = new Map();
const skipped = [];
for (const { node, qid } of candidates) {
  const entity = entities.get(qid);
  const property =
    node.musicbrainz.entity === "release-group" ? "P436" : "P434";
  if (!claimValues(entity, property).includes(node.musicbrainz.id)) {
    skipped.push({
      id: node.id,
      label: node.label,
      candidate: qid,
      reason: `Candidate does not carry the exact ${property} MusicBrainz identifier`,
    });
    continue;
  }
  const url = `https://www.wikidata.org/wiki/${qid}`;
  node.wikidata = { id: qid, url };
  addProvenance(
    node,
    `Wikidata: ${node.label}`,
    url,
    "Cross-reference accepted only after its MusicBrainz identifier exactly matched the graph identity.",
  );
  const discogsArtistId = claimValues(entity, "P1953")[0];
  if (discogsArtistId && node.type !== "release") {
    node.discogs = {
      artistId: discogsArtistId,
      url: `https://www.discogs.com/artist/${discogsArtistId}`,
    };
    addProvenance(
      node,
      `Discogs artist entry: ${node.label}`,
      node.discogs.url,
      "Catalog cross-reference supplied by Wikidata; Discogs content is not imported by this script.",
    );
  }
  mappings.set(qid, { node, entity });
}

const importedRelationships = [];
for (const { node: person, entity } of mappings.values()) {
  if (person.type !== "person") continue;
  for (const projectQid of claimValues(entity, "P463")) {
    const project = mappings.get(projectQid)?.node;
    if (!project || project.type !== "project") continue;
    const exists = graph.edges.some(
      (edge) =>
        edge.source === person.id &&
        edge.target === project.id &&
        edge.type === "member_of",
    );
    if (exists) continue;
    const url = `https://www.wikidata.org/wiki/${person.wikidata.id}`;
    graph.edges.push({
      source: person.id,
      target: project.id,
      type: "member_of",
      roles: [],
      sourceStatus: "verified",
      provenance: [
        {
          title: `Wikidata membership claim: ${person.label} → ${project.label}`,
          url,
          note: "Exact mapped Wikidata entities state that the person is a member of the project.",
        },
      ],
    });
    importedRelationships.push({ person: person.id, project: project.id, url });
  }
}

const report = {
  provider: "Wikidata API",
  retrievedAt: new Date().toISOString(),
  pacingMs: pauseMs,
  batch: {
    offset: requestedOffset,
    limit: requestedLimit,
    missingOnly,
    totalEligible: eligibleNodes.length,
  },
  method:
    "Exact MusicBrainz identifier verification after label search; only exact mapped P463 membership claims are imported.",
  mappedEntities: graph.nodes
    .filter((node) => node.wikidata)
    .map((node) => ({
      id: node.id,
      label: node.label,
      wikidata: node.wikidata,
      discogs: node.discogs || null,
    })),
  importedRelationships: graph.edges
    .filter((edge) =>
      edge.provenance?.some((source) =>
        source.title.startsWith("Wikidata membership claim:"),
      ),
    )
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      provenance: edge.provenance.filter((source) =>
        source.title.startsWith("Wikidata membership claim:"),
      ),
    })),
  skipped,
};

await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Mapped ${mappings.size} exact Wikidata entities and added ${importedRelationships.length} relationships.`,
);
