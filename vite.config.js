import { defineConfig } from "vite";

// GitHub Pages project sites are served from /<repository-name>/, while local
// development continues to use the root path.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/Knowledge-Graph-of-Industrial-Music/" : "/"
});
