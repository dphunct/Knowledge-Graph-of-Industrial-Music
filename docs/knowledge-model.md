# Knowledge model

This is an industrial-music knowledge graph, not a general music database.

## Scope

- `core` projects are industrial or recognized industrial subgenres and may be recursively expanded.
- `adjacent` projects provide meaningful crossover context with deliberately limited recursion.
- `boundary` projects explain a connection but terminate expansion into another high-level genre.

## Facts

People, projects, releases, and songs are distinct nodes. Roles, aliases, and dates belong on the relationship where they apply. `validFrom` and `validTo` are structured years for future temporal views; missing dates mean unresearched, not timeless.

Every edge carries a `sourceStatus`. A future `provenance` array will hold source URLs, citations, and notes for individually verified facts. Until then, `needs-citation` is an explicit research queue.

## MusicBrainz enrichment

`npm run enrich:musicbrainz` is a read-only, rate-limited research pass over the graph's current people, projects, and releases. It paces requests at 1.1 seconds, keeps only a bounded number of related records per entity, and saves two most-recent runs in `data/musicbrainz-enrichment.json`. Use `node scripts/enrich-musicbrainz.mjs --apply` only after two completed runs agree on an exact entity match; it writes a MusicBrainz identity and source link to existing nodes. It never automatically promotes discovered relationships into canonical graph facts.

## Answers and influence

Shortest paths and neighborhoods are graph-algorithm results. Browser-generated prose explains that result but does not invent connections. Graph influence is structural rather than an editorial claim of artistic influence; its constituent metrics remain inspectable in the interface.
