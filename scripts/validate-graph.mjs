import { readFile } from "node:fs/promises";

const graph = JSON.parse(await readFile(new URL("../data/industrial-graph.json", import.meta.url)));
const ids = new Set();
for (const node of graph.nodes) {
  if (!node.id || !node.label || !node.type) throw new Error(`Invalid node: ${JSON.stringify(node)}`);
  if (node.validFrom && (!Number.isInteger(node.validFrom) || node.validFrom < 1900)) throw new Error(`Invalid temporal node data: ${node.id}`);
  if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
  ids.add(node.id);
}
for (const edge of graph.edges) {
  if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Edge references an unknown node: ${edge.source} → ${edge.target}`);
  if (!Array.isArray(edge.roles) || !edge.sourceStatus) throw new Error(`Edge lacks roles or source status: ${edge.source} → ${edge.target}`);
  if (edge.validFrom && (!Number.isInteger(edge.validFrom) || edge.validFrom < 1900)) throw new Error(`Invalid temporal edge data: ${edge.source} → ${edge.target}`);
}
console.log(`Graph valid: ${graph.nodes.length} nodes, ${graph.edges.length} edges.`);
