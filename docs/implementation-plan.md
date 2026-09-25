# Implementation plan

Status is evidence-based: **done** means merged and built; **next** means agreed but not yet implemented.

## Done

- Static GitHub Pages application and deployment workflow.
- Portable JSON graph with distinct people, projects, releases, and songs.
- Roles, aliases, relevance classes, temporal fields, and provenance-status conventions.
- 2D force-directed exploration, node dragging, graph metrics, path finding, and optional depth view.
- Original Wax Trax meme asset and attribution.
- Default 3D view, independent People / Projects / Releases filters, a 2D
  alternative, and responsive controls from phone through extra-large screens.
- Full-screen mode, viewport-aware rearrangement, unbounded practical zoom,
  tooltips, grouped relationship details, and browser-local path search.
- Browser-local graph-question interpreter, optional WebLLM helper, and an
  opt-in link that opens ChatGPT with the public graph-data URL and question.
- Feedback and feature-request Issue Forms that require cited sources for
  factual corrections.
- Repeatable MusicBrainz roster, discography, release-credit, alias, and
  industrial-project discovery scripts; exact-match Wikidata cross-references.

## In progress: evidence completion

The `audit:evidence` script makes this work measurable. It reports cited and
dated relationship coverage, the remaining research queue, and undated
memberships without treating absent research as an absent fact.

1. Add a cited recording / track-credit source for the remaining seed facts:
   the *The Land of Rape and Honey* → “Stigmata” track listing and the two
   performer / writer / producer credits. Do not infer these from album- or
   artist-level pages.
2. Continue bounded industrial-project and roster expansion under the scope
   rules, preserving exact provider identity and per-fact provenance.
3. Populate membership validity periods only when a cited source provides
   them; retain genuinely undated relationships as explicitly unresearched.

The discovery pass uses a bounded MusicBrainz search for group artists whose canonical record explicitly carries the `industrial` tag. New projects remain unconnected until separate, cited relationship research is available.

## Next: explorer depth

The current review chain implements focused relationship context, temporal filtering, orbitable WebGL 3D, and control help. A later refinement should add relationship-specific evidence panels and richer 3D layout controls.

1. Add relationship-specific evidence panels that make roles, dates, and
   citations easy to scan for every individual connection.
2. Add richer 3D layout controls while preserving free rotation and the same
   filters, selection, and evidence context as 2D.

## Done: browser-local explanation

The optional answer helper should feel like a simple way to ask about what is currently on screen. It should make clear that it can only work from the graph's recorded information.

1. Use plain prompts such as “What is your question?” and “Ask,” with friendly progress and browser-support messages.
2. Keep answers grounded in the selected node, edge, or path. When the graph cannot answer, say: “I am only a simple bot with limited resources and can't handle this request.”
3. Keep the helper optional and keep the graph usable when it is unavailable.
4. The opt-in “Ask ChatGPT” route sends the user's question and a public graph
   data link to the user's own ChatGPT session. A direct API integration is not
   part of this static site.

## Done: visualization UX pass

1. Thicker lines, selected-path contrast, type-aware gradients, touch/mouse
   panning, and viewport-aware rearrangement are implemented. Continue visual
   tuning as graph density increases.

## Done: community feedback

1. Add a Feedback section with links to GitHub Issue Forms for correcting or adding information. The form must require at least one cited source URL and ask contributors to distinguish fact, correction, and interpretation.
2. Add a separate Feature request form for ideas that improve the page or explorer.
3. Add a concise contributor note that unsupported factual changes remain in the research queue rather than being silently added to the graph.

## Later version: generic MusicBrainz visualizer

Build a separate, provider-aware MusicBrainz visualizer that begins with a user-selected entity and expands only at the user's request. It must distinguish MusicBrainz artists, release groups, releases, recordings, and works; pace requests to provider policy; label all live results as unreviewed session data; and provide a deliberate route for promoting cited facts into a curated graph.

## Quality gates

- `npm run validate` must pass before merging data changes.
- `npm run build` must pass before deployment.
- New facts require explicit source status; verified facts add provenance records.
