import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import graph from "../data/industrial-graph.json";
import {
  edgesForVisibleNodes,
  hopDistances,
  incidentEdges,
  isActiveAtYear,
  nodesForVisibleTypes,
} from "./graph-queries.js";
import { escapeHtml, safeExternalUrl } from "./html.js";
import { graphMetrics } from "./metrics.js";

const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const graphElement = document.querySelector("#graph");
const graphPanel = document.querySelector(".graph-panel");
const detail = document.querySelector("#detail");
const relationshipsDialog = document.querySelector("#relationships-dialog");
const relationshipsTitle = document.querySelector("#relationships-title");
const relationshipsSummary = document.querySelector("#relationships-summary");
const relationshipsList = document.querySelector("#relationships-list");
const status = document.querySelector("#graph-status");
const search = document.querySelector("#search");
const searchOptions = document.querySelector("#search-options");
const pathFrom = document.querySelector("#path-from");
const pathTo = document.querySelector("#path-to");
const pathOptions = document.querySelector("#path-options");
const sizeMetric = document.querySelector("#size-metric");
const degreeLimit = document.querySelector("#degree-limit");
const fadeDistance = document.querySelector("#fade-distance");
const yearSlider = document.querySelector("#year");
const yearValue = document.querySelector("#year-value");
const zoomSlider = document.querySelector("#graph-zoom");
const zoomValue = document.querySelector("#zoom-value");
const controlTooltip = document.querySelector("#control-tooltip");
const fullscreenButton = document.querySelector("[data-action='fullscreen']");
const llmStatus = document.querySelector("#llm-status");
const llmAnswer = document.querySelector("#llm-answer");
const compareDialog = document.querySelector("#compare-dialog");
const compareFirst = document.querySelector("#compare-first");
const compareSecond = document.querySelector("#compare-second");
const compareResult = document.querySelector("#compare-result");
let metrics = graphMetrics(graph.nodes, graph.edges);
const fullGraphMetrics = graphMetrics(graph.nodes, graph.edges);
let currentNodes = graph.nodes;
let currentEdges = graph.edges;
let activeTypes = new Set(["person", "project", "release"]);
let selectedId = null;
let highlightedPath = [];
let animationFrame;
let layout = new Map();
let redrawGraph = () => {};
let restartSimulation = () => {};
let dimension = "3d";
let focusedEdge = null;
let disposeThree = () => {};
let activeYear = Number(yearSlider.value);
let localEngine = null;
let graphZoom = Number(zoomSlider.value);
let threeCamera = null;
let threeControls = null;
let graphPan = { x: 0, y: 0 };
let suppressCanvasClick = false;
let resizeTimer;
let zoomRange = { min: 0.01, max: 100, fit: 1 };
const maximumRenderedSpheres = 300;

const nodeEdges = (id) => incidentEdges(graph.edges, id);
const labelFor = (id) => byId.get(id).label;
const activeAtYear = (item) => isActiveAtYear(item, activeYear);
const provenanceLinks = (item) =>
  (item.provenance || [])
    .map((source) => {
      const url = safeExternalUrl(source.url);
      const title = escapeHtml(source.title || "Source");
      const note = source.note
        ? ` <span>${escapeHtml(source.note)}</span>`
        : "";
      return url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title} ↗</a>${note}`
        : `${title}${note}`;
    })
    .join("<br />");
// A power curve makes each metric’s low, middle, and high values visibly
// distinct without changing the underlying graph calculation.
const visualMetric = (node) =>
  Math.pow(metrics.get(node.id)[sizeMetric.value], 1.55);

function visibleNodes() {
  return nodesForVisibleTypes(graph.nodes, activeTypes, activeYear);
}

function visibleEdges(nodes) {
  return edgesForVisibleNodes(graph, nodes, activeTypes, activeYear);
}

function edgeContext(edge) {
  const ids = new Set([edge.source, edge.target]);
  for (const id of edge.via || []) ids.add(id);
  const sourceNeighbors = new Set(
    nodeEdges(edge.source).map((item) =>
      item.source === edge.source ? item.target : item.source,
    ),
  );
  const targetNeighbors = new Set(
    nodeEdges(edge.target).map((item) =>
      item.source === edge.target ? item.target : item.source,
    ),
  );
  const shared = [...sourceNeighbors].filter((id) => targetNeighbors.has(id));
  for (const id of shared) ids.add(id);
  for (const item of graph.edges) {
    if (
      item.source === edge.source ||
      item.target === edge.source ||
      item.source === edge.target ||
      item.target === edge.target
    ) {
      ids.add(item.source);
      ids.add(item.target);
    }
  }
  return { ids, shared };
}

function renderGraph() {
  disposeThree();
  disposeThree = () => {};
  const term = search.value.trim().toLowerCase();
  let nodes = visibleNodes().filter(
    (node) =>
      !term ||
      `${node.label} ${(node.aliases || []).join(" ")}`
        .toLowerCase()
        .includes(term),
  );
  const context = focusedEdge ? edgeContext(focusedEdge) : null;
  if (context) nodes = graph.nodes.filter((node) => context.ids.has(node.id));
  const distances = selectedId
    ? hopDistances(graph.edges, selectedId)
    : new Map();
  const visibleDegrees =
    degreeLimit.value === "all" ? Infinity : Number(degreeLimit.value);
  if (selectedId && Number.isFinite(visibleDegrees))
    nodes = nodes.filter((node) => distances.get(node.id) <= visibleDegrees);
  const totalMatchingNodes = nodes.length;
  if (nodes.length > maximumRenderedSpheres) {
    const connectionCounts = new Map(nodes.map((node) => [node.id, 0]));
    for (const edge of graph.edges) {
      if (connectionCounts.has(edge.source))
        connectionCounts.set(
          edge.source,
          connectionCounts.get(edge.source) + 1,
        );
      if (connectionCounts.has(edge.target))
        connectionCounts.set(
          edge.target,
          connectionCounts.get(edge.target) + 1,
        );
    }
    nodes = [...nodes]
      .sort(
        (left, right) =>
          (right.id === selectedId) - (left.id === selectedId) ||
          connectionCounts.get(right.id) - connectionCounts.get(left.id) ||
          left.label.localeCompare(right.label),
      )
      .slice(0, maximumRenderedSpheres);
  }
  const omittedNodeCount = totalMatchingNodes - nodes.length;
  const visibleIds = new Set(nodes.map(({ id }) => id));
  const edges = context
    ? graph.edges.filter(
        (edge) =>
          visibleIds.has(edge.source) &&
          visibleIds.has(edge.target) &&
          activeAtYear(edge),
      )
    : visibleEdges(nodes);
  // Every metric is recalculated from the current view, so People, Projects,
  // and Releases compare like with like instead of against the whole graph.
  currentNodes = nodes;
  currentEdges = edges;
  metrics = graphMetrics(nodes, edges);
  const width = graphElement.clientWidth || 760;
  const height = graphElement.clientHeight || 450;
  const sizeFor = (node) => {
    return Math.round(
      (width < 520 ? 42 : 46) + visualMetric(node) * (width < 520 ? 82 : 150),
    );
  };
  cancelAnimationFrame(animationFrame);
  layout = new Map(
    nodes.map((node, index) => {
      const angle = index * 2.399963229728653;
      // The map's working area is 50% wider and taller than the visible frame
      // in every direction. This avoids a hard wall of spheres at the viewport
      // edge and leaves meaningful territory to discover by panning and zooming.
      const radius =
        Math.sqrt((index + 1) / Math.max(nodes.length, 1)) *
        Math.min(width, height) *
        0.92;
      const depth =
        (((index * 0.61803398875) % 1) * 2 - 1) *
        Math.min(width, height) *
        0.65;
      const isSelected = node.id === selectedId;
      // A selection becomes the stable center of the force layout. The rest of
      // the map can settle around it, keeping the chosen sphere in view as its
      // relationships spread out.
      return [
        node.id,
        {
          x: isSelected ? width / 2 : width / 2 + Math.cos(angle) * radius,
          y: isSelected ? height / 2 : height / 2 + Math.sin(angle) * radius,
          z: isSelected ? 0 : depth,
          vx: 0,
          vy: 0,
          pinned: isSelected,
        },
      ];
    }),
  );
  updateZoomRange(width, height, nodes, sizeFor);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("edges");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");
  graphElement.classList.toggle("three-d", dimension === "3d");
  if (dimension === "3d") {
    // Remove 2D canvas handlers left from the prior mode. Otherwise a drag to
    // orbit also begins a 2D pan and can be mistaken for a reset click.
    graphElement.onclick = null;
    graphElement.onpointerdown = null;
    renderThreeGraph(nodes, edges, width, height, distances);
    status.textContent = `${context ? "Connection details · " : ""}${nodes.length} visible spheres${omittedNodeCount ? ` of ${totalMatchingNodes}; search to narrow the remaining ${omittedNodeCount} · ` : " · "}${edges.length} connection lines · drag to orbit, scroll to zoom`;
    return;
  }
  const lines = edges.map((edge) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add(
      highlightedPath.includes(edge.source) && highlightedPath.includes(edge.target)
        ? "highlighted"
        : edge.type === "inferred"
          ? "inferred"
          : "edge",
    );
    line.style.pointerEvents = "stroke";
    line.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!suppressCanvasClick) showEdge(edge);
    });
    svg.append(line);
    return { edge, line };
  });
  const buttons = new Map(
    nodes.map((node) => {
      const button = document.createElement("button");
      button.type = "button";
      const distance = distances.get(node.id);
      button.className = `node ${node.type} ${selectedId === node.id ? "selected" : ""}`;
      if (selectedId) {
        const fadeHops = Number(fadeDistance.value);
        const opacity =
          distance === undefined || distance > fadeHops
            ? 0.16
            : 1 - (distance / fadeHops) * 0.84;
        button.style.opacity = `${opacity}`;
      }
      button.setAttribute("role", "listitem");
      button.innerHTML = `<span>${escapeHtml(node.label)}</span><small>${escapeHtml(node.type)}${node.relevance ? ` · ${escapeHtml(node.relevance)}` : ""}</small>`;
      button.style.width = `${sizeFor(node)}px`;
      button.addEventListener("click", () => selectNode(node.id));
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        beginDrag(event, node.id, sizeFor(node) / 2, width, height);
      });
      return [node.id, button];
    }),
  );
  graphElement.replaceChildren(svg, ...buttons.values());
  graphElement.onclick = (event) => {
    if (
      !suppressCanvasClick &&
      (event.target === graphElement || event.target === svg)
    )
      resetSelection();
  };
  graphElement.onpointerdown = (event) => {
    if (!event.target.closest?.(".node")) beginPan(event);
  };
  status.textContent = context
    ? `Connection details · ${nodes.length} spheres · ${edges.length} recorded relationships · click the canvas to return`
    : `${nodes.length} visible spheres${omittedNodeCount ? ` of ${totalMatchingNodes}; search to narrow the remaining ${omittedNodeCount}` : ""} · ${edges.length} visible connection lines · drag spheres to explore`;

  redrawGraph = () => {
    for (const { edge, line } of lines) {
      const source = layout.get(edge.source);
      const target = layout.get(edge.target);
      const sourceX =
        width / 2 + (source.x - width / 2) * graphZoom + graphPan.x;
      const sourceY =
        height / 2 + (source.y - height / 2) * graphZoom + graphPan.y;
      const targetX =
        width / 2 + (target.x - width / 2) * graphZoom + graphPan.x;
      const targetY =
        height / 2 + (target.y - height / 2) * graphZoom + graphPan.y;
      line.setAttribute("x1", sourceX);
      line.setAttribute("y1", sourceY);
      line.setAttribute("x2", targetX);
      line.setAttribute("y2", targetY);
    }
    for (const [id, button] of buttons) {
      const point = layout.get(id);
      button.style.left = `${width / 2 + (point.x - width / 2) * graphZoom + graphPan.x}px`;
      button.style.top = `${height / 2 + (point.y - height / 2) * graphZoom + graphPan.y}px`;
      button.style.transform = `translate(-50%, -50%) scale(${graphZoom})`;
    }
  };

  const simulate = (heat = 1) => {
    const points = [...layout.values()];
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const a = points[left];
        const b = points[right];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.01;
        const unitX = dx / distance;
        const unitY = dy / distance;
        const minimumDistance =
          sizeFor(nodes[left]) / 2 + sizeFor(nodes[right]) / 2 + 18;
        const push =
          25000 / (distance * distance) +
          Math.max(0, minimumDistance - distance) * 1.1;
        if (!a.pinned) {
          a.vx -= unitX * push;
          a.vy -= unitY * push;
        }
        if (!b.pinned) {
          b.vx += unitX * push;
          b.vy += unitY * push;
        }
      }
    }
    for (const edge of edges) {
      const a = layout.get(edge.source);
      const b = layout.get(edge.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const pull = (distance - (width < 520 ? 180 : 280)) * 0.0045;
      const unitX = dx / distance;
      const unitY = dy / distance;
      if (!a.pinned) {
        a.vx += unitX * pull;
        a.vy += unitY * pull;
      }
      if (!b.pinned) {
        b.vx -= unitX * pull;
        b.vy -= unitY * pull;
      }
    }
    for (const [pointIndex, point] of points.entries()) {
      if (point.pinned) continue;
      point.vx += (width / 2 - point.x) * 0.00008;
      point.vy += (height / 2 - point.y) * 0.00008;
      point.vx *= 0.78;
      point.vy *= 0.78;
      // This is an infinite working plane. The gentle center force provides a
      // readable shape while allowing the outer graph to taper naturally past
      // the current viewport instead of accumulating against a hard wall.
      point.x += point.vx * heat;
      point.y += point.vy * heat;
    }
    redrawGraph();
    if (heat > 0.015)
      animationFrame = requestAnimationFrame(() => simulate(heat * 0.985));
  };
  restartSimulation = () => {
    cancelAnimationFrame(animationFrame);
    simulate(0.45);
  };
  simulate();
}

function renderThreeGraph(nodes, edges, width, height, distances) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf6cfbd, 0x140f16, 2.2));
  const keyLight = new THREE.PointLight(0xff9870, 3.5, 1100);
  keyLight.position.set(-180, 240, 420);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x9f94df, 2.2, 1000);
  rimLight.position.set(240, -160, 300);
  scene.add(rimLight);
  const camera = new THREE.PerspectiveCamera(48, width / height, 1, 2000);
  camera.position.set(0, 0, 680);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.domElement.className = "three-canvas";
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D relationship map. Drag to orbit the spheres and scroll to zoom.",
  );
  renderer.domElement.setAttribute("role", "img");
  graphElement.replaceChildren(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = 50000;
  threeCamera = camera;
  threeControls = controls;
  applyThreeZoom();
  let orbitMoved = false;
  controls.addEventListener("start", () => {
    orbitMoved = false;
  });
  controls.addEventListener("change", () => {
    orbitMoved = true;
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const meshes = [];
  const edgeMeshes = [];
  const gradients = {
    person: ["#ffb184", "#55271d"],
    project: ["#9bd2bf", "#1d453b"],
    release: ["#c4b9ff", "#312750"],
    song: ["#ffc08e", "#5c3320"],
  };
  const textureFor = (type) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(42, 32, 4, 64, 64, 75);
    gradient.addColorStop(0, gradients[type][0]);
    gradient.addColorStop(1, gradients[type][1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  };
  const points = new Map();
  for (const [id, point] of layout)
    points.set(
      id,
      new THREE.Vector3(
        (point.x - width / 2) * 1.1,
        (height / 2 - point.y) * 1.1,
        point.z * 0.9,
      ),
    );
  for (const edge of edges) {
    const start = points.get(edge.source);
    const end = points.get(edge.target);
    const direction = end.clone().sub(start);
    const length = direction.length();
    const selected =
      highlightedPath.includes(edge.source) &&
      highlightedPath.includes(edge.target);
    const geometry = new THREE.CylinderGeometry(
      selected ? 1.7 : 0.9,
      selected ? 1.7 : 0.9,
      length,
      8,
    );
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selected ? 0xff9a68 : 0x806d62,
        transparent: true,
        opacity: selected ? 1 : 0.8,
      }),
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    mesh.userData.edge = edge;
    scene.add(mesh);
    edgeMeshes.push(mesh);
  }
  for (const node of nodes) {
    const radius = 7 + visualMetric(node) * 62;
    const distance = distances.get(node.id);
    const fadeHops = Number(fadeDistance.value);
    const opacity = !selectedId
      ? 1
      : distance === undefined || distance > fadeHops
        ? 0.16
        : 1 - (distance / fadeHops) * 0.84;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshPhongMaterial({
        map: textureFor(node.type),
        shininess: 70,
        transparent: true,
        opacity,
      }),
    );
    mesh.position.copy(points.get(node.id));
    mesh.userData.nodeId = node.id;
    scene.add(mesh);
    meshes.push(mesh);
    const label = document.createElement("canvas");
    label.width = 320;
    label.height = 64;
    const context2d = label.getContext("2d");
    context2d.fillStyle = "#f5f0e8";
    context2d.font = "700 30px Manrope";
    context2d.textAlign = "center";
    context2d.fillText(node.label, 160, 42);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(label),
        transparent: true,
      }),
    );
    sprite.position.copy(mesh.position);
    sprite.position.y -= radius + 16;
    sprite.scale.set(112, 22, 1);
    scene.add(sprite);
  }
  const click = (event) => {
    // OrbitControls emits a click after a rotation. Keep the rotated camera
    // intact; only a genuine tap selects a node or resets the selection.
    if (orbitMoved) {
      orbitMoved = false;
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const nodeHit = raycaster.intersectObjects(meshes)[0];
    if (nodeHit) {
      selectNode(nodeHit.object.userData.nodeId);
      return;
    }
    const edgeHit = raycaster.intersectObjects(edgeMeshes)[0];
    if (edgeHit) showEdge(edgeHit.object.userData.edge);
    else resetSelection();
  };
  renderer.domElement.addEventListener("click", click);
  let frame;
  const draw = () => {
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  };
  draw();
  disposeThree = () => {
    cancelAnimationFrame(frame);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.removeEventListener("click", click);
    threeCamera = null;
    threeControls = null;
  };
}

function applyThreeZoom() {
  if (!threeCamera || !threeControls) return;
  const direction = threeCamera.position
    .clone()
    .sub(threeControls.target)
    .normalize();
  threeCamera.position.copy(
    threeControls.target.clone().add(direction.multiplyScalar(680 / graphZoom)),
  );
  threeControls.update();
}

function updateZoomRange(width, height, nodes, sizeFor) {
  if (!nodes.length) return;
  const points = [...layout.values()];
  const largestDiameter = Math.max(...nodes.map((node) => sizeFor(node)));
  const minX = Math.min(
    ...points.map((point) => point.x - largestDiameter / 2),
  );
  const maxX = Math.max(
    ...points.map((point) => point.x + largestDiameter / 2),
  );
  const minY = Math.min(
    ...points.map((point) => point.y - largestDiameter / 2),
  );
  const maxY = Math.max(
    ...points.map((point) => point.y + largestDiameter / 2),
  );
  const fit =
    Math.min(
      width / Math.max(maxX - minX, 1),
      height / Math.max(maxY - minY, 1),
    ) * 0.88;
  zoomRange = {
    // Ten times farther out than the fitted map still exposes the entire
    // graph, even when labels become deliberately unreadable.
    min: Math.max(0.003, fit / 10),
    // A node can grow beyond the viewport; this is derived from the current
    // largest sphere instead of a fixed percentage ceiling.
    max: Math.max(
      12,
      (Math.max(width, height) * 1.2) / Math.max(largestDiameter, 1),
    ),
    fit,
  };
  zoomSlider.min = `${zoomRange.min}`;
  zoomSlider.max = `${zoomRange.max}`;
  zoomSlider.step = `${Math.max(0.001, zoomRange.min / 4)}`;
}

function setGraphZoom(next) {
  graphZoom = Math.max(zoomRange.min, Math.min(zoomRange.max, next));
  zoomSlider.value = graphZoom;
  zoomValue.textContent = `${Math.round(graphZoom * 100)}%`;
  if (dimension === "3d") applyThreeZoom();
  else redrawGraph();
}

function showEdge(edge) {
  const related = graph.edges.filter(
    (item) =>
      (item.source === edge.source && item.target === edge.target) ||
      (item.source === edge.target && item.target === edge.source),
  );
  focusedEdge = edge;
  selectedId = null;
  const context = edgeContext(edge);
  const shared = context.shared.length
    ? `<p><strong>Shared intermediaries</strong> ${context.shared.map((id) => escapeHtml(labelFor(id))).join(", ")}</p>`
    : "";
  const citations = related.map(provenanceLinks).filter(Boolean).join("<br />");
  const inferredBy = edge.via?.length
    ? `<p><strong>Inferred through hidden sphere${edge.via.length === 1 ? "" : "s"}</strong> ${edge.via.map((id) => escapeHtml(labelFor(id))).join(", ")}. This is a display-only bridge, not a recorded direct relationship.</p>`
    : "";
  detail.innerHTML = `<p class="eyebrow">${edge.type === "inferred" ? "inferred connection" : "connection details"}</p><h2>${escapeHtml(labelFor(edge.source))} ↔ ${escapeHtml(labelFor(edge.target))}</h2><p>${related.length ? related.map((item) => `${escapeHtml(item.type.replace("_", " "))}${item.roles.length ? ` — ${item.roles.map(escapeHtml).join(", ")}` : ""}`).join("<br />") : "No recorded direct relationship is shown for this display-only connection."}</p>${citations ? `<p class="provenance"><strong>Sources</strong><br />${citations}</p>` : ""}${inferredBy}${shared}<p>The map now shows the surrounding recorded people, projects, and releases for this connection.</p><button class="return-graph" type="button" data-reset-graph>Clear selection</button>`;
  detail
    .querySelector("[data-reset-graph]")
    .addEventListener("click", resetSelection);
  renderGraph();
}

function resetSelection({ clearSearch = false } = {}) {
  selectedId = null;
  highlightedPath = [];
  focusedEdge = null;
  graphPan = { x: 0, y: 0 };
  if (clearSearch) search.value = "";
  detail.innerHTML = `<p class="eyebrow">Start exploring</p><h2>Select a sphere or line</h2><p>Click a sphere to inspect its relationships, or a line to inspect the connection. Click the background to reset.</p>`;
  renderGraph();
}

function beginPan(event) {
  const start = {
    x: event.clientX,
    y: event.clientY,
    panX: graphPan.x,
    panY: graphPan.y,
  };
  graphElement.setPointerCapture(event.pointerId);
  let moved = false;
  const move = (moveEvent) => {
    const deltaX = moveEvent.clientX - start.x;
    const deltaY = moveEvent.clientY - start.y;
    if (Math.hypot(deltaX, deltaY) > 5) moved = true;
    if (moved) {
      graphPan = { x: start.panX + deltaX, y: start.panY + deltaY };
      redrawGraph();
    }
  };
  const release = () => {
    if (moved) {
      suppressCanvasClick = true;
      window.setTimeout(() => {
        suppressCanvasClick = false;
      }, 0);
    }
    graphElement.removeEventListener("pointermove", move);
    graphElement.removeEventListener("pointerup", release);
    graphElement.removeEventListener("pointercancel", release);
  };
  graphElement.addEventListener("pointermove", move);
  graphElement.addEventListener("pointerup", release);
  graphElement.addEventListener("pointercancel", release);
}

function beginDrag(event, id, nodeRadius, width, height) {
  const point = layout.get(id);
  if (!point) return;
  const button = event.currentTarget;
  button.setPointerCapture(event.pointerId);
  point.pinned = true;
  const move = (moveEvent) => {
    const bounds = graphElement.getBoundingClientRect();
    point.x =
      width / 2 +
      (moveEvent.clientX - bounds.left - width / 2 - graphPan.x) / graphZoom;
    point.y =
      height / 2 +
      (moveEvent.clientY - bounds.top - height / 2 - graphPan.y) / graphZoom;
    point.vx = 0;
    point.vy = 0;
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
  highlightedPath = [];
  focusedEdge = null;
  // A prior pan should not leave the newly selected sphere off-center.
  graphPan = { x: 0, y: 0 };
  const node = byId.get(id);
  const connections = nodeEdges(id);
  const aliases = node.aliases?.length
    ? `<p><strong>Also known as</strong> ${node.aliases.map(escapeHtml).join(", ")}</p>`
    : "";
  const sources = provenanceLinks(node)
    ? `<p class="provenance"><strong>Sources</strong><br />${provenanceLinks(node)}</p>`
    : "";
  const metric = metrics.get(id);
  const score = (value) => Math.round(value * 100);
  detail.innerHTML = `<p class="eyebrow">${escapeHtml(node.type)}${node.relevance ? ` · ${escapeHtml(node.relevance)} relevance` : ""}</p><h2>${escapeHtml(node.label)}</h2><p>${escapeHtml(node.summary || "No description recorded yet.")}</p>${node.years ? `<p><strong>Active</strong> ${escapeHtml(node.years)}</p>` : ""}${aliases}${sources}<h3>Graph influence</h3><p>Composite ${score(metric.composite)} · contribution ${score(metric.contribution)} · connections ${score(metric.degree)} · bridge ${score(metric.betweenness)} · PageRank ${score(metric.pageRank)}</p><button class="open-relationships" type="button" data-open-relationships>View ${connections.length} recorded connection${connections.length === 1 ? "" : "s"}</button>`;
  detail
    .querySelector("[data-open-relationships]")
    .addEventListener("click", () => openRelationships(node, connections));
  renderGraph();
}

function relationshipGroups(node, connections) {
  const categories = [
    { type: "person", label: "People" },
    { type: "project", label: "Projects" },
    { type: "release", label: "Releases" },
  ];
  const grouped = new Map(categories.map((category) => [category.type, []]));
  for (const edge of connections) {
    const other = edge.source === node.id ? edge.target : edge.source;
    const otherNode = byId.get(other);
    if (otherNode && grouped.has(otherNode.type))
      grouped.get(otherNode.type).push({ edge, other, otherNode });
  }
  return categories
    .map(({ type, label }) => {
      const items = grouped
        .get(type)
        .sort((left, right) =>
          left.otherNode.label.localeCompare(right.otherNode.label),
        );
      if (!items.length) return "";
      const entries = items
        .map(({ edge, other, otherNode }) => {
          const role = edge.roles.length
            ? ` — ${edge.roles.map(escapeHtml).join(", ")}`
            : "";
          return `<li><button type="button" data-node="${escapeHtml(other)}">${escapeHtml(otherNode.label)}</button><span>${escapeHtml(edge.type.replace("_", " "))}${role} · ${escapeHtml(edge.sourceStatus.replace("-", " "))}</span>${provenanceLinks(edge) ? `<span class="provenance">${provenanceLinks(edge)}</span>` : ""}</li>`;
        })
        .join("");
      return `<section class="relationship-group relationship-group--${type}"><h3><i aria-hidden="true"></i>${label} <span>${items.length}</span></h3><ul>${entries}</ul></section>`;
    })
    .join("");
}

function openRelationships(node, connections) {
  relationshipsTitle.textContent = `${node.label} — recorded connections`;
  relationshipsSummary.textContent = `${connections.length} relationship${connections.length === 1 ? "" : "s"} documented for ${node.label}, grouped by the connected sphere type. Select an entry to make it the active sphere.`;
  relationshipsList.innerHTML =
    relationshipGroups(node, connections) ||
    "<p>No relationships recorded.</p>";
  relationshipsList.querySelectorAll("[data-node]").forEach((button) =>
    button.addEventListener("click", () => {
      relationshipsDialog.close();
      selectNode(button.dataset.node);
    }),
  );
  relationshipsDialog.showModal();
}

document
  .querySelector("[data-close-relationships]")
  .addEventListener("click", () => relationshipsDialog.close());

function populatePathSelects() {
  const suggestions = [];
  for (const node of [...graph.nodes].sort((a, b) =>
    a.label.localeCompare(b.label),
  )) {
    suggestions.push(
      `<option value="${escapeHtml(node.label)}">${escapeHtml(node.type)}</option>`,
    );
    for (const alias of node.aliases || [])
      suggestions.push(
        `<option value="${escapeHtml(alias)}">${escapeHtml(node.label)} · ${escapeHtml(node.type)}</option>`,
      );
  }
  pathOptions.innerHTML = suggestions.join("");
  searchOptions.innerHTML = suggestions.join("");
  pathFrom.value = "Al Jourgensen";
  pathTo.value = "Richard 23";
}

function pathInputNode(input) {
  const query = input.value.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = [];
  for (const node of graph.nodes) {
    if (node.label.toLocaleLowerCase() === query)
      matches.push({
        node,
        matchedName: node.label,
        isAlias: false,
        exact: true,
      });
    for (const alias of node.aliases || []) {
      if (alias.toLocaleLowerCase() === query)
        matches.push({ node, matchedName: alias, isAlias: true, exact: true });
    }
  }
  const exact = matches[0];
  if (exact) return exact;
  // The native suggestion list narrows as someone types. Allow its one unique
  // remaining person/project to be submitted without making them type every
  // character, but never guess when more than one identity matches.
  const partials = [];
  for (const node of graph.nodes) {
    const matchingName = [node.label, ...(node.aliases || [])].find((name) =>
      name.toLocaleLowerCase().startsWith(query),
    );
    if (matchingName)
      partials.push({
        node,
        matchedName: matchingName,
        isAlias:
          matchingName.toLocaleLowerCase() !== node.label.toLocaleLowerCase(),
      });
  }
  return partials.length === 1 ? partials[0] : null;
}

function shortestPath(start, target, edges = currentEdges) {
  const queue = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    const current = path.at(-1);
    if (current === target) return path;
    for (const edge of edges.filter(
      (item) => item.source === current || item.target === current,
    )) {
      const next = edge.source === current ? edge.target : edge.source;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

function searchAndSelect(allowUniquePartial = false) {
  const match = pathInputNode(search);
  if (!match || (!match.exact && !allowUniquePartial)) return false;
  search.value = "";
  selectNode(match.node.id);
  status.textContent = `${match.isAlias ? `${match.matchedName} is ${match.node.label}. ` : ""}Selected ${match.node.label} and centered its connections.`;
  return true;
}

function compareNodes() {
  const first = pathInputNode(compareFirst);
  const second = pathInputNode(compareSecond);
  if (!first || !second) {
    compareResult.textContent = "Choose a listed person, project, or release in both fields.";
    return;
  }
  const activeEdges = graph.edges.filter(activeAtYear);
  const path = shortestPath(first.node.id, second.node.id, activeEdges);
  const score = (node) => Math.round((fullGraphMetrics.get(node.id)?.composite || 0) * 100);
  const aliases = [first, second].filter((item) => item.isAlias).map((item) => `${escapeHtml(item.matchedName)} is ${escapeHtml(item.node.label)}.`).join(" ");
  compareResult.innerHTML = `<section><h3>${escapeHtml(first.node.label)} <span>${escapeHtml(first.node.type)}</span></h3><p>${escapeHtml(first.node.summary || "No description recorded yet.")}</p><p>Composite influence: ${score(first.node)}</p></section><section><h3>${escapeHtml(second.node.label)} <span>${escapeHtml(second.node.type)}</span></h3><p>${escapeHtml(second.node.summary || "No description recorded yet.")}</p><p>Composite influence: ${score(second.node)}</p></section><p class="compare-path">${aliases}${aliases ? " " : ""}${path ? `Shortest recorded connection: <strong>${path.map((id) => escapeHtml(labelFor(id))).join(" → ")}</strong>.` : "No connecting path has been recorded by the selected year."}</p>`;
}

function deterministicContext() {
  if (selectedId) {
    const node = byId.get(selectedId);
    const relationships = nodeEdges(selectedId).map((edge) => {
      const other = edge.source === selectedId ? edge.target : edge.source;
      return `${node.label} ${edge.type.replace("_", " ")} ${labelFor(other)}${edge.roles?.length ? ` (${edge.roles.join(", ")})` : ""}`;
    });
    return `Selected sphere: ${node.label}. Recorded relationships: ${relationships.join("; ") || "none"}.`;
  }
  return document.querySelector("#path-result").textContent;
}

function mentionedNodes(question) {
  const normalizedQuestion = question.toLowerCase();
  return currentNodes
    .filter((node) =>
      [node.label, ...(node.aliases || [])].some((name) =>
        normalizedQuestion.includes(name.toLowerCase()),
      ),
    )
    .sort((left, right) => right.label.length - left.label.length);
}

function formatPath(path) {
  return path
    ? path.map(labelFor).join(" → ")
    : "No connecting path has been recorded in the current view.";
}

function rankingScope(question) {
  const normalizedQuestion = question.toLowerCase();
  const type = /\b(people|persons|artists)\b/.test(normalizedQuestion)
    ? "person"
    : /\b(projects|bands|groups)\b/.test(normalizedQuestion)
      ? "project"
      : /\b(releases|albums|records)\b/.test(normalizedQuestion)
        ? "release"
        : null;
  const nodes = type
    ? graph.nodes.filter((node) => node.type === type && activeAtYear(node))
    : currentNodes;
  const edges = type ? visibleEdges(nodes) : currentEdges;
  const enabledTypes = [...activeTypes].map((item) =>
    item === "person" ? "people" : `${item}s`,
  );
  return {
    nodes,
    metrics: graphMetrics(nodes, edges),
    label: type
      ? `${type === "person" ? "people" : `${type}s`} visible by ${activeYear}`
      : enabledTypes.length === 3
        ? "the current graph"
        : `the current ${enabledTypes.join(", ")} view`,
  };
}

function rankingMetric(question) {
  const normalizedQuestion = question.toLowerCase();
  if (/page\s*rank/.test(normalizedQuestion))
    return { key: "pageRank", label: "PageRank" };
  if (/bridge|connector/.test(normalizedQuestion))
    return { key: "betweenness", label: "bridge importance" };
  if (/contribution|participation|weighted connection/.test(normalizedQuestion))
    return { key: "contribution", label: "contribution strength" };
  if (
    /direct connection|most connected|connection count/.test(normalizedQuestion)
  )
    return { key: "degree", label: "direct connections" };
  return { key: "composite", label: "equally weighted composite score" };
}

function interpretGraphQuestion(question) {
  const normalizedQuestion = question.toLowerCase();
  const entities = mentionedNodes(question);
  if (
    /(highest|top|rank|score|most connected|largest)/.test(normalizedQuestion)
  ) {
    const scope = rankingScope(question);
    const metric = rankingMetric(question);
    const ranked = [...scope.metrics.entries()]
      .map(([id, score]) => ({ node: byId.get(id), score }))
      .sort((left, right) => right.score[metric.key] - left.score[metric.key])
      .slice(0, 5);
    if (!ranked.length) return null;
    return `${metric.label[0].toUpperCase()}${metric.label.slice(1)} in ${scope.label}: ${ranked.map(({ node, score }, index) => `${index + 1}. ${node.label} (${Math.round(score[metric.key] * 100)})`).join("; ")}.`;
  }
  if (
    entities.length >= 2 &&
    /(related|connect|relationship|path|between)/.test(normalizedQuestion)
  ) {
    const path = shortestPath(entities[0].id, entities[1].id);
    return path
      ? `${entities[0].label} and ${entities[1].label} are connected in the current view by: ${formatPath(path)}.`
      : `No connection between ${entities[0].label} and ${entities[1].label} has been recorded in the current view.`;
  }
  if (
    entities.length &&
    /(tell me|about|who is|what is|relationships|connected)/.test(
      normalizedQuestion,
    )
  ) {
    const node = entities[0];
    const relationships = currentEdges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) =>
        labelFor(edge.source === node.id ? edge.target : edge.source),
      );
    const score = metrics.get(node.id);
    return `${node.label}: ${node.summary || "No description has been recorded."} Recorded connections in the current view: ${relationships.join(", ") || "none"}. Composite score: ${Math.round(score.composite * 100)}.`;
  }
  return null;
}

document
  .querySelector("#enable-llm")
  .addEventListener("click", async (event) => {
    if (!navigator.gpu) {
      llmStatus.textContent =
        "This browser cannot turn on the answer helper. You can still explore the recorded relationships.";
      return;
    }
    event.currentTarget.disabled = true;
    llmStatus.textContent = "Getting the answer helper ready…";
    try {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      localEngine = await CreateMLCEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC", {
        initProgressCallback: (report) => {
          llmStatus.textContent = report.text;
        },
      });
      llmStatus.textContent = "Answer helper ready.";
    } catch (error) {
      llmStatus.textContent =
        "The answer helper could not start. You can still explore the recorded relationships.";
      event.currentTarget.disabled = false;
    }
  });

document
  .querySelector("#llm-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const question =
      document.querySelector("#llm-question").value.trim() ||
      "Explain this recorded graph result.";
    const interpreted = interpretGraphQuestion(question);
    if (interpreted) {
      llmAnswer.textContent = interpreted;
      return;
    }
    const context = deterministicContext();
    const limitedAnswer =
      "I am only a simple bot with limited resources and can't handle this request. Try selecting a sphere or revealing a path first.";
    if (!localEngine) {
      llmAnswer.textContent =
        selectedId || highlightedPath.length ? context : limitedAnswer;
      return;
    }
    llmAnswer.textContent = "Looking through the recorded connections…";
    try {
      const result = await localEngine.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Answer only from the supplied graph facts. Do not add people, releases, dates, sources, or relationships. If the facts do not answer the question, say exactly: I am only a simple bot with limited resources and can't handle this request.",
          },
          {
            role: "user",
            content: `Question: ${question}\n\nRecorded graph result: ${context}`,
          },
        ],
      });
      llmAnswer.textContent =
        result.choices[0]?.message?.content || limitedAnswer;
    } catch {
      llmAnswer.textContent = limitedAnswer;
    }
  });

document.querySelector("#ask-chatgpt").addEventListener("click", () => {
  const question =
    document.querySelector("#llm-question").value.trim() ||
    "What can this industrial music knowledge graph tell me?";
  const dataUrl = new URL("data/industrial-graph.json", window.location.href)
    .href;
  const prompt = `Use this public JSON knowledge-graph file as evidence: ${dataUrl}\n\nQuestion: ${question}\n\nAnswer only from the file when possible. State uncertainty and identify missing evidence rather than inventing relationships. If you cannot open the link, ask me to upload the downloaded JSON file instead.`;
  window.open(
    `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
    "_blank",
    "noopener,noreferrer",
  );
});

document.querySelector("#path-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const from = pathInputNode(pathFrom);
  const to = pathInputNode(pathTo);
  if (!from || !to) {
    document.querySelector("#path-result").textContent =
      "Choose a listed person, project, or release in both fields.";
    return;
  }
  const path = shortestPath(from.node.id, to.node.id);
  const aliases = [from, to]
    .filter(({ isAlias }) => isAlias)
    .map(
      ({ matchedName, node }) =>
        `<strong>${escapeHtml(matchedName)}</strong> is ${escapeHtml(node.label)}.`,
    );
  document.querySelector("#path-result").innerHTML = path
    ? `${aliases.join(" ")}${aliases.length ? " " : ""}Browser explanation: <strong>${path.map((id) => escapeHtml(labelFor(id))).join(" → ")}</strong>. This is the shortest recorded connection in the local map; select a sphere to inspect roles and provenance status.`
    : "No connecting path has been recorded in this seed graph.";
  if (path) {
    highlightedPath = path;
    selectNode(path[0]);
    highlightedPath = path;
    renderGraph();
  }
});
document.querySelectorAll("[data-type-toggle]").forEach((button) =>
  button.addEventListener("click", () => {
    const type = button.dataset.typeToggle;
    // Keep at least one category visible. A blank canvas does not communicate
    // what the toggle state means and cannot be explored.
    if (activeTypes.has(type) && activeTypes.size === 1) {
      status.textContent = "Keep at least one sphere type visible.";
      return;
    }
    if (activeTypes.has(type)) activeTypes.delete(type);
    else activeTypes.add(type);
    highlightedPath = [];
    button.classList.toggle("active", activeTypes.has(type));
    button.setAttribute("aria-pressed", String(activeTypes.has(type)));
    renderGraph();
  }),
);
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
document
  .querySelector("[data-action='rearrange']")
  .addEventListener("click", () => {
    graphPan = { x: 0, y: 0 };
    graphZoom = zoomRange.fit;
    zoomSlider.value = graphZoom;
    zoomValue.textContent = `${Math.round(graphZoom * 100)}%`;
    renderGraph();
  });
document
  .querySelector("[data-action='dimension']")
  .addEventListener("click", (event) => {
    dimension = dimension === "2d" ? "3d" : "2d";
    event.currentTarget.textContent =
      dimension === "3d" ? "3D / 2D" : "2D / 3D";
    event.currentTarget.classList.toggle("active", dimension === "3d");
    event.currentTarget.setAttribute(
      "aria-pressed",
      String(dimension === "3d"),
    );
    renderGraph();
  });
sizeMetric.addEventListener("change", renderGraph);
degreeLimit.addEventListener("change", renderGraph);
fadeDistance.addEventListener("change", renderGraph);
search.addEventListener("input", () => {
  if (!searchAndSelect(false)) renderGraph();
});
search.addEventListener("change", () => searchAndSelect(true));
search.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && searchAndSelect(true)) event.preventDefault();
  if (event.key === "Escape") resetSelection({ clearSearch: true });
});
yearSlider.addEventListener("input", () => {
  activeYear = Number(yearSlider.value);
  yearValue.textContent = activeYear;
  focusedEdge = null;
  renderGraph();
});
zoomSlider.addEventListener("input", () =>
  setGraphZoom(Number(zoomSlider.value)),
);
document
  .querySelector("[data-action='zoom-in']")
  .addEventListener("click", () => setGraphZoom(graphZoom * 1.35));
document
  .querySelector("[data-action='zoom-out']")
  .addEventListener("click", () => setGraphZoom(graphZoom / 1.35));
document
  .querySelector("[data-action='zoom-reset']")
  .addEventListener("click", () => {
    graphPan = { x: 0, y: 0 };
    setGraphZoom(zoomRange.fit);
  });
document
  .querySelector("[data-action='clear-selection']")
  .addEventListener("click", () => resetSelection({ clearSearch: true }));
document.querySelector("[data-action='compare']").addEventListener("click", () => {
  if (selectedId) compareFirst.value = labelFor(selectedId);
  compareDialog.showModal();
  compareSecond.focus();
});
document.querySelector("[data-close-compare]").addEventListener("click", () => compareDialog.close());
document.querySelector("#compare-form").addEventListener("submit", (event) => {
  event.preventDefault();
  compareNodes();
});
function updateFullscreenControls() {
  const isFullscreen = document.fullscreenElement === graphPanel;
  fullscreenButton.textContent = isFullscreen
    ? "Exit full screen"
    : "Full screen";
  fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
}

async function toggleFullscreen() {
  if (document.fullscreenElement === graphPanel)
    await document.exitFullscreen();
  else await graphPanel.requestFullscreen();
}

fullscreenButton.addEventListener("click", () => {
  toggleFullscreen().catch(() => {
    status.textContent =
      "Full screen is unavailable in this browser. You can still pan and zoom the map.";
  });
});
document.addEventListener("fullscreenchange", () => {
  updateFullscreenControls();
  window.requestAnimationFrame(renderGraph);
});
window.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() !== "f" ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.target.matches("input, select, textarea, button")
  )
    return;
  event.preventDefault();
  toggleFullscreen().catch(() => {
    status.textContent =
      "Full screen is unavailable in this browser. You can still pan and zoom the map.";
  });
});
const refreshForViewport = () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(renderGraph, 80);
};
new ResizeObserver(refreshForViewport).observe(graphPanel);
window.addEventListener("resize", refreshForViewport);
populatePathSelects();
updateFullscreenControls();
renderGraph();
