#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateRuntimeHealth } from "./health.mjs";
import { buildPreInvocationResponse } from "./hook-pre-invocation.mjs";
import { loadOrBuildIndex } from "./indexer.mjs";
import { matchSkills } from "./matcher.mjs";
import { getConfigPath, getDataDir, getPluginRoot, hasPostToolHook } from "./paths.mjs";
import { clearHealthFeedback, loadHealthFeedback, loadStats } from "./state.mjs";

function loadConfig() {
  return JSON.parse(readFileSync(getConfigPath(), "utf8"));
}

function printHelp() {
  console.log(
    "Usage: node src/cli.mjs <command> [args]\n" +
      "Commands:\n" +
      "  index                 Rebuild the skill index cache\n" +
      "  test \"<query>\"        Test matching + simulated PreInvocation output [--cwd <dir>]\n" +
      "  list                  List all indexed skills\n" +
      "  stats                 Show skill exposure & adoption statistics\n" +
      "  audit                 Audit outdated, broken, unadapted, or low-adoption skills\n" +
      "  clear-issue <skill>   Clear a recorded health issue for a skill\n" +
      "  doctor                Validate config, hooks, mcp_config, and measure latency"
  );
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const dataDir = getDataDir();

  if (cmd === "index") {
    const index = loadOrBuildIndex({ config, dataDir, force: true });
    const byKind = {};
    for (const s of index.skills) {
      byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    }
    console.log(`Indexed ${index.totalDocs} skills -> ${join(dataDir, "index.json")}`);
    console.log("By kind:", byKind);
    return;
  }

  if (cmd === "list") {
    const index = loadOrBuildIndex({ config, dataDir });
    for (const s of index.skills) {
      const flag = s.health?.status !== "healthy" ? ` [${s.health.status}]` : "";
      console.log(`${s.name.padEnd(34)} ${s.kind.padEnd(10)} ${s.path}${flag}`);
    }
    console.log(`\nTotal: ${index.totalDocs}`);
    return;
  }

  if (cmd === "stats") {
    const stats = loadStats(dataDir);
    const entries = Object.entries(stats.skills || {});
    if (entries.length === 0) {
      console.log("No routing/adoption stats recorded yet.");
      return;
    }
    entries.sort((a, b) => (b[1].adoptedCount || 0) - (a[1].adoptedCount || 0));
    for (const [name, row] of entries) {
      const total = (row.autoCount || 0) + (row.recommendCount || 0);
      console.log(
        `${name.padEnd(34)} auto=${row.autoCount || 0} rec=${row.recommendCount || 0} adopted=${row.adoptedCount || 0} (total=${total})`
      );
    }
    return;
  }

  if (cmd === "audit") {
    const index = loadOrBuildIndex({ config, dataDir, force: true });
    const stats = loadStats(dataDir);
    const feedback = loadHealthFeedback(dataDir);
    const adoptionTrackingEnabled = Boolean(config.adoptionTracking) || hasPostToolHook();
    const flagged = [];

    for (const skill of index.skills) {
      const health = evaluateRuntimeHealth({
        skill,
        stats,
        feedback,
        config,
        adoptionTrackingEnabled,
      });
      if (health.issues.length > 0) {
        flagged.push({ skill, health });
      }
    }

    if (flagged.length === 0) {
      console.log(`Audit passed: all ${index.totalDocs} skills are healthy.`);
      return;
    }

    console.log(`Audit found ${flagged.length}/${index.totalDocs} skill(s) needing attention:\n`);
    for (const { skill, health } of flagged) {
      console.log(`- ${skill.name} [${health.status.toUpperCase()}] (${skill.kind}) -> ${skill.path}`);
      for (const issue of health.issues) {
        console.log(`    * ${issue.code}: ${issue.detail}`);
      }
    }
    return;
  }

  if (cmd === "clear-issue") {
    const target = args[1];
    if (!target) {
      console.error("Usage: node src/cli.mjs clear-issue <skill>");
      process.exit(1);
    }
    const ok = clearHealthFeedback(dataDir, target);
    console.log(ok ? `Cleared reported issue for ${target}.` : `No recorded issue for ${target}.`);
    return;
  }

  if (cmd === "test") {
    let cwd = process.cwd();
    const queryParts = [];
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === "--cwd" && args[i + 1]) {
        cwd = resolve(args[i + 1]);
        i += 1;
      } else {
        queryParts.push(args[i]);
      }
    }
    const query = queryParts.join(" ").trim();
    if (!query) {
      console.error('Usage: node src/cli.mjs test "<query>" [--cwd <dir>]');
      process.exit(1);
    }

    const t0 = performance.now();
    const index = loadOrBuildIndex({ config, dataDir, workspacePaths: [cwd] });
    const stats = loadStats(dataDir);
    const feedback = loadHealthFeedback(dataDir);
    const adoptionTrackingEnabled = Boolean(config.adoptionTracking) || hasPostToolHook();
    const res = matchSkills({
      query,
      index,
      config,
      stats,
      feedback,
      workspacePaths: [cwd],
      adoptionTrackingEnabled,
    });
    const hookOut = buildPreInvocationResponse(
      { lastUserInput: query, workspacePaths: [cwd], cwd },
      { config, dataDir }
    );
    const ms = (performance.now() - t0).toFixed(2);

    console.log(`Query  : ${query}`);
    console.log(`Tier   : ${res.tier} (${ms} ms, pool=${index.totalDocs})`);
    console.log("Top hits:");
    for (const h of res.all.slice(0, 5)) {
      const flag = h.health.status !== "healthy" ? ` [⚠️ ${h.health.status}]` : "";
      console.log(
        `  - ${h.name.padEnd(30)} score=${h.score} kind=${h.kind} (${h.reasons.join(" ")})${flag}`
      );
    }
    console.log("\nSimulated PreInvocation stdout:");
    console.log(JSON.stringify(hookOut, null, 2));
    return;
  }

  if (cmd === "doctor") {
    const root = getPluginRoot();
    const required = ["router.config.json", "hooks.json", "plugin.json"];
    for (const file of required) {
      const full = join(root, file);
      const ok = existsSync(full);
      console.log(`${ok ? "OK  " : "MISS"} ${full}`);
    }
    const mcpPath = join(root, "mcp_config.json");
    console.log(`${existsSync(mcpPath) ? "OK  " : "OPT "} ${mcpPath}`);

    const t0 = performance.now();
    const index = loadOrBuildIndex({ config, dataDir, force: true });
    const stats = loadStats(dataDir);
    const feedback = loadHealthFeedback(dataDir);
    const adoptionTrackingEnabled = Boolean(config.adoptionTracking) || hasPostToolHook();
    matchSkills({
      query: "review my changes for risks",
      index,
      config,
      stats,
      feedback,
      adoptionTrackingEnabled,
    });
    const ms = (performance.now() - t0).toFixed(2);
    console.log(`Data dir : ${dataDir}`);
    console.log(`Index + match latency: ${ms} ms (${index.totalDocs} skills, lang=${config.lang}, adoptionTracking=${adoptionTrackingEnabled})`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main();
