# Knowledge model

This is an industrial-music knowledge graph, not a general music database.

## Scope

- `core` projects are industrial or recognized industrial subgenres and may be recursively expanded.
- `adjacent` projects provide meaningful crossover context with deliberately limited recursion.
- `boundary` projects explain a connection but terminate expansion into another high-level genre.

## Facts

People, projects, releases, and songs are distinct nodes. Roles, aliases, and dates belong on the relationship where they apply. `validFrom` and `validTo` are structured years for future temporal views; missing dates mean unresearched, not timeless.

Every edge carries a `sourceStatus` and every verified edge includes provenance: source URL, citation title, and a short note. `needs-citation` is an explicit research queue.

## Source policy

No single database is the graph's authority. MusicBrainz supplies structured credits and release identities; Wikidata supplies independently maintained cross-references and exact, mapped relationship claims. Official artist, label, and release pages can be cited for facts that are not present in those databases. Discogs is a useful discography cross-reference, but its API requires attribution and credentials for richer retrieval, so it is linked rather than bulk-imported until that integration is explicitly configured.

Automated imports may only add a relationship when both endpoints resolve exactly to existing canonical identities and a source URL is retained on that relationship. Other sources may create a reviewable research candidate, never an inferred fact.

## Answers and influence

Shortest paths and neighborhoods are graph-algorithm results. Browser-generated prose explains that result but does not invent connections. Graph influence is structural rather than an editorial claim of artistic influence; its constituent metrics remain inspectable in the interface.

Industrial contribution is a source-constrained metric that values person-to-project work above catalog size. Its complete person, project, release, and composite formulas are documented in `scoring-model.md`. Membership alone never implies that a person performed on every project release. Unknown dates and unavailable individual release credits remain unknown rather than being estimated.
