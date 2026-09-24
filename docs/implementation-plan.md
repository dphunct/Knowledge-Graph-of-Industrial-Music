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

## Next: knowledge expansion

1. Add sourced core industrial projects and members using the expansion boundary rules.
2. Add release and song credits without conflating membership and session credits.
3. Add per-fact provenance URLs and confidence notes.
4. Populate relationship validity periods for the future year view.

## Next: explorer depth

The current review chain implements focused relationship context, temporal filtering, orbitable WebGL 3D, and control help. A later refinement should add relationship-specific evidence panels and richer 3D layout controls.

## Next: browser-local explanation

WebLLM is an in-browser WebGPU inference engine with a chat-completion API, not a complete chat UI. The implementation must provide:

1. A user-visible chat/explanation interface, model-load progress, memory/storage disclosure, and unsupported-browser fallback.
2. A small compatible model loaded only after the user opts in; no API key or server is required.
3. A constrained prompt containing only the deterministic graph-query result and provenance, so the model explains but never discovers or invents relationships.
4. The existing deterministic prose as the no-WebGPU/no-model fallback.

## Next: community feedback

1. Add a Feedback section with links to GitHub Issue Forms for correcting or adding information. The form must require at least one cited source URL and ask contributors to distinguish fact, correction, and interpretation.
2. Add a separate Feature request form for ideas that improve the page or explorer.
3. Add a concise contributor note that unsupported factual changes remain in the research queue rather than being silently added to the graph.

## Quality gates

- `npm run validate` must pass before merging data changes.
- `npm run build` must pass before deployment.
- New facts require explicit source status; verified facts add provenance records.
