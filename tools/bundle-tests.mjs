#!/usr/bin/env node
// Bundles the game core for node:test. A tiny plugin stands in for Vite's virtual sprite list so the
// visual-registry swap contract can be tested with a fake sprite file and a stubbed Image.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync(".sim", { recursive: true });
await build({
  entryPoints: ["src/sim/test-api.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".sim/test-api.mjs",
  logLevel: "error",
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [{
    name: "virtual-art",
    setup(b) {
      b.onResolve({ filter: /^virtual:art-sprites$/ }, () => ({ path: "virtual-art", namespace: "virt" }));
      b.onLoad({ filter: /.*/, namespace: "virt" }, () => ({ contents: 'export default ["petitioner.farmer.png"];', loader: "js" }));
    }
  }]
});
