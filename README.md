# Knowledge Graph of Industrial Music

Wax Trax posted it as a meme.

I made the first iteration.  If you know how GitHub works, and have something to contribute, let me know.

## Cloud development

This repository is ready for [GitHub Codespaces](https://github.com/features/codespaces).
Open the repository in a Codespace, then run:

```sh
npm run dev
```

Codespaces automatically forwards the preview on port 4173. Run `npm run build` to create a production build in `dist/`.

## The graph

The first working explorer is a static Vite application. It reads its portable graph from `data/industrial-graph.json`; no database, server, or hosted application is required. Run `npm run validate` before changing graph data, then `npm run dev` to explore it locally.

The seed graph is intentionally small and labels every relationship as `needs-citation` until its evidence is curated. See `docs/product-scope.md` for the industrial relevance boundary and data rules.
