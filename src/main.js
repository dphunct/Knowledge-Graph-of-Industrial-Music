import "./style.css";

const graph = await fetch("/data/industrial-graph.json").then((response) => response.json());
const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const graphElement = document.querySelector("#graph");
const detail = document.querySelector("#detail");
const status = document.querySelector("#graph-status");
const search = document.querySelector("#search");
const pathFrom = document.querySelector("#path-from");
const pathTo = document.querySelector("#path-to");
let activeView = "all";
let selectedId = null;
let highlightedPath = [];

const nodeEdges = (id) => graph.edges.filter((edge) => edge.source === id || edge.target === id);
const labelFor = (id) => byId.get(id).label;

function visibleNodes() {
  return graph.nodes.filter((node) => activeView === "all" || (activeView === "people" ? node.type === "person" : node.type === "project"));
}

function nodePositions(nodes) {
  const byType = Object.groupBy(nodes, ({ type }) => type);
  const columns = { person: 180, project: 500, release: 820 };
  const positions = new Map();
  for (const [type, group] of Object.entries(byType)) {
    group.sort((a, b) => a.label.localeCompare(b.label)).forEach((node, index) => {
      positions.set(node.id, { x: columns[type], y: 90 + (index + 1) * (480 / (group.length + 1)) });
    });
  }
  return positions;
}

function renderGraph() {
  const term = search.value.trim().toLowerCase();
  const nodes = visibleNodes().filter((node) => !term || `${node.label} ${(node.aliases || []).join(" ")}`.toLowerCase().includes(term));
  const positions = nodePositions(nodes);
  const visibleIds = new Set(nodes.map(({ id }) => id));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("edges");
  svg.setAttribute("viewBox", "0 0 1000 660");
  svg.setAttribute("aria-hidden", "true");
  graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const isHighlighted = highlightedPath.includes(edge.source) && highlightedPath.includes(edge.target);
    line.setAttribute("x1", source.x); line.setAttribute("y1", source.y);
    line.setAttribute("x2", target.x); line.setAttribute("y2", target.y);
    line.classList.add(isHighlighted ? "highlighted" : "edge");
    svg.append(line);
  });
  const buttons = nodes.map((node) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `node ${node.type} ${selectedId === node.id ? "selected" : ""}`;
    button.setAttribute("role", "listitem");
    button.innerHTML = `<span>${node.label}</span><small>${node.type}${node.relevance ? ` · ${node.relevance}` : ""}</small>`;
    const point = positions.get(node.id);
    button.style.left = `${point.x / 10}%`;
    button.style.top = `${point.y / 6.6}%`;
    button.addEventListener("click", () => selectNode(node.id));
    return button;
  });
  graphElement.replaceChildren(svg, ...buttons);
  status.textContent = `${nodes.length} visible nodes · ${graph.edges.length} recorded relationships`;
}

function selectNode(id) {
  selectedId = id;
  highlightedPath = [];
  const node = byId.get(id);
  const connections = nodeEdges(id);
  const aliases = node.aliases?.length ? `<p><strong>Also known as</strong> ${node.aliases.join(", ")}</p>` : "";
  const related = connections.map((edge) => {
    const other = edge.source === id ? edge.target : edge.source;
    const role = edge.roles.length ? ` — ${edge.roles.join(", ")}` : "";
    return `<li><button type="button" data-node="${other}">${labelFor(other)}</button><span>${edge.type.replace("_", " ")}${role}</span></li>`;
  }).join("");
  detail.innerHTML = `<p class="eyebrow">${node.type}${node.relevance ? ` · ${node.relevance} relevance` : ""}</p><h2>${node.label}</h2><p>${node.summary || "No description recorded yet."}</p>${node.years ? `<p><strong>Active</strong> ${node.years}</p>` : ""}${aliases}<h3>Known relationships</h3><ul class="relationships">${related || "<li>No relationships recorded.</li>"}</ul>`;
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
    ? `Shortest recorded path: <strong>${path.map(labelFor).join(" → ")}</strong>.`
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
search.addEventListener("input", renderGraph);
populatePathSelects();
renderGraph();
