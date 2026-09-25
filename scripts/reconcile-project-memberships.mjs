import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const rosterUrl = new URL("../data/musicbrainz-project-rosters.json", import.meta.url);
const reportUrl = new URL("../data/project-membership-reconciliation.json", import.meta.url);

const graph = JSON.parse(await readFile(graphUrl));
const rosterReport = JSON.parse(await readFile(rosterUrl));
const peopleByMusicBrainzId = new Map(
  graph.nodes
    .filter((node) => node.type === "person" && node.musicbrainz?.id)
    .flatMap((node) => [
      [node.musicbrainz.id, node],
      ...(node.musicbrainz.alternateIds || []).map((id) => [id, node]),
    ]),
);
const projectsById = new Map(
  graph.nodes.filter((node) => node.type === "project").map((node) => [node.id, node]),
);

const year = (value) =>
  value ? Number.parseInt(String(value).slice(0, 4), 10) : undefined;

function membershipSource(project, member) {
  const range = [member.begin, member.end].filter(Boolean).join(" to ");
  return {
    title: `MusicBrainz: ${project.label}`,
    url: project.musicbrainz.url,
    note: `Lists ${member.label} as a member${range ? ` from ${range}` : ""}.`,
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  source: "data/musicbrainz-project-rosters.json",
  scannedMemberships: 0,
  addedMemberships: [],
  citedExistingMemberships: [],
  unresolved: [],
};

for (const roster of rosterReport.projects || []) {
  const project = projectsById.get(roster.id);
  if (!project) {
    result.unresolved.push({ project: roster.label, reason: "Project is not in the graph." });
    continue;
  }

  for (const member of roster.members || []) {
    result.scannedMemberships += 1;
    const person = peopleByMusicBrainzId.get(member.id);
    if (!person) {
      result.unresolved.push({
        project: project.label,
        member: member.label,
        musicbrainzId: member.id,
        reason: "Person is not in the graph.",
      });
      continue;
    }

    const validFrom = year(member.begin);
    const validTo = year(member.end);
    const citation = membershipSource(project, member);
    const existing = graph.edges.find(
      (edge) =>
        edge.source === person.id &&
        edge.target === project.id &&
        edge.type === "member_of" &&
        edge.validFrom === validFrom &&
        edge.validTo === validTo,
    );

    if (existing) {
      existing.provenance ||= [];
      if (!existing.provenance.some((item) => item.url === citation.url)) {
        existing.provenance.push(citation);
        result.citedExistingMemberships.push({ person: person.label, project: project.label });
      }
      existing.sourceStatus = "verified";
      continue;
    }

    graph.edges.push({
      source: person.id,
      target: project.id,
      type: "member_of",
      roles: [],
      ...(validFrom ? { validFrom } : {}),
      ...(validTo ? { validTo } : {}),
      sourceStatus: "verified",
      provenance: [citation],
    });
    result.addedMemberships.push({ person: person.label, project: project.label });
  }
}

result.totals = {
  added: result.addedMemberships.length,
  citedExisting: result.citedExistingMemberships.length,
  unresolved: result.unresolved.length,
  graphRelationships: graph.edges.length,
};

await writeFile(graphUrl, `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(reportUrl, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `Reconciled ${result.scannedMemberships} MusicBrainz roster memberships: ${result.totals.added} added, ${result.totals.citedExisting} cited, ${result.totals.unresolved} unresolved.`,
);
