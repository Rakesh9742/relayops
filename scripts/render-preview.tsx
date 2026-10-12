import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { SQLiteStore } from "../server/store";
import { seed, WORKSPACES } from "../server/seed";
import { Engine } from "../server/engine";
import App from "../src/App";
import type { Snapshot } from "../src/types";
const store = new SQLiteStore(":memory:");
await seed(store);
const engine = new Engine(store, 0, false);
const incident = await engine.create("acme", {
  title: "Checkout API is returning elevated errors",
  description:
    "Error rate crossed 10% after the latest traffic spike. Customers are seeing intermittent failures at checkout.",
  severity: "P1",
  scenario: "pool",
});
await engine.action("acme", incident.id, "start");
await engine.step("acme", incident.id);
await engine.step("acme", incident.id);
const state: Snapshot = {
  workspace: WORKSPACES[0],
  workspaces: WORKSPACES,
  nodes: await store.all("acme"),
  edges: await store.edges("acme"),
  backend: "sqlite",
  model: "simulation",
  modelInfo: engine.modelInfo,
  serverStartedAt: Date.now(),
};
const html = renderToStaticMarkup(<App initialState={state} />);
const css = readFileSync("src/styles.css", "utf8");
mkdirSync(".data", { recursive: true });
writeFileSync(
  ".data/visual-preview.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RelayOps — Visual preview</title><style>${css}</style></head><body>${html}</body></html>`,
);
await store.close();
console.log("Static visual preview written to .data/visual-preview.html");
