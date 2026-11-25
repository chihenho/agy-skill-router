#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_PLUGIN_DIR = join(homedir(), ".gemini", "config", "plugins", "agy-skill-router");

const args = process.argv.slice(2);
const cmd = args[0];

function printHelp() {
  console.log(
    "agy-skill-router CLI\n\n" +
      "Usage:\n" +
      "  agy-skill-router install [--lang en|zh] [--target <dir>] [--no-mcp]\n" +
      "  agy-skill-router mcp\n" +
      "  agy-skill-router <index|test|list|stats|audit|clear-issue|doctor> [args...]\n\n" +
      "Examples:\n" +
      "  npx agy-skill-router install --lang zh\n" +
      "  npx agy-skill-router audit\n" +
      "  npx -y agy-skill-router mcp"
  );
}

if (!cmd || cmd === "-h" || cmd === "--help") {
  printHelp();
  process.exit(0);
}

if (cmd === "install") {
  const res = spawnSync(process.execPath, [join(REPO_ROOT, "install.mjs"), ...args.slice(1)], {
    stdio: "inherit",
  });
  process.exit(res.status ?? 0);
}

if (cmd === "mcp") {
  await import("../src/mcp-server.mjs");
} else {
  const env = { ...process.env };
  if (!env.AGY_ROUTER_ROOT) {
    env.AGY_ROUTER_ROOT = existsSync(join(DEFAULT_PLUGIN_DIR, "router.config.json"))
      ? DEFAULT_PLUGIN_DIR
      : REPO_ROOT;
  }
  const res = spawnSync(process.execPath, [join(REPO_ROOT, "src", "cli.mjs"), ...args], {
    stdio: "inherit",
    env,
  });
  process.exit(res.status ?? 0);
}
