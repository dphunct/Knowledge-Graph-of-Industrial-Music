import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL(
  "../data/musicbrainz-project-rosters.json",
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
const slug = (value) =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "person";

async function request(path) {
  const url = `${api}${path}${path.includes("?") ? "&" : "?"}fmt=json`;
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remaining = pauseMs - (Date.now() - lastRequestAt);
    if (remaining > 0) await sleep(remaining);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "IndustrialKnowledgeGraph/0.1 (https://github.com/dphunct/Knowledge-Graph-of-Industrial-Music)",
        },
      });
      lastRequestAt = Date.now();
      if (response.ok) return response.json();
      failure = new Error(`${response.status} ${response.statusText}: ${path}`);
      if (response.status < 500 && response.status !== 429) throw failure;
    } catch (error) {
      failure = error;
    }
    if (attempt < 2) await sleep((attempt + 1) * 2000);
  }
  throw failure;
}

function uniqueId(label, mbid) {
  const existing = new Set(graph.nodes.map((node) => node.id));
  const base = slug(label);
  if (!existing.has(base)) return base;
  const short = `${base}-${mbid.slice(0, 8)}`;
  return short;
}

function source(project, member, relation) {
  const range = [relation.begin, relation.end].filter(Boolean).join(" to ");
  return {
    title: `MusicBrainz: ${project.label}`,
    url: project.musicbrainz.url,
    note: `Lists ${member.name} as a member${range ? ` from ${range}` : ""}.`,
  };
}

const report = {
  provider: "MusicBrainz",
  retrievedAt: new Date().toISOString(),
  pacingMs: pauseMs,
  projects: [],
  skipped: [],
};
for (const project of graph.nodes.filter((node) => node.type === "project")) {
  if (!project.musicbrainz?.id || project.musicbrainz.entity !== "artist") {
    report.skipped.push({
      id: project.id,
      label: project.label,
      reason: "No verified MusicBrainz artist identity",
    });
    continue;
  }
  process.stdout.write(`project: ${project.label}\n`);
  const detail = await request(
    `/artist/${project.musicbrainz.id}?inc=artist-rels`,
  );
  const members = (detail.relations || []).filter(
    (relation) =>
      relation.type === "member of band" &&
      relation.direction === "backward" &&
      relation.artist?.id,
  );
  report.projects.push({
    id: project.id,
    label: project.label,
    musicbrainzId: project.musicbrainz.id,
    members: members.map((relation) => ({
      id: relation.artist.id,
      label: relation.artist.name,
      begin: relation.begin || null,
      end: relation.end || null,
    })),
  });
  for (const relation of members) {
    const member = relation.artist;
    let person = graph.nodes.find(
      (node) =>
        node.musicbrainz?.entity === "artist" &&
        (node.musicbrainz.id === member.id ||
          node.musicbrainz.alternateIds?.includes(member.id)),
    );
    if (!person) {
      person = {
        id: uniqueId(member.name, member.id),
        label: member.name,
        type: "person",
        summary: `Musician documented by MusicBrainz as a member of ${project.label}.`,
        musicbrainz: {
          id: member.id,
          entity: "artist",
          url: `https://musicbrainz.org/artist/${member.id}`,
        },
        provenance: [source(project, member, relation)],
      };
      graph.nodes.push(person);
    }
    const validFrom = year(relation.begin);
    const validTo = year(relation.end);
    const exists = graph.edges.some(
      (edge) =>
        edge.source === person.id &&
        edge.target === project.id &&
        edge.type === "member_of" &&
        edge.validFrom === validFrom &&
        edge.validTo === validTo,
    );
    if (!exists)
      graph.edges.push({
        source: person.id,
        target: project.id,
        type: "member_of",
        roles: [],
        ...(validFrom ? { validFrom } : {}),
        ...(validTo ? { validTo } : {}),
        sourceStatus: "verified",
        provenance: [source(project, member, relation)],
      });
  }
}

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
console.log(
  `Imported ${report.projects.length} project rosters; ${report.skipped.length} project skipped. Graph now has ${graph.nodes.length} nodes and ${graph.edges.length} edges.`,
);
