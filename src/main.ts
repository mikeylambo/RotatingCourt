import {
  createGameApp,
  createPuzzleAssembly,
  createArcadeAssembly,
  createCanvas2DStarterAdapter,
  mountBrowserDevConsole
} from "@slu/web-shell";

const rendererAdapter = createCanvas2DStarterAdapter(document.getElementById("game-canvas") as HTMLCanvasElement);

const app = await createGameApp({
  gameId: "rotating-court",
  gameName: "Rotating Court",
  version: "0.1.0",
  renderer: rendererAdapter,
  root: document.getElementById("ui")!,
  assemblies: [
    (shell) => createPuzzleAssembly({ shell }),
    (shell) => createArcadeAssembly({ shell })
  ]
});

if (new URLSearchParams(location.search).get("dev") === "1") {
  mountBrowserDevConsole(app.shell.studio.dev, { title: "Rotating Court DEV" });
}

console.log("SLU game ready", app);
