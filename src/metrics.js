// Scores describe documented structural contribution, not artistic quality or
// cultural influence. Durable person ↔ project work is deliberately valued
// above catalog volume; absent dates and credits remain unknown, never zero.
const CURRENT_YEAR = new Date().getFullYear();

const normalize = (values) => {
  const maximum = Math.max(...values, 1);
  return values.map((value) => value / maximum);
};
const knownAverage = (factors) => {
  const known = factors.filter(({ value }) => Number.isFinite(value));
  const weight = known.reduce((sum, factor) => sum + factor.weight, 0);
  return weight
    ? known.reduce((sum, factor) => sum + factor.value * factor.weight, 0) /
        weight
    : 0;
};

export function graphMetrics(nodes, edges) {
  const ids = nodes.map(({ id }) => id);
  if (!ids.length) return new Map();
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const releases = new Map();
  const releaseYears = new Map();
  const membershipsByProject = new Map();
  const membershipsByPerson = new Map();
  const peopleByProject = new Map();
  const peopleByPerson = new Map(ids.map((id) => [id, new Set()]));
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    if (edge.type === "released") {
      if (!releases.has(edge.source)) releases.set(edge.source, new Set());
      releases.get(edge.source).add(edge.target);
      if (edge.validFrom) {
        if (!releaseYears.has(edge.source)) releaseYears.set(edge.source, new Set());
        releaseYears.get(edge.source).add(edge.validFrom);
      }
    }
    if (edge.type === "member_of" && source.type === "person" && target.type === "project") {
      if (!membershipsByProject.has(edge.target)) membershipsByProject.set(edge.target, []);
      if (!membershipsByPerson.has(edge.source)) membershipsByPerson.set(edge.source, []);
      if (!peopleByProject.has(edge.target)) peopleByProject.set(edge.target, new Set());
      membershipsByProject.get(edge.target).push(edge);
      membershipsByPerson.get(edge.source).push(edge);
      peopleByProject.get(edge.target).add(edge.source);
    }
    if (source.type === "person" && target.type === "person") {
      peopleByPerson.get(edge.source).add(edge.target);
      peopleByPerson.get(edge.target).add(edge.source);
    }
  }
  const lifespan = (id) => {
    const project = nodeById.get(id);
    if (project?.type !== "project" || !project.validFrom) return undefined;
    return Math.max(1, (project.validTo || CURRENT_YEAR) - project.validFrom + 1);
  };
  const overlap = (left = new Set(), right = new Set()) =>
    [...left].filter((id) => right.has(id)).length;
  const tenure = (edge) => {
    const project = nodeById.get(edge.target);
    const total = lifespan(edge.target);
    if (!total || !edge.validFrom) return undefined;
    return Math.min(1, Math.max(1, (edge.validTo || project.validTo || CURRENT_YEAR) - edge.validFrom + 1) / total);
  };
  const participation = (edge) => {
    const projectReleases = releases.get(edge.target);
    const personReleases = releases.get(edge.source);
    // A missing direct release credit is incomplete evidence, not proof of no participation.
    if (!projectReleases?.size || !personReleases?.size) return undefined;
    return overlap(personReleases, projectReleases) / projectReleases.size;
  };
  const membershipStrength = (edge) =>
    knownAverage([
      { value: 1, weight: 0.3 },
      { value: tenure(edge), weight: 0.4 },
      { value: participation(edge), weight: 0.3 },
    ]);

  const links = new Map(ids.map((id) => [id, new Set()]));
  const weightedLinks = new Map(ids.map((id) => [id, new Map()]));
  for (const edge of edges) {
    if (!links.has(edge.source) || !links.has(edge.target)) continue;
    links.get(edge.source).add(edge.target);
    links.get(edge.target).add(edge.source);
    const sourceType = nodeById.get(edge.source).type;
    const targetType = nodeById.get(edge.target).type;
    const weight = edge.type === "member_of"
      ? membershipStrength(edge)
      : edge.type === "released"
        // A project catalog contributes a small total unit, divided by releases.
        ? 0.18 / Math.max(releases.get(edge.source)?.size || 0, 1)
        : sourceType === "person" && targetType === "person"
          ? 0.35
          : Number(edge.weight || 0.25);
    for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]])
      weightedLinks.get(from).set(to, (weightedLinks.get(from).get(to) || 0) + weight);
  }
  const degree = ids.map((id) => links.get(id).size);
  const personIds = ids.filter((id) => nodeById.get(id).type === "person");
  const projectIds = ids.filter((id) => nodeById.get(id).type === "project");
  const releaseIds = ids.filter((id) => nodeById.get(id).type === "release");
  const mapFor = (fn) => new Map(ids.map((id) => [id, fn(id)]));
  const degreeById = mapFor((id) => links.get(id).size);
  const projectBreadth = mapFor((id) => membershipsByPerson.get(id)?.length || 0);
  const peopleBreadth = mapFor((id) => peopleByPerson.get(id)?.size || 0);
  const contributorBreadth = mapFor((id) => peopleByProject.get(id)?.size || 0);
  const releaseCount = mapFor((id) => releases.get(id)?.size || 0);
  const lifespanById = mapFor(lifespan);
  const activity = mapFor((id) => {
    const years = [...(releaseYears.get(id) || [])];
    const total = lifespanById.get(id);
    return total && years.length ? (Math.max(...years) - Math.min(...years) + 1) / total : undefined;
  });
  const normalizeMap = (map, scope) => {
    const known = scope.filter((id) => Number.isFinite(map.get(id)));
    const values = normalize(known.map((id) => map.get(id)));
    return new Map(known.map((id, index) => [id, values[index]]));
  };
  const projectBreadthScore = normalizeMap(projectBreadth, personIds);
  const peopleBreadthScore = normalizeMap(peopleBreadth, personIds);
  const lifespanScore = normalizeMap(lifespanById, projectIds);
  const contributorScore = normalizeMap(contributorBreadth, projectIds);
  const releaseScore = normalizeMap(releaseCount, projectIds);
  const activityScore = normalizeMap(activity, projectIds);
  const releaseConnectivityScore = normalizeMap(degreeById, releaseIds);
  const contributionRaw = ids.map((id, index) => {
    const node = nodeById.get(id);
    if (node.type === "person") {
      const memberships = membershipsByPerson.get(id) || [];
      const tenures = memberships.map(tenure).filter(Number.isFinite);
      const credits = memberships.map(participation).filter(Number.isFinite);
      return knownAverage([
        { value: projectBreadthScore.get(id), weight: 0.38 },
        { value: tenures.length ? tenures.reduce((a, b) => a + b, 0) / tenures.length : undefined, weight: 0.27 },
        { value: credits.length ? credits.reduce((a, b) => a + b, 0) / credits.length : undefined, weight: 0.22 },
        { value: peopleBreadthScore.get(id), weight: 0.13 },
      ]);
    }
    if (node.type === "project") {
      const memberships = membershipsByProject.get(id) || [];
      const depth = memberships.map(membershipStrength);
      return knownAverage([
        { value: lifespanScore.get(id), weight: 0.28 },
        { value: contributorScore.get(id), weight: 0.3 },
        { value: releaseScore.get(id), weight: 0.2 },
        { value: activityScore.get(id), weight: 0.15 },
        { value: depth.length ? depth.reduce((a, b) => a + b, 0) / depth.length : undefined, weight: 0.07 },
      ]);
    }
    // Releases retain meaningful variation among themselves, but their maximum
    // contribution remains below that of people and projects.
    return (releaseConnectivityScore.get(id) || 0) * 0.35;
  });
  const maxContribution = Math.max(...contributionRaw, 1);
  const contribution = contributionRaw.map((value) => value / maxContribution);
  const rank = ids.map(() => 1 / ids.length);
  for (let step = 0; step < 40; step += 1) {
    const next = ids.map(() => 0.15 / ids.length);
    ids.forEach((id, from) => {
      const outgoing = [...weightedLinks.get(id).values()].reduce((sum, weight) => sum + weight, 0);
      if (!outgoing) return;
      weightedLinks.get(id).forEach((weight, to) => {
        next[indexById.get(to)] += (0.85 * rank[from] * weight) / outgoing;
      });
    });
    rank.splice(0, rank.length, ...next);
  }
  const bridge = ids.map((id) => [...weightedLinks.get(id)].reduce(
    (sum, [neighbor, weight]) => sum + weight * weightedLinks.get(neighbor).size,
    0,
  ));
  const maxDegree = Math.max(...degree, 1);
  const maxRank = Math.max(...rank, 1e-9);
  const maxBridge = Math.max(...bridge, 1);
  return new Map(ids.map((id, index) => {
    const node = nodeById.get(id);
    const pageRank = rank[index] / maxRank;
    const betweenness = bridge[index] / maxBridge;
    const typeCap = node.type === "release" ? 0.35 : 1;
    return [id, {
      degree: degree[index] / maxDegree,
      contribution: contribution[index],
      pageRank,
      betweenness,
      composite: typeCap * (0.7 * contribution[index] + 0.2 * betweenness + 0.1 * pageRank),
    }];
  }));
}
