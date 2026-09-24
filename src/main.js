import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
const yearSlider = document.querySelector("#year");
const yearValue = document.querySelector("#year-value");
const zoomSlider = document.querySelector("#graph-zoom");
const zoomValue = document.querySelector("#zoom-value");
const controlTooltip = document.querySelector("#control-tooltip");
const llmStatus = document.querySelector("#llm-status");
const llmAnswer = document.querySelector("#llm-answer");
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
let disposeThree = () => {};
let activeYear = Number(yearSlider.value);
let localEngine = null;
let graphZoom = Number(zoomSlider.value);
let threeCamera = null;
let threeControls = null;
let graphPan = { x: 0, y: 0 };

const nodeEdges = (id) => graph.edges.filter((edge) => edge.source === id || edge.target === id);
const labelFor = (id) => byId.get(id).label;
const activeAtYear = (item) => (!item.validFrom || Number(item.validFrom) <= activeYear) && (!item.validTo || Number(item.validTo) >= activeYear);
const provenanceLinks = (item) => (item.provenance || []).map((source) => `<a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title} ↗</a>${source.note ? ` <span>${source.note}</span>` : ""}`).join("<br />");

function visibleNodes() {
  const typeForView = { people: "person", projects: "project", releases: "release" };
  return graph.nodes.filter((node) => (activeView === "all" || node.type === typeForView[activeView]) && activeAtYear(node));
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
  const direct = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && activeAtYear(edge));
  if (activeView === "all" || activeView === "releases") return direct;
  const compound = new Map();
  const pivotType = activeView === "people" ? "project" : "person";
  for (const pivot of graph.nodes.filter((node) => node.type === pivotType)) {
    const members = graph.edges.filter((edge) => activeAtYear(edge) && (edge.target === pivot.id || edge.source === pivot.id)).map((edge) => edge.source === pivot.id ? edge.target : edge.source).filter((id) => ids.has(id));
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
  disposeThree();
  disposeThree = () => {};
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
    const radius = Math.max(width, height) * (0.22 + (index % 4) * 0.09);
    return [node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius, z: Math.sin(angle * 1.7) * 90, vx: 0, vy: 0, pinned: false }];
  }));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("edges");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");
  const edges = context ? graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target) && activeAtYear(edge)) : visibleEdges(nodes);
  if (dimension === "3d") {
    renderThreeGraph(nodes, edges, width, height);
    status.textContent = `${context ? "Edge context · " : ""}${nodes.length} visible nodes · ${edges.length} relationships · drag to orbit, scroll to zoom`;
    return;
  }
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
    button.style.width = `${Math.min(80 + metrics.get(node.id)[sizeMetric.value] * 48, width < 520 ? 88 : 140)}px`;
    button.addEventListener("click", () => selectNode(node.id));
    button.addEventListener("pointerdown", (event) => beginDrag(event, node.id, nodeRadius, width, height));
    return [node.id, button];
  }));
  graphElement.replaceChildren(svg, ...buttons.values());
  graphElement.onclick = (event) => { if (event.target === graphElement || event.target === svg) resetSelection(); };
  graphElement.onpointerdown = (event) => { if (event.target === graphElement || event.target === svg) beginPan(event); };
  graphElement.classList.toggle("three-d", dimension === "3d");
  status.textContent = context
    ? `Edge context · ${nodes.length} nodes · ${edges.length} recorded relationships · click the canvas to return`
    : `${nodes.length} visible nodes · ${edges.length} visible relationships · drag nodes to explore`;

  redrawGraph = () => {
    for (const { edge, line } of lines) {
      const source = layout.get(edge.source);
      const target = layout.get(edge.target);
      const sourceX = width / 2 + (source.x - width / 2) * graphZoom + graphPan.x;
      const sourceY = height / 2 + (source.y - height / 2) * graphZoom + graphPan.y;
      const targetX = width / 2 + (target.x - width / 2) * graphZoom + graphPan.x;
      const targetY = height / 2 + (target.y - height / 2) * graphZoom + graphPan.y;
      line.setAttribute("x1", sourceX); line.setAttribute("y1", sourceY);
      line.setAttribute("x2", targetX); line.setAttribute("y2", targetY);
    }
    for (const [id, button] of buttons) {
      const point = layout.get(id);
      button.style.left = `${width / 2 + (point.x - width / 2) * graphZoom + graphPan.x}px`;
      button.style.top = `${height / 2 + (point.y - height / 2) * graphZoom + graphPan.y}px`;
      button.style.transform = "translate(-50%, -50%)";
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
        const push = (18000 / (distance * distance)) + Math.max(0, nodeRadius * 2 - distance) * 0.7;
        if (!a.pinned) { a.vx -= unitX * push; a.vy -= unitY * push; }
        if (!b.pinned) { b.vx += unitX * push; b.vy += unitY * push; }
      }
    }
    for (const edge of edges) {
      const a = layout.get(edge.source); const b = layout.get(edge.target);
      const dx = b.x - a.x; const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const pull = (distance - (width < 520 ? 165 : 235)) * 0.008;
      const unitX = dx / distance; const unitY = dy / distance;
      if (!a.pinned) { a.vx += unitX * pull; a.vy += unitY * pull; }
      if (!b.pinned) { b.vx -= unitX * pull; b.vy -= unitY * pull; }
    }
    for (const point of points) {
      if (point.pinned) continue;
      point.vx += (width / 2 - point.x) * 0.00035;
      point.vy += (height / 2 - point.y) * 0.00035;
      point.vx *= 0.78; point.vy *= 0.78;
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

function renderThreeGraph(nodes, edges, width, height) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, width / height, 1, 2000);
  camera.position.set(0, 0, 680);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.domElement.className = "three-canvas";
  renderer.domElement.setAttribute("aria-label", "Interactive 3D knowledge graph. Drag to orbit and scroll to zoom.");
  renderer.domElement.setAttribute("role", "img");
  graphElement.replaceChildren(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 260; controls.maxDistance = 1100;
  threeCamera = camera; threeControls = controls;
  applyThreeZoom();
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  const meshes = [];
  const colors = { person: 0xee946d, project: 0x80b7a6, release: 0xa79ada, song: 0xedaa85 };
  const points = new Map();
  for (const [id, point] of layout) points.set(id, new THREE.Vector3((point.x - width / 2) * 1.1, (height / 2 - point.y) * 1.1, point.z * 1.8));
  for (const edge of edges) {
    const geometry = new THREE.BufferGeometry().setFromPoints([points.get(edge.source), points.get(edge.target)]);
    scene.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x806d62, transparent: true, opacity: .7 })));
  }
  for (const node of nodes) {
    const metric = metrics.get(node.id)[sizeMetric.value];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(16 + metric * 22, 20, 20), new THREE.MeshBasicMaterial({ color: colors[node.type], transparent: true, opacity: selectedId && selectedId !== node.id ? .45 : 1 }));
    mesh.position.copy(points.get(node.id)); mesh.userData.nodeId = node.id; scene.add(mesh); meshes.push(mesh);
    const label = document.createElement("canvas"); label.width = 320; label.height = 64;
    const context2d = label.getContext("2d"); context2d.fillStyle = "#f5f0e8"; context2d.font = "700 30px Manrope"; context2d.textAlign = "center"; context2d.fillText(node.label, 160, 42);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(label), transparent: true }));
    sprite.position.copy(mesh.position); sprite.position.y -= 34; sprite.scale.set(112, 22, 1); scene.add(sprite);
  }
  const click = (event) => {
    const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(meshes)[0];
    if (hit) selectNode(hit.object.userData.nodeId); else resetSelection();
  };
  renderer.domElement.addEventListener("click", click);
  let frame;
  const draw = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(draw); };
  draw();
  disposeThree = () => { cancelAnimationFrame(frame); controls.dispose(); renderer.dispose(); renderer.domElement.removeEventListener("click", click); threeCamera = null; threeControls = null; };
}

function applyThreeZoom() {
  if (!threeCamera || !threeControls) return;
  const direction = threeCamera.position.clone().sub(threeControls.target).normalize();
  threeCamera.position.copy(threeControls.target.clone().add(direction.multiplyScalar(680 / graphZoom)));
  threeControls.update();
}

function setGraphZoom(next) {
  graphZoom = Math.max(.6, Math.min(2, Math.round(next * 20) / 20));
  zoomSlider.value = graphZoom;
  zoomValue.textContent = `${Math.round(graphZoom * 100)}%`;
  if (dimension === "3d") applyThreeZoom(); else redrawGraph();
}

function showEdge(edge) {
  const related = graph.edges.filter((item) => (item.source === edge.source && item.target === edge.target) || (item.source === edge.target && item.target === edge.source));
  focusedEdge = edge;
  selectedId = null;
  const context = edgeContext(edge);
  const shared = context.shared.length ? `<p><strong>Shared intermediaries</strong> ${context.shared.map(labelFor).join(", ")}</p>` : "";
  const citations = related.map(provenanceLinks).filter(Boolean).join("<br />");
  detail.innerHTML = `<p class="eyebrow">relationship context</p><h2>${labelFor(edge.source)} ↔ ${labelFor(edge.target)}</h2><p>${related.length ? related.map((item) => `${item.type.replace("_", " ")}${item.roles.length ? ` — ${item.roles.join(", ")}` : ""}`).join("<br />") : "Projected compound relationship in this filtered view."}</p>${citations ? `<p class="provenance"><strong>Sources</strong><br />${citations}</p>` : ""}${shared}<p>The graph now shows the surrounding recorded people, projects, and releases for this connection.</p><button class="return-graph" type="button" data-reset-graph>Return to full graph</button>`;
  detail.querySelector("[data-reset-graph]").addEventListener("click", resetSelection);
  renderGraph();
}

function resetSelection() {
  selectedId = null; highlightedPath = []; focusedEdge = null;
  detail.innerHTML = `<p class="eyebrow">Start exploring</p><h2>Select a node or edge</h2><p>Click a node to inspect its relationships, or an edge to inspect the connection. Click the canvas to reset.</p>`;
  renderGraph();
}

function beginPan(event) {
  const start = { x: event.clientX, y: event.clientY, panX: graphPan.x, panY: graphPan.y };
  graphElement.setPointerCapture(event.pointerId);
  const move = (moveEvent) => { graphPan = { x: start.panX + moveEvent.clientX - start.x, y: start.panY + moveEvent.clientY - start.y }; redrawGraph(); };
  const release = () => { graphElement.removeEventListener("pointermove", move); graphElement.removeEventListener("pointerup", release); graphElement.removeEventListener("pointercancel", release); };
  graphElement.addEventListener("pointermove", move); graphElement.addEventListener("pointerup", release); graphElement.addEventListener("pointercancel", release);
}

function beginDrag(event, id, nodeRadius, width, height) {
  const point = layout.get(id);
  if (!point) return;
  const button = event.currentTarget;
  button.setPointerCapture(event.pointerId);
  point.pinned = true;
  const move = (moveEvent) => {
    const bounds = graphElement.getBoundingClientRect();
    point.x = Math.max(nodeRadius, Math.min(width - nodeRadius, width / 2 + (moveEvent.clientX - bounds.left - width / 2 - graphPan.x) / graphZoom));
    point.y = Math.max(nodeRadius, Math.min(height - nodeRadius, height / 2 + (moveEvent.clientY - bounds.top - height / 2 - graphPan.y) / graphZoom));
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
  const sources = provenanceLinks(node) ? `<p class="provenance"><strong>Sources</strong><br />${provenanceLinks(node)}</p>` : "";
  const related = connections.map((edge) => {
    const other = edge.source === id ? edge.target : edge.source;
    const role = edge.roles.length ? ` — ${edge.roles.join(", ")}` : "";
    return `<li><button type="button" data-node="${other}">${labelFor(other)}</button><span>${edge.type.replace("_", " ")}${role} · ${edge.sourceStatus.replace("-", " ")}</span>${provenanceLinks(edge) ? `<span class="provenance">${provenanceLinks(edge)}</span>` : ""}</li>`;
  }).join("");
  const metric = metrics.get(id); const score = (value) => Math.round(value * 100);
  detail.innerHTML = `<p class="eyebrow">${node.type}${node.relevance ? ` · ${node.relevance} relevance` : ""}</p><h2>${node.label}</h2><p>${node.summary || "No description recorded yet."}</p>${node.years ? `<p><strong>Active</strong> ${node.years}</p>` : ""}${aliases}${sources}<h3>Graph influence</h3><p>Composite ${score(metric.composite)} · connections ${score(metric.degree)} · bridge ${score(metric.betweenness)} · PageRank ${score(metric.pageRank)}</p><h3>Known relationships</h3><ul class="relationships">${related || "<li>No relationships recorded.</li>"}</ul>`;
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

function deterministicContext() {
  if (selectedId) {
    const node = byId.get(selectedId);
    const relationships = nodeEdges(selectedId).map((edge) => {
      const other = edge.source === selectedId ? edge.target : edge.source;
      return `${node.label} ${edge.type.replace("_", " ")} ${labelFor(other)}${edge.roles?.length ? ` (${edge.roles.join(", ")})` : ""}`;
    });
    return `Selected node: ${node.label}. Recorded relationships: ${relationships.join("; ") || "none"}.`;
  }
  return document.querySelector("#path-result").textContent;
}

document.querySelector("#enable-llm").addEventListener("click", async (event) => {
  if (!navigator.gpu) { llmStatus.textContent = "WebGPU is unavailable in this browser, so the deterministic explanation remains active."; return; }
  event.currentTarget.disabled = true;
  llmStatus.textContent = "Preparing the local model download…";
  try {
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    localEngine = await CreateMLCEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC", { initProgressCallback: (report) => { llmStatus.textContent = report.text; } });
    llmStatus.textContent = "Local explainer ready. The model runs in this browser.";
  } catch (error) {
    llmStatus.textContent = `Local model unavailable: ${error.message}. Deterministic explanations remain available.`;
    event.currentTarget.disabled = false;
  }
});

document.querySelector("#llm-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = document.querySelector("#llm-question").value.trim() || "Explain this recorded graph result.";
  const context = deterministicContext();
  if (!localEngine) { llmAnswer.textContent = `${context} Enable the local explainer to turn this deterministic result into additional prose.`; return; }
  llmAnswer.textContent = "Writing from the recorded graph result…";
  try {
    const result = await localEngine.chat.completions.create({ messages: [{ role: "system", content: "Explain only the supplied graph facts. Do not add people, releases, dates, sources, or relationships. State uncertainty when data is missing." }, { role: "user", content: `Question: ${question}\n\nRecorded graph result: ${context}` }] });
    llmAnswer.textContent = result.choices[0]?.message?.content || context;
  } catch (error) { llmAnswer.textContent = `${context} Local explanation failed: ${error.message}`; }
});

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
function showTooltip(button) {
  controlTooltip.textContent = button.dataset.help;
  controlTooltip.hidden = false;
  const bounds = button.getBoundingClientRect();
  controlTooltip.style.left = `${Math.min(window.innerWidth - 18, Math.max(18, bounds.left + bounds.width / 2))}px`;
  controlTooltip.style.top = `${bounds.bottom + 8}px`;
  button.setAttribute("aria-describedby", "control-tooltip");
}

function hideTooltip(button) {
  controlTooltip.hidden = true;
  button.removeAttribute("aria-describedby");
}

document.querySelectorAll("[data-help]").forEach((button) => {
  button.addEventListener("pointerenter", () => showTooltip(button));
  button.addEventListener("pointerleave", () => hideTooltip(button));
  button.addEventListener("focus", () => showTooltip(button));
  button.addEventListener("blur", () => hideTooltip(button));
  button.addEventListener("click", (event) => event.preventDefault());
});
document.querySelector("[data-action='rearrange']").addEventListener("click", renderGraph);
document.querySelector("[data-action='dimension']").addEventListener("click", (event) => { dimension = dimension === "2d" ? "3d" : "2d"; event.currentTarget.textContent = dimension === "3d" ? "3D / 2D" : "2D / 3D"; renderGraph(); });
sizeMetric.addEventListener("change", renderGraph);
search.addEventListener("input", renderGraph);
yearSlider.addEventListener("input", () => { activeYear = Number(yearSlider.value); yearValue.textContent = activeYear; focusedEdge = null; renderGraph(); });
zoomSlider.addEventListener("input", () => setGraphZoom(Number(zoomSlider.value)));
document.querySelector("[data-action='zoom-in']").addEventListener("click", () => setGraphZoom(graphZoom + .1));
document.querySelector("[data-action='zoom-out']").addEventListener("click", () => setGraphZoom(graphZoom - .1));
document.querySelector("[data-action='zoom-reset']").addEventListener("click", () => { graphPan = { x: 0, y: 0 }; setGraphZoom(1); });
window.addEventListener("resize", renderGraph);
populatePathSelects();
renderGraph();
