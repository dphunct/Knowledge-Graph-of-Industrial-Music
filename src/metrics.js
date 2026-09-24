export function graphMetrics(nodes, edges) {
  const ids = nodes.map(({ id }) => id);
  const links = new Map(ids.map((id) => [id, new Set()]));
  for (const { source, target } of edges) { links.get(source).add(target); links.get(target).add(source); }
  const degreeValues = ids.map((id) => links.get(id).size);
  const maxDegree = Math.max(...degreeValues, 1);
  const rank = ids.map(() => 1 / ids.length);
  for (let step = 0; step < 40; step += 1) {
    const next = ids.map(() => .15 / ids.length);
    ids.forEach((id, from) => links.get(id).forEach((to) => { next[ids.indexOf(to)] += .85 * rank[from] / links.get(id).size; }));
    rank.splice(0, rank.length, ...next);
  }
  const maxRank = Math.max(...rank, 1e-9);
  const bridge = ids.map((id) => [...links.get(id)].reduce((sum, neighbor) => sum + links.get(neighbor).size, 0));
  const maxBridge = Math.max(...bridge, 1);
  return new Map(ids.map((id, index) => {
    const degree = degreeValues[index] / maxDegree;
    const pageRank = rank[index] / maxRank;
    const betweenness = bridge[index] / maxBridge;
    return [id, { degree, pageRank, betweenness, composite: degree * .35 + betweenness * .4 + pageRank * .25 }];
  }));
}
