# Industrial contribution scoring

Scores summarize documented structural contribution in this graph. They are not
claims about artistic quality, fame, or cultural importance.

## Principles

- Person-to-project participation matters more than release-catalog size.
- Releases are useful evidence but have a lower maximum contribution than a
  person or project.
- Missing dates and direct release credits are **unknown**. They are omitted
  from the weighted average instead of being treated as zero.
- Scores recalculate from the visible graph, so filtering changes only the
  comparison set, not the underlying facts.

## Industrial contribution

### People

- 38% distinct documented projects
- 27% average membership tenure as a share of the project's lifespan
- 22% direct release-credit participation as a share of known project releases
- 13% direct connections to other people

Release participation only counts release groups that explicitly credit both
the person and the project. Membership alone never implies performance on every
release.

### Projects

- 28% documented lifespan
- 30% distinct documented contributors
- 20% known release count
- 15% release activity spread across the project's lifespan
- 7% average documented member depth

### Releases

Releases use their documented connections but are capped at 35% of the maximum
industrial-contribution score. This prevents catalog size from outweighing the
people and projects that provide its context.

## Composite score

- 70% industrial contribution
- 20% bridge importance
- 10% weighted PageRank

Bridge importance and PageRank use the same relationship weighting: membership
is strongest, person-to-person relationships are intermediate, and a project's
release catalog contributes one small total unit divided across its releases.
