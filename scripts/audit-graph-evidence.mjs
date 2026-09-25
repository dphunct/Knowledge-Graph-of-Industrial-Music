import { readFile, writeFile } from "node:fs/promises";

const graphUrl = new URL("../data/industrial-graph.json", import.meta.url);
const reportUrl = new URL("../data/graph-evidence-audit.json", import.meta.url);
const graph = JSON.parse(await readFile(graphUrl));
const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

const relationshipLabel = (edge) => ({
  source: nodesById.get(edge.source)?.label || edge.source,
  target: nodesById.get(edge.target)?.label || edge.target,
  type: edge.type,
  roles: edge.roles
});
const countBy = (items, property) =>
  items.reduce((counts, item) => {
    const key = item[property] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

const relationshipsWithProvenance = graph.edges.filter(
  (edge) => edge.provenance?.length,
);
const uncitedRelationships = graph.edges.filter(
  (edge) => edge.sourceStatus !== "verified" || !edge.provenance?.length,
);
const datedRelationships = graph.edges.filter(
  (edge) => edge.validFrom || edge.validTo,
);

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    nodes: graph.nodes.length,
    relationships: graph.edges.length,
    relationshipsWithProvenance: relationshipsWithProvenance.length,
    citedRelationshipPercentage: Number(
      ((relationshipsWithProvenance.length / graph.edges.length) * 100).toFixed(
        2,
      ),
    ),
    relationshipsWithDates: datedRelationships.length,
    datedRelationshipPercentage: Number(
      ((datedRelationships.length / graph.edges.length) * 100).toFixed(2),
    )
  },
  relationshipTypes: countBy(graph.edges, "type"),
  uncitedRelationships: uncitedRelationships.map(relationshipLabel),
  undatedMemberships: graph.edges
    .filter(
      (edge) =>
        edge.type === "member_of" && !edge.validFrom && !edge.validTo,
    )
    .map(relationshipLabel)
};

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Evidence audit: ${report.totals.relationshipsWithProvenance}/${report.totals.relationships} relationships cited; ${report.uncitedRelationships.length} require research.`,
);
