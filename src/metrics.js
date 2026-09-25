// Influence remains a graph calculation, but membership is no longer a flat
// yes/no fact. A documented person → project membership gains strength only
// from recorded tenure and release groups explicitly crediting both identities.
export function graphMetrics(nodes, edges) {
  const ids = nodes.map(({ id }) => id);
  if (!ids.length) return new Map();
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const releaseSets = new Map();
  for (const edge of edges.filter((edge) => edge.type === "released")) {
    if (!releaseSets.has(edge.source)) releaseSets.set(edge.source, new Set());
    releaseSets.get(edge.source).add(edge.target);
  }
  const membershipsByProject = new Map();
  for (const edge of edges.filter(
    (edge) =>
      edge.type === "member_of" &&
      nodeById.get(edge.source)?.type === "person" &&
      nodeById.get(edge.target)?.type === "project",
  )) {
    if (!membershipsByProject.has(edge.target))
      membershipsByProject.set(edge.target, []);
    membershipsByProject.get(edge.target).push(edge);
  }
  const overlapCount = (left = new Set(), right = new Set()) =>
    [...left].filter((id) => right.has(id)).length;
  const membershipWeight = (edge) => {
    const peers = membershipsByProject.get(edge.target) || [];
    const duration =
      edge.validFrom && edge.validTo
        ? Math.max(1, edge.validTo - edge.validFrom + 1)
        : 0;
    const longestTenure = Math.max(
      ...peers.map((item) =>
        item.validFrom && item.validTo
          ? Math.max(1, item.validTo - item.validFrom + 1)
          : 0,
      ),
      0,
    );
    const tenureShare = longestTenure ? duration / longestTenure : 0;
    const projectReleases = releaseSets.get(edge.target) || new Set();
    const releaseShare = projectReleases.size
      ? overlapCount(releaseSets.get(edge.source), projectReleases) /
        projectReleases.size
      : 0;
    // Unknown tenure and no shared direct credit stay at the deliberately low
    // baseline. Membership never implies performance on every project release.
    return 0.2 + 0.5 * tenureShare + 0.3 * releaseShare;
  };
  const links = new Map(ids.map((id) => [id, new Set()]));
  const weightedLinks = new Map(ids.map((id) => [id, new Map()]));
  for (const edge of edges) {
    if (!links.has(edge.source) || !links.has(edge.target)) continue;
    links.get(edge.source).add(edge.target);
    links.get(edge.target).add(edge.source);
    // A release catalog should not outweigh a person's contribution simply
    // because a project has hundreds of editions. Each artist/project's
    // release catalog therefore contributes one total unit, split among its
    // documented release groups; membership strength carries the project-work
    // distinction described above.
    const weight =
      edge.type === "member_of"
        ? membershipWeight(edge)
        : edge.type === "released"
          ? 1 / Math.max(releaseSets.get(edge.source)?.size || 0, 1)
          : Number(edge.weight || 1);
    weightedLinks
      .get(edge.source)
      .set(
        edge.target,
        (weightedLinks.get(edge.source).get(edge.target) || 0) + weight,
      );
    weightedLinks
      .get(edge.target)
      .set(
        edge.source,
        (weightedLinks.get(edge.target).get(edge.source) || 0) + weight,
      );
  }
  const degreeValues = ids.map((id) => links.get(id).size);
  const contributionValues = ids.map((id) =>
    [...weightedLinks.get(id).values()].reduce(
      (sum, weight) => sum + weight,
      0,
    ),
  );
  const maxDegree = Math.max(...degreeValues, 1);
  const maxContribution = Math.max(...contributionValues, 1);
  const rank = ids.map(() => 1 / ids.length);
  for (let step = 0; step < 40; step += 1) {
    const next = ids.map(() => 0.15 / ids.length);
    ids.forEach((id, from) => {
      const outgoing = [...weightedLinks.get(id).values()].reduce(
        (sum, weight) => sum + weight,
        0,
      );
      weightedLinks.get(id).forEach((weight, to) => {
        next[indexById.get(to)] += (0.85 * rank[from] * weight) / outgoing;
      });
    });
    rank.splice(0, rank.length, ...next);
  }
  const maxRank = Math.max(...rank, 1e-9);
  const bridge = ids.map((id) =>
    [...weightedLinks.get(id)].reduce(
      (sum, [neighbor, weight]) =>
        sum + weight * weightedLinks.get(neighbor).size,
      0,
    ),
  );
  const maxBridge = Math.max(...bridge, 1);
  return new Map(
    ids.map((id, index) => {
      const degree = degreeValues[index] / maxDegree;
      const contribution = contributionValues[index] / maxContribution;
      const pageRank = rank[index] / maxRank;
      const betweenness = bridge[index] / maxBridge;
      return [
        id,
        {
          degree,
          contribution,
          pageRank,
          betweenness,
          composite: (contribution + betweenness + pageRank) / 3,
        },
      ];
    }),
  );
}
