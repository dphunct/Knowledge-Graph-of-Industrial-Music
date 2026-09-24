import "./style.css";
import graph from "../data/industrial-graph.json";
import { graphMetrics } from "./metrics.js";

const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const graphElement = document.querySelector("#graph");
const detail = document.querySelector("#detail");
const status = document.querySelector("#graph-status");
const search = document.querySelector("#search");
const pathFrom = document.querySelector("#path-from");
const pathTo = document.querySelector("#path-to");
const sizeMetric = document.querySelector("#size-metric");
const metrics = graphMetrics(graph.nodes, graph.edges);
let activeView = "all";
let selectedId = null;
let highlightedPath = [];
let animationFrame;
let layout = new Map();
let redrawGraph = () => {};
let restartSimulation = () => {};
let dimension = "2d";
let focusedEdge = null;

const nodeEdges = (id) => graph.edges.filter((edge) => edge.source === id || edge.target === id);
const labelFor = (id) => byId.get(id).label;

function visibleNodes() {
  const typeForView = { people: "person", projects: "project", releases: "release" };
  return graph.nodes.filter((node) => activeView === "all" || node.type === typeForView[activeView]);
}

function hopDistances(start) {
  const distances = new Map([[start, 0]]); const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of nodeEdges(current)) {
      const next = edge.source === current ? edge.target : edge.source;
      if (!distances.has(next)) { distances.set(next, distances.get(current) + 1); queue.push(next); }
    }
  }
  return distances;
}

function visibleEdges(nodes) {
  const ids = new Set(nodes.map(({ id }) => id));
  const direct = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  if (activeView === "all" || activeView === "releases") return direct;
  const compound = new Map();
  const pivotType = activeView === "people" ? "project" : "person";
  for (const pivot of graph.nodes.filter((node) => node.type === pivotType)) {
    const members = graph.edges.filter((edge) => edge.target === pivot.id || edge.source === pivot.id).map((edge) => edge.source === pivot.id ? edge.target : edge.source).filter((id) => ids.has(id));
    for (let left = 0; left < members.length; left += 1) for (let right = left + 1; right < members.length; right += 1) compound.set([members[left], members[right]].sort().join("|"), { source: members[left], target: members[right], type: "compound" });
  }
  return [...compound.values()];
}

function edgeContext(edge) {
  const ids = new Set([edge.source, edge.target]);
  const sourceNeighbors = new Set(nodeEdges(edge.source).map((item) => item.source === edge.source ? item.target : item.source));
  const targetNeighbors = new Set(nodeEdges(edge.target).map((item) => item.source === edge.target ? item.target : item.source));
  const shared = [...sourceNeighbors].filter((id) => targetNeighbors.has(id));
  for (const id of shared) ids.add(id);
  for (const item of graph.edges) {
    if (item.source === edge.source || item.target === edge.source || item.source === edge.target || item.target === edge.target) {
      ids.add(item.source); ids.add(item.target);
    }
  }
  return { ids, shared };
}

function renderGraph() {
  const term = search.value.trim().toLowerCase();
  let nodes = visibleNodes().filter((node) => !term || `${node.label} ${(node.aliases || []).join(" ")}`.toLowerCase().includes(term));
  const context = focusedEdge ? edgeContext(focusedEdge) : null;
  if (context) nodes = graph.nodes.filter((node) => context.ids.has(node.id));
  const visibleIds = new Set(nodes.map(({ id }) => id));
  const width = graphElement.clientWidth || 760;
  const height = graphElement.clientHeight || 450;
  const nodeRadius = 62;
  cancelAnimationFrame(animationFrame);
  layout = new Map(nodes.map((node, index) => {
    const angle = index * 2.399963229728653;
    const radius = Math.min(width, height) * (0.2 + (index % 4) * 0.075);
    return [node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius, z: Math.sin(angle * 1.7) * 90, vx: 0, vy: 0, pinned: false }];
  }));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("edges");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");
  const edges = context ? graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)) : visibleEdges(nodes);
  const distances = selectedId ? hopDistances(selectedId) : new Map();
  const lines = edges.map((edge) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add(highlightedPath.includes(edge.source) && highlightedPath.includes(edge.target) ? "highlighted" : "edge");
    line.style.pointerEvents = "stroke";
    line.addEventListener("click", (event) => { event.stopPropagation(); showEdge(edge); });
    svg.append(line);
    return { edge, line };
  });
  const buttons = new Map(nodes.map((node) => {
    const button = document.createElement("button");
    button.type = "button";
    const distance = distances.get(node.id);
    button.className = `node ${node.type} ${selectedId === node.id ? "selected" : ""}`;
    if (selectedId) {
      const opacity = distance === undefined || distance > 4 ? .16 : distance <= 1 ? 1 : 1 - (distance - 1) * .25;
      button.style.opacity = `${opacity}`;
    }
    button.setAttribute("role", "listitem");
    button.innerHTML = `<span>${node.label}</span><small>${node.type}${node.relevance ? ` · ${node.relevance}` : ""}</small>`;
    button.style.width = `${80 + metrics.get(node.id)[sizeMetric.value] * 48}px`;
    button.addEventListener("click", () => selectNode(node.id));
    button.addEventListener("pointerdown", (event) => beginDrag(event, node.id, nodeRadius, width, height));
    return [node.id, button];
  }));
  graphElement.replaceChildren(svg, ...buttons.values());
  graphElement.onclick = (event) => { if (event.target === graphElement || event.target === svg) resetSelection(); };
  graphElement.classList.toggle("three-d", dimension === "3d");
  status.textContent = context
    ? `Edge context · ${nodes.length} nodes · ${edges.length} recorded relationships · click the canvas to return`
    : `${nodes.length} visible nodes · ${edges.length} visible relationships · drag nodes to explore`;

  redrawGraph = () => {
    for (const { edge, line } of lines) {
      const source = layout.get(edge.source);
      const target = layout.get(edge.target);
      line.setAttribute("x1", source.x); line.setAttribute("y1", source.y);
      line.setAttribute("x2", target.x); line.setAttribute("y2", target.y);
    }
    for (const [id, button] of buttons) {
      const point = layout.get(id);
      button.style.left = `${point.x}px`;
      button.style.top = `${point.y}px`;
      button.style.transform = dimension === "3d" ? `translate(-50%, -50%) translateZ(${point.z}px) scale(${1 + point.z / 700})` : "translate(-50%, -50%)";
    }
  };

  const simulate = (heat = 1) => {
    const points = [...layout.values()];
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const a = points[left]; const b = points[right];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.01;
        const unitX = dx / distance; const unitY = dy / distance;
        const push = (9500 / (distance * distance)) + Math.max(0, nodeRadius * 2 - distance) * 0.15;
        if (!a.pinned) { a.vx -= unitX * push; a.vy -= unitY * push; }
        if (!b.pinned) { b.vx += unitX * push; b.vy += unitY * push; }
      }
    }
    for (const edge of edges) {
      const a = layout.get(edge.source); const b = layout.get(edge.target);
      const dx = b.x - a.x; const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const pull = (distance - 185) * 0.012;
      const unitX = dx / distance; const unitY = dy / distance;
      if (!a.pinned) { a.vx += unitX * pull; a.vy += unitY * pull; }
      if (!b.pinned) { b.vx -= unitX * pull; b.vy -= unitY * pull; }
    }
    for (const point of points) {
      if (point.pinned) continue;
      point.vx += (width / 2 - point.x) * 0.0015;
      point.vy += (height / 2 - point.y) * 0.0015;
      point.vx *= 0.72; point.vy *= 0.72;
      point.x = Math.max(nodeRadius, Math.min(width - nodeRadius, point.x + point.vx * heat));
      point.y = Math.max(nodeRadius, Math.min(height - nodeRadius, point.y + point.vy * heat));
    }
    redrawGraph();
    if (heat > 0.015) animationFrame = requestAnimationFrame(() => simulate(heat * 0.985));
  };
  restartSimulation = () => {
    cancelAnimationFrame(animationFrame);
    simulate(0.45);
  };
  simulate();
}

function showEdge(edge) {
  const related = graph.edges.filter((item) => (item.source === edge.source && item.target === edge.target) || (item.source === edge.target && item.target === edge.source));
  focusedEdge = edge;
  selectedId = null;
  const context = edgeContext(edge);
  const shared = context.shared.length ? `<p><strong>Shared intermediaries</strong> ${context.shared.map(labelFor).join(", ")}</p>` : "";
  detail.innerHTML = `<p class="eyebrow">relationship context</p><h2>${labelFor(edge.source)} ↔ ${labelFor(edge.target)}</h2><p>${related.length ? related.map((item) => `${item.type.replace("_", " ")}${item.roles.length ? ` — ${item.roles.join(", ")}` : ""}`).join("<br />") : "Projected compound relationship in this filtered view."}</p>${shared}<p>The graph now shows the surrounding recorded people, projects, and releases for this connection.</p><button class="return-graph" type="button" data-reset-graph>Return to full graph</button>`;
  detail.querySelector("[data-reset-graph]").addEventListener("click", resetSelection);
  renderGraph();
}

function resetSelection() {
  selectedId = null; highlightedPath = []; focusedEdge = null;
  detail.innerHTML = `<p class="eyebrow">Start exploring</p><h2>Select a node or edge</h2><p>Click a node to inspect its relationships, or an edge to inspect the connection. Click the canvas to reset.</p>`;
  renderGraph();
}

function beginDrag(event, id, nodeRadius, width, height) {
  const point = layout.get(id);
  if (!point) return;
  const button = event.currentTarget;
  button.setPointerCapture(event.pointerId);
  point.pinned = true;
  const move = (moveEvent) => {
    const bounds = graphElement.getBoundingClientRect();
    point.x = Math.max(nodeRadius, Math.min(width - nodeRadius, moveEvent.clientX - bounds.left));
    point.y = Math.max(nodeRadius, Math.min(height - nodeRadius, moveEvent.clientY - bounds.top));
    point.vx = 0; point.vy = 0;
    redrawGraph();
  };
  const release = () => {
    point.pinned = false;
    button.removeEventListener("pointermove", move);
    button.removeEventListener("pointerup", release);
    button.removeEventListener("pointercancel", release);
    restartSimulation();
  };
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}

function selectNode(id) {
  selectedId = id;
  highlightedPath = []; focusedEdge = null;
  const node = byId.get(id);
  const connections = nodeEdges(id);
  const aliases = node.aliases?.length ? `<p><strong>Also known as</strong> ${node.aliases.join(", ")}</p>` : "";
  const related = connections.map((edge) => {
    const other = edge.source === id ? edge.target : edge.source;
    const role = edge.roles.length ? ` — ${edge.roles.join(", ")}` : "";
    return `<li><button type="button" data-node="${other}">${labelFor(other)}</button><span>${edge.type.replace("_", " ")}${role} · ${edge.sourceStatus.replace("-", " ")}</span></li>`;
  }).join("");
  const metric = metrics.get(id); const score = (value) => Math.round(value * 100);
  detail.innerHTML = `<p class="eyebrow">${node.type}${node.relevance ? ` · ${node.relevance} relevance` : ""}</p><h2>${node.label}</h2><p>${node.summary || "No description recorded yet."}</p>${node.years ? `<p><strong>Active</strong> ${node.years}</p>` : ""}${aliases}<h3>Graph influence</h3><p>Composite ${score(metric.composite)} · connections ${score(metric.degree)} · bridge ${score(metric.betweenness)} · PageRank ${score(metric.pageRank)}</p><h3>Known relationships</h3><ul class="relationships">${related || "<li>No relationships recorded.</li>"}</ul>`;
  detail.querySelectorAll("[data-node]").forEach((button) => button.addEventListener("click", () => selectNode(button.dataset.node)));
  renderGraph();
}

function populatePathSelects() {
  for (const node of [...graph.nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    for (const select of [pathFrom, pathTo]) select.add(new Option(node.label, node.id));
  }
  pathFrom.value = "al-jourgensen";
  pathTo.value = "richard-23";
}

function shortestPath(start, target) {
  const queue = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    const current = path.at(-1);
    if (current === target) return path;
    for (const edge of nodeEdges(current)) {
      const next = edge.source === current ? edge.target : edge.source;
      if (!visited.has(next)) { visited.add(next); queue.push([...path, next]); }
    }
  }
  return null;
}

document.querySelector("#path-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const path = shortestPath(pathFrom.value, pathTo.value);
  document.querySelector("#path-result").innerHTML = path
    ? `Browser explanation: <strong>${path.map(labelFor).join(" → ")}</strong>. This is the shortest recorded connection in the local graph; select a node to inspect roles and provenance status.`
    : "No connecting path has been recorded in this seed graph.";
  if (path) {
    highlightedPath = path;
    selectNode(path[0]);
    highlightedPath = path;
    renderGraph();
  }
});
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  activeView = button.dataset.view;
  highlightedPath = [];
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
  renderGraph();
}));
document.querySelectorAll("[data-help]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector("#help-text").textContent = button.dataset.help;
}));
document.querySelector("[data-action='rearrange']").addEventListener("click", renderGraph);
document.querySelector("[data-action='dimension']").addEventListener("click", () => { dimension = dimension === "2d" ? "3d" : "2d"; renderGraph(); });
sizeMetric.addEventListener("change", renderGraph);
search.addEventListener("input", renderGraph);
window.addEventListener("resize", renderGraph);
populatePathSelects();
renderGraph();
