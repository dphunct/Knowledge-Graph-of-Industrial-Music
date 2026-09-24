import { cp, mkdir } from "node:fs/promises";

const source = new URL("../data/industrial-graph.json", import.meta.url);
const destination = new URL("../public/data/industrial-graph.json", import.meta.url);
await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await cp(source, destination);
