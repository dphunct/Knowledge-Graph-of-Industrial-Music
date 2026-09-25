import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const rosterUrl = new URL("../data/musicbrainz-project-rosters.json", import.meta.url);
const reportUrl = new URL("../data/project-membership-audit.json", import.meta.url);

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

const report = {
  generatedAt: new Date().toISOString(),
  source: "data/musicbrainz-project-rosters.json",
  scannedMemberships: 0,
  missingMemberships: [],
  unresolvedRosterPeople: [],
  missingProjects: [],
};

for (const roster of rosterReport.projects || []) {
  const project = projectsById.get(roster.id);
  if (!project) {
    report.missingProjects.push({ id: roster.id, label: roster.label });
    continue;
  }
  for (const member of roster.members || []) {
    report.scannedMemberships += 1;
    const person = peopleByMusicBrainzId.get(member.id);
    if (!person) {
      report.unresolvedRosterPeople.push({ project: project.label, member: member.label });
      continue;
    }
    const validFrom = year(member.begin);
    const validTo = year(member.end);
    const present = graph.edges.some(
      (edge) =>
        edge.source === person.id &&
        edge.target === project.id &&
        edge.type === "member_of" &&
        edge.validFrom === validFrom &&
        edge.validTo === validTo,
    );
    if (!present)
      report.missingMemberships.push({ person: person.label, project: project.label });
  }
}

report.totals = {
  missingMemberships: report.missingMemberships.length,
  unresolvedRosterPeople: report.unresolvedRosterPeople.length,
  missingProjects: report.missingProjects.length,
};
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);

if (Object.values(report.totals).some(Boolean)) {
  throw new Error(`MusicBrainz roster consistency check failed: ${JSON.stringify(report.totals)}`);
}
console.log(`MusicBrainz roster consistency check passed for ${report.scannedMemberships} memberships.`);
