/**
 * Pure graph traversal and filtering helpers.
 *
 * Keeping these functions independent of the DOM makes the map's filtering
 * rules reusable by both renderers and easier to verify in isolation.
 */
export function incidentEdges(edges, id) {
  return edges.filter((edge) => edge.source === id || edge.target === id);
}

export function isActiveAtYear(item, year) {
  return (
    (!item.validFrom || Number(item.validFrom) <= year) &&
    (!item.validTo || Number(item.validTo) >= year)
  );
}

export function nodesForVisibleTypes(nodes, activeTypes, year) {
  return nodes.filter(
    (node) => activeTypes.has(node.type) && isActiveAtYear(node, year),
  );
}

export function hopDistances(edges, start) {
  const distances = new Map([[start, 0]]);
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    for (const edge of incidentEdges(edges, current)) {
      const next = edge.source === current ? edge.target : edge.source;
      if (!distances.has(next)) {
        distances.set(next, distances.get(current) + 1);
        queue.push(next);
      }
    }
  }

  return distances;
}

export function edgesForVisibleNodes(graph, nodes, activeTypes, year) {
  const visibleIds = new Set(nodes.map(({ id }) => id));
  const directEdges = graph.edges.filter(
    (edge) =>
      visibleIds.has(edge.source) &&
      visibleIds.has(edge.target) &&
      isActiveAtYear(edge, year),
  );

  if (activeTypes.size !== 1 || activeTypes.has("release")) return directEdges;

  const pivotType = activeTypes.has("person") ? "project" : "person";
  const compoundEdges = new Map();
  for (const pivot of graph.nodes.filter((node) => node.type === pivotType)) {
    const members = incidentEdges(graph.edges, pivot.id)
      .filter((edge) => isActiveAtYear(edge, year))
      .map((edge) => (edge.source === pivot.id ? edge.target : edge.source))
      .filter((id) => visibleIds.has(id));

    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        const [source, target] = [members[left], members[right]].sort();
        compoundEdges.set(`${source}|${target}`, {
          source,
          target,
          type: "compound",
        });
      }
    }
  }

  return [...compoundEdges.values()];
}
