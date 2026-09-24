# Knowledge model

This is an industrial-music knowledge graph, not a general music database.

## Scope

- `core` projects are industrial or recognized industrial subgenres and may be recursively expanded.
- `adjacent` projects provide meaningful crossover context with deliberately limited recursion.
- `boundary` projects explain a connection but terminate expansion into another high-level genre.

## Facts

People, projects, releases, and songs are distinct nodes. Roles, aliases, and dates belong on the relationship where they apply. `validFrom` and `validTo` are structured years for future temporal views; missing dates mean unresearched, not timeless.

Every edge carries a `sourceStatus`. A future `provenance` array will hold source URLs, citations, and notes for individually verified facts. Until then, `needs-citation` is an explicit research queue.

## Answers and influence

Shortest paths and neighborhoods are graph-algorithm results. Browser-generated prose explains that result but does not invent connections. Graph influence is structural rather than an editorial claim of artistic influence; its constituent metrics remain inspectable in the interface.
