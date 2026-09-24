# Implementation plan

Status is evidence-based: **done** means merged and built; **next** means agreed but not yet implemented.

## In review

The following pull requests implement the current application work and must be merged in order:

1. #11 — interaction fixes, responsive layout, and this plan.
2. #12 — expanded edge context, control help, and structured feedback forms.
3. #13 — WebGL 3D view with orbit controls and the year slider.
4. #14 — opt-in, browser-local WebLLM explainer with deterministic fallback.

## Done

- Static GitHub Pages application and deployment workflow.
- Portable JSON graph with distinct people, projects, releases, and songs.
- Roles, aliases, relevance classes, temporal fields, and provenance-status conventions.
- 2D force-directed exploration, node dragging, graph metrics, path finding, and optional depth view.
- Original Wax Trax meme asset and attribution.

## Current refinement

- Name-only graph nodes and a graph-first wide layout.
- Everything, people, projects, and releases filters.
- Compound relationships in filtered views and focused edge context.
- Selected-node neighborhood fading, edge inspection, canvas reset, and control help.
- Responsive phone through extra-large layouts.
- **In progress:** a viewport-aware visualization pass: stronger edges, type-aware node gradients, drag-to-pan on dense canvases, and a rearrange action that resets around the active viewport and filters.

## Next: knowledge expansion

1. Add sourced core industrial projects and members using the expansion boundary rules.
2. Add release and song credits without conflating membership and session credits.
3. Add per-fact provenance URLs and confidence notes.
4. Populate relationship validity periods for the future year view.

## Next: explorer depth

The current review chain implements focused relationship context, temporal filtering, orbitable WebGL 3D, and control help. A later refinement should add relationship-specific evidence panels and richer 3D layout controls.

1. Add an accessible zoom bar with explicit zoom-in, zoom-out, and reset controls. It scales the 2D graph without changing the underlying data and maps to camera distance in 3D while preserving selected node or edge context. **Implemented in the next review PR.**

## Next: browser-local explanation

The optional answer helper should feel like a simple way to ask about what is currently on screen. It should make clear that it can only work from the graph's recorded information.

1. Use plain prompts such as “What is your question?” and “Ask,” with friendly progress and browser-support messages.
2. Keep answers grounded in the selected node, edge, or path. When the graph cannot answer, say: “I am only a simple bot with limited resources and can't handle this request.”
3. Keep the helper optional and keep the graph usable when it is unavailable.
4. **Future feature:** offer an opt-in “Ask ChatGPT” path that sends the user's question and the relevant cited graph data to ChatGPT for more complex reasoning. Explain what data will be shared before sending it, and keep ChatGPT answers visually distinct from recorded graph facts.

## Next: visualization UX pass

1. Make edges more legible with thicker default strokes and stronger selected-path contrast.
2. Give node bodies subtle type-aware gradients while retaining accessible label contrast.
3. Repair and test panning across mouse and touch input, including zoomed mobile views.
4. Change “Rearrange” so it fits and optimizes the layout for the current viewport and active filters, rather than reusing the original canvas bounds.

## Next: community feedback

1. Add a Feedback section with links to GitHub Issue Forms for correcting or adding information. The form must require at least one cited source URL and ask contributors to distinguish fact, correction, and interpretation.
2. Add a separate Feature request form for ideas that improve the page or explorer.
3. Add a concise contributor note that unsupported factual changes remain in the research queue rather than being silently added to the graph.

## Later version: generic MusicBrainz visualizer

Build a separate, provider-aware MusicBrainz visualizer that begins with a user-selected entity and expands only at the user's request. It must distinguish MusicBrainz artists, release groups, releases, recordings, and works; pace requests to provider policy; label all live results as unreviewed session data; and provide a deliberate route for promoting cited facts into a curated graph.

## Quality gates

- `npm run validate` must pass before merging data changes.
- `npm run build` must pass before deployment.
- New facts require explicit source status; verified facts add provenance records.
