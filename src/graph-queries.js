/**
 * Pure graph traversal and filtering helpers.
 *
 * Keeping these functions independent of the DOM makes the map's filtering
 * rules reusable by both renderers and easier to verify in isolation.
 */
export function incidentEdges(edges, id) {
  return edges.filter((edge) => edge.source === id || edge.target === id);
}

// The timeline is cumulative: a relationship remains part of the historical
// record after a documented end date. validTo describes its tenure; it does
// not erase the fact that the connection had been established by that year.
export function isKnownByYear(item, year) {
  return !item.validFrom || Number(item.validFrom) <= year;
}

export function nodesForVisibleTypes(nodes, activeTypes, year) {
  return nodes.filter(
    (node) => activeTypes.has(node.type) && isKnownByYear(node, year),
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
      isKnownByYear(edge, year),
  );

  const connections = new Map(
    directEdges.map((edge) => [[edge.source, edge.target].sort().join("|"), edge]),
  );

  // When a category is hidden, retain its one-hop structural effect without
  // pretending it is a recorded direct fact. Connections are undirected,
  // unique, and never self-links; we only project through one hidden sphere.
  for (const pivot of graph.nodes.filter(
    (node) => !activeTypes.has(node.type) && isKnownByYear(node, year),
  )) {
    const members = incidentEdges(graph.edges, pivot.id)
      .filter((edge) => isKnownByYear(edge, year))
      .map((edge) => (edge.source === pivot.id ? edge.target : edge.source))
      .filter((id) => visibleIds.has(id));

    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        const [source, target] = [members[left], members[right]].sort();
        if (source === target) continue;
        const key = `${source}|${target}`;
        const existing = connections.get(key);
        if (existing?.type === "inferred") existing.via.push(pivot.id);
        else if (!existing)
          connections.set(key, { source, target, type: "inferred", via: [pivot.id] });
      }
    }
  }

  return [...connections.values()];
}
