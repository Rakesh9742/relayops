import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
const result = await build({
  entryPoints: ["src/offline-demo.tsx"],
  bundle: true,
  write: false,
  outfile: "demo.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = result.outputFiles
  .find((f) => f.path.endsWith(".js"))!
  .text.replace(/<\/script/gi, "<\\/script");
const css = result.outputFiles.find((f) => f.path.endsWith(".css"))!.text;
const favicon = Buffer.from(readFileSync("public/favicon.svg")).toString(
  "base64",
);
writeFileSync(
  "preview.html",
  `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#162b25"><link rel="icon" href="data:image/svg+xml;base64,${favicon}"><title>RelayOps — Interactive browser demo</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
);
console.log(
  "Interactive demo: preview.html (browser-local memory, no server or API key required)",
);
