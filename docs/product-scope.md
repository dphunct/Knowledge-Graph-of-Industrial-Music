# Product scope

The application is an evidence-backed explorer of industrial music—not a universal music database.

- `core`: industrial music or recognized industrial subgenre; expand normally.
- `adjacent`: important crossover or side project; include with deliberately limited recursion.
- `boundary`: included to explain a connection, but do not recurse further into another high-level genre.

Graph influence is a structural measure, not an editorial claim about musical influence. Future versions should expose degree, betweenness, PageRank-like, and cross-community measures separately.

The canonical graph lives in `data/industrial-graph.json`. Every relationship records its roles and citation status. The current file is a seed dataset and intentionally marks facts as `needs-citation` rather than implying that its sources have been fully curated.
