import { defineConfig, type Plugin } from "vite";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Lists public/art/*.png so dropped-in sprites are picked up with no code changes and no 404 probing. */
function artSprites(): Plugin {
  const id = "virtual:art-sprites";
  const resolvedId = "\0" + id;
  const dir = resolve(__dirname, "public/art");
  return {
    name: "art-sprites",
    resolveId(source) { return source === id ? resolvedId : null; },
    load(source) {
      if (source !== resolvedId) return null;
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort() : [];
      return `export default ${JSON.stringify(files)};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const reload = () => {
        const mod = server.moduleGraph.getModuleById(resolvedId);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", (f) => f.startsWith(dir) && reload());
      server.watcher.on("unlink", (f) => f.startsWith(dir) && reload());
    }
  };
}

export default defineConfig({ plugins: [artSprites()], build: { target: "es2022" } });
