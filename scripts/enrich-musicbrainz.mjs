import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const outputUrl = new URL("../data/musicbrainz-enrichment.json", import.meta.url);
const api = "https://musicbrainz.org/ws/2";
const pauseMs = 1100;
const limit = 25;
const graph = JSON.parse(await readFile(graphUrl));
const runAt = new Date().toISOString();
const requestedPhase = process.argv.find((argument) => argument.startsWith("--phase="))?.split("=")[1] || "all";
const runKey = process.argv.find((argument) => argument.startsWith("--run="))?.split("=")[1] || runAt;
const applyConfirmedMatches = process.argv.includes("--apply");
let lastRequestAt = 0;

const normalize = (value) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path) {
  const remaining = pauseMs - (Date.now() - lastRequestAt);
  if (remaining > 0) await sleep(remaining);
  const response = await fetch(`${api}${path}${path.includes("?") ? "&" : "?"}fmt=json`, {
    headers: { "Accept": "application/json", "User-Agent": "IndustrialKnowledgeGraph/0.1 (https://github.com/dphunct/Knowledge-Graph-of-Industrial-Music)" }
  });
  lastRequestAt = Date.now();
  if (response.status === 503) { await sleep(5000); return request(path); }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
  return response.json();
}

function ownerFor(node) {
  const direct = graph.edges.find((edge) => edge.target === node.id && graph.nodes.some((item) => item.id === edge.source && item.type === "project"));
  if (direct) return graph.nodes.find((item) => item.id === direct.source)?.label;
  const parent = graph.edges.find((edge) => edge.target === node.id && edge.type === "contains");
  return parent ? ownerFor(graph.nodes.find((item) => item.id === parent.source)) : undefined;
}

function exactCandidate(results, label) {
  return results.find((item) => normalize(item.name || item.title) === normalize(label) && item.score === 100) || null;
}

async function enrich(node) {
  const artist = node.type === "person" || node.type === "project";
  const resource = artist ? "artist" : "release-group";
  const includes = artist ? "aliases+artist-rels+release-groups+url-rels" : "artist-credits+releases+release-group-rels+url-rels";
  if (node.musicbrainz?.entity === resource && node.musicbrainz.id) {
    const detail = await request(`/${resource}/${node.musicbrainz.id}?inc=${includes}`);
    return formatResult(node, resource, node.musicbrainz.id, detail, "confirmed MusicBrainz ID");
  }
  const owner = artist ? "" : ownerFor(node);
  const names = [node.label, ...(node.aliases || [])];
  const field = artist ? "artist" : "releasegroup";
  const query = owner ? `${field}:\"${node.label}\" AND artist:\"${owner}\"` : names.map((name) => `${artist ? "alias" : field}:\"${name}\"`).join(" OR ");
  const search = await request(`/${resource}?query=${encodeURIComponent(query)}&limit=5`);
  const candidates = search[artist ? "artists" : "release-groups"] || [];
  const selected = exactCandidate(candidates, node.label) || (artist && candidates.length === 1 && candidates[0].score === 100 ? candidates[0] : null);
  if (!selected) return { id: node.id, label: node.label, type: node.type, query, selected: null, candidates: candidates.map((item) => ({ id: item.id, label: item.name || item.title, score: item.score, disambiguation: item.disambiguation || "" })) };
  const detail = await request(`/${resource}/${selected.id}?inc=${includes}`);
  return formatResult(node, resource, selected.id, detail, query, candidates);
}

function formatResult(node, resource, id, detail, query, candidates = []) {
  return {
    id: node.id, label: node.label, type: node.type, query,
    selected: { id, resource, url: `https://musicbrainz.org/${resource}/${id}`, label: detail.name || detail.title, disambiguation: detail.disambiguation || "" },
    candidates: candidates.map((item) => ({ id: item.id, label: item.name || item.title, score: item.score, disambiguation: item.disambiguation || "" })),
    relationships: (detail.relations || []).map((relation) => ({ type: relation.type, direction: relation.direction, begin: relation.begin || null, end: relation.end || null, targetType: relation["target-type"], target: relation.artist?.name || relation["release-group"]?.title || relation.url?.resource || "" })),
    releases: (detail["release-groups"] || detail.releases || []).slice(0, limit).map((release) => ({ id: release.id, title: release.title, firstReleaseDate: release["first-release-date"] || release.date || null, primaryType: release["primary-type"] || null })),
    aliases: (detail.aliases || []).map((alias) => alias.name)
  };
}

const people = graph.nodes.filter((node) => node.type === "person");
const projects = graph.nodes.filter((node) => node.type === "project");
const releases = graph.nodes.filter((node) => node.type === "release");
let previous = { provider: "MusicBrainz", runs: [] };
try { previous = JSON.parse(await readFile(outputUrl)); } catch { /* first run */ }
previous.provider = "MusicBrainz";
previous.providerPolicy = { api: "https://musicbrainz.org/ws/2/", pacingMs: pauseMs, maxRecordsPerEntity: limit, mode: "read-only research cache" };
if (applyConfirmedMatches) {
  const completed = previous.runs.filter((item) => item.completedAt).slice(-2);
  if (completed.length < 2) throw new Error("Two completed enrichment runs are required before --apply.");
  const first = new Map(completed[0].results.map((item) => [item.id, item.selected]));
  const second = new Map(completed[1].results.map((item) => [item.id, item.selected]));
  let applied = 0;
  for (const node of graph.nodes) {
    const left = first.get(node.id); const right = second.get(node.id);
    if (!left || !right || left.id !== right.id || left.resource !== right.resource) continue;
    node.musicbrainz = { id: left.id, entity: left.resource, url: left.url, verifiedByRuns: completed.map((item) => item.key) };
    node.provenance = [{ title: `MusicBrainz: ${node.label}`, url: left.url, note: `Exact match confirmed in ${completed.map((item) => item.key).join(" and ")}.` }];
    applied += 1;
  }
  await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`Applied ${applied} exact MusicBrainz entity matches to ${graphUrl.pathname}`);
  process.exit(0);
}
let run = previous.runs.find((item) => item.key === runKey);
if (!run) { run = { key: runKey, startedAt: runAt, scope: { people: people.length, projects: projects.length, releases: releases.length }, phases: [], results: [] }; previous.runs.push(run); }
const phases = [["people", people], ["projects", projects], ["releases", releases]].filter(([name]) => requestedPhase === "all" || requestedPhase === name);
for (const phase of phases) {
  run.phases = [...new Set([...run.phases, phase[0]])];
  for (const node of phase[1]) {
    if (run.results.some((result) => result.id === node.id)) continue;
    process.stdout.write(`${phase[0]}: ${node.label}\n`);
    try { run.results.push({ phase: phase[0], ...(await enrich(node)) }); }
    catch (error) { run.results.push({ phase: phase[0], id: node.id, label: node.label, type: node.type, error: error.message }); }
    run.completedAt = run.phases.length === 3 && run.results.length >= graph.nodes.length ? new Date().toISOString() : null;
    await writeFile(outputUrl, `${JSON.stringify({ ...previous, runs: previous.runs.slice(-2) }, null, 2)}\n`);
  }
}
const resolved = run.results.filter((result) => result.selected).length;
console.log(`Run ${runKey}: ${run.results.length}/${graph.nodes.length} scoped lookups; ${resolved} exact matches. Wrote ${outputUrl.pathname}`);
