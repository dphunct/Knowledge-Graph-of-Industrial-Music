import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL(
  "../data/musicbrainz-artist-aliases.json",
  import.meta.url,
);
const api = "https://musicbrainz.org/ws/2";
const pauseMs = 1100;
const graph = JSON.parse(await readFile(graphUrl));
let lastRequestAt = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalize = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const personNodes = () =>
  graph.nodes.filter(
    (node) =>
      node.type === "person" &&
      node.musicbrainz?.entity === "artist" &&
      node.musicbrainz.id,
  );
const degree = (id) =>
  graph.edges.filter((edge) => edge.source === id || edge.target === id).length;

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

function addUnique(items = [], additions = []) {
  const seen = new Set(
    items.map((item) =>
      typeof item === "string" ? normalize(item) : item.url,
    ),
  );
  const result = [...items];
  for (const item of additions) {
    const key = typeof item === "string" ? normalize(item) : item.url;
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function combineEdges(edges) {
  const combined = new Map();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const key = [
      edge.source,
      edge.target,
      edge.type,
      (edge.roles || []).slice().sort().join("|"),
      edge.validFrom || "",
      edge.validTo || "",
    ].join("~");
    const existing = combined.get(key);
    if (existing)
      existing.provenance = addUnique(existing.provenance, edge.provenance);
    else
      combined.set(key, {
        ...edge,
        roles: [...(edge.roles || [])],
        provenance: [...(edge.provenance || [])],
      });
  }
  return [...combined.values()];
}

function isLegalNameAlias(node, label, aliasesByNode) {
  return (aliasesByNode.get(node.id) || []).some(
    (alias) =>
      normalize(alias.name) === normalize(label) &&
      /legal name/i.test(alias.type || ""),
  );
}

function chooseSurvivor(left, right, aliasesByNode) {
  const leftDegree = degree(left.id);
  const rightDegree = degree(right.id);
  if (leftDegree !== rightDegree)
    return {
      node: leftDegree > rightDegree ? left : right,
      reason: "more recorded relationships",
    };
  const leftLegal = isLegalNameAlias(right, left.label, aliasesByNode);
  const rightLegal = isLegalNameAlias(left, right.label, aliasesByNode);
  if (leftLegal !== rightLegal)
    return {
      node: leftLegal ? left : right,
      reason: "documented legal-name alias",
    };
  // MusicBrainz does not label every legal name. When the relationship counts
  // tie, prefer a conventional multi-word name over initials, punctuation, or
  // numeric stage styling; lexical order is only a stable final fallback.
  const nameLikeness = (label) => {
    const words = label.trim().split(/\s+/);
    return (
      words.filter((word) => /^[A-Za-zÀ-ÖØ-öø-ÿ]{2,}$/.test(word)).length * 2 -
      words.filter((word) => /\d|\.|[^A-Za-zÀ-ÖØ-öø-ÿ'-]/.test(word)).length * 2
    );
  };
  const leftLikeness = nameLikeness(left.label);
  const rightLikeness = nameLikeness(right.label);
  if (leftLikeness !== rightLikeness)
    return {
      node: leftLikeness > rightLikeness ? left : right,
      reason: "more real-name-like label after relationship tie",
    };
  return {
    node: left.label.localeCompare(right.label) <= 0 ? left : right,
    reason: "stable label fallback after relationship tie",
  };
}

const aliasesByNode = new Map();
const report = {
  provider: "MusicBrainz with existing exact Wikidata cross-references",
  retrievedAt: new Date().toISOString(),
  pacingMs: pauseMs,
  method:
    "Aliases are read only from each graph person's exact MusicBrainz artist identity. Nodes are merged only when one graph label is an explicitly documented alias of another graph identity, or two existing exact MusicBrainz-to-Wikidata mappings resolve to the same Wikidata identity.",
  artists: [],
  consolidations: [],
};

function consolidate(node, candidate, evidence) {
  if (
    !graph.nodes.includes(node) ||
    !graph.nodes.includes(candidate) ||
    node.id === candidate.id
  )
    return;
  const choice = chooseSurvivor(node, candidate, aliasesByNode);
  const survivor = choice.node;
  const removed = survivor.id === node.id ? candidate : node;
  const removedDegree = degree(removed.id);
  survivor.aliases = addUnique(survivor.aliases, [
    removed.label,
    ...(removed.aliases || []),
  ]);
  survivor.provenance = addUnique(survivor.provenance, removed.provenance);
  survivor.musicbrainz.alternateIds = addUnique(
    survivor.musicbrainz.alternateIds,
    [removed.musicbrainz.id],
  );
  graph.edges = combineEdges(
    graph.edges.map((edge) => ({
      ...edge,
      source: edge.source === removed.id ? survivor.id : edge.source,
      target: edge.target === removed.id ? survivor.id : edge.target,
    })),
  );
  graph.nodes = graph.nodes.filter((item) => item.id !== removed.id);
  report.consolidations.push({
    survivor: {
      id: survivor.id,
      label: survivor.label,
      degree: degree(survivor.id),
    },
    removed: {
      id: removed.id,
      label: removed.label,
      degreeBeforeMerge: removedDegree,
      musicbrainzId: removed.musicbrainz.id,
    },
    ...evidence,
    selectionReason: choice.reason,
  });
}

for (const node of personNodes()) {
  process.stdout.write(`artist aliases: ${node.label}\n`);
  const detail = await request(`/artist/${node.musicbrainz.id}?inc=aliases`);
  const aliases = (detail.aliases || []).filter(
    (alias) => alias.name && normalize(alias.name) !== normalize(node.label),
  );
  aliasesByNode.set(node.id, aliases);
  node.aliases = addUnique(
    node.aliases,
    aliases.map((alias) => alias.name),
  );
  node.provenance = addUnique(node.provenance, [
    {
      title: `MusicBrainz artist aliases: ${node.label}`,
      url: node.musicbrainz.url,
      note: "Aliases imported from this exact MusicBrainz artist identity.",
    },
  ]);
  report.artists.push({
    id: node.id,
    label: node.label,
    musicbrainzId: node.musicbrainz.id,
    aliases: aliases.map(({ name, type, locale, primary }) => ({
      name,
      type: type || null,
      locale: locale || null,
      primary: Boolean(primary),
    })),
  });
}

for (const node of [...personNodes()]) {
  if (!graph.nodes.includes(node)) continue;
  for (const alias of aliasesByNode.get(node.id) || []) {
    const candidate = personNodes().find(
      (other) =>
        other.id !== node.id &&
        normalize(other.label) === normalize(alias.name),
    );
    if (!candidate) continue;
    consolidate(node, candidate, {
      documentedAlias: alias.name,
      aliasType: alias.type || null,
      evidence: "MusicBrainz alias",
    });
  }
}

for (const nodes of Map.groupBy(
  personNodes().filter((node) => node.wikidata?.id),
  (node) => node.wikidata.id,
).values()) {
  while (nodes.length > 1) {
    const candidate = nodes.pop();
    const node = nodes[0];
    consolidate(node, candidate, {
      documentedAlias: null,
      aliasType: null,
      evidence: `Shared exact Wikidata identity ${node.wikidata.id}`,
    });
  }
}

await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Retrieved aliases for ${report.artists.length} people and consolidated ${report.consolidations.length} documented alias identities. Graph now has ${graph.nodes.length} nodes and ${graph.edges.length} edges.`,
);
