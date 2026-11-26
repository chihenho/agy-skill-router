#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRuntimeHealth } from "./src/health.mjs";
import { loadOrBuildIndex } from "./src/indexer.mjs";
import { resolvePluginDataDir } from "./src/paths.mjs";
import { loadHealthFeedback, loadStats } from "./src/state.mjs";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
const DEFAULT_TARGET = join(homedir(), ".gemini", "config", "plugins", "agy-skill-router");
const DEFAULT_VAULT = join(homedir(), ".gemini", "skill-vault");

function normalizeLang(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "en") return "en";
  if (v === "zh" || v === "zh-cn" || v === "zh_cn") return "zh";
  throw new Error(`Unsupported --lang value: ${value}. Use "en" or "zh".`);
}

function parseArgs(argv) {
  const opts = {
    lang: null,
    target: DEFAULT_TARGET,
    noMcp: false,
    withPostHook: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lang" && argv[i + 1]) {
      opts.lang = normalizeLang(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--lang=")) {
      opts.lang = normalizeLang(arg.slice("--lang=".length));
    } else if (arg === "--target" && argv[i + 1]) {
      opts.target = resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--no-mcp") {
      opts.noMcp = true;
    } else if (arg === "--with-post-hook") {
      opts.withPostHook = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: node install.mjs [--lang <en|zh>] [--target <path>] [--no-mcp] [--with-post-hook]\n" +
          "  --lang <en|zh>   Plugin & UI recommendation language (default: en)\n" +
          "  --target <path>  Override plugin install path (default: ~/.gemini/config/plugins/agy-skill-router)\n" +
          "  --no-mcp         Install hooks only without registering the minimal MCP server\n" +
          "  --with-post-hook Also register synchronous PostToolUse read_file adoption hook"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = opts.target;

  const baseConfig = JSON.parse(readFileSync(join(REPO_ROOT, "router.config.json"), "utf8"));
  const existingConfigPath = join(target, "router.config.json");
  let finalConfig = { ...baseConfig };

  if (existsSync(existingConfigPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingConfigPath, "utf8"));
      // Migrate older permissive defaults while preserving custom overrides
      if (existing.autoThreshold === 0.62) existing.autoThreshold = baseConfig.autoThreshold;
      if (
        existing.recommendThreshold === 0.36 ||
        existing.recommendThreshold === 0.48 ||
        existing.recommendThreshold === 0.5
      ) {
        existing.recommendThreshold = baseConfig.recommendThreshold;
      }
      if (existing.installedAutoThreshold === 0.86) {
        existing.installedAutoThreshold = baseConfig.installedAutoThreshold;
      }
      if (existing.recommendMax === 3) {
        existing.recommendMax = baseConfig.recommendMax;
      }
      const mergedExclude = new Set([
        ...(Array.isArray(existing.excludeSkills) ? existing.excludeSkills : []),
        ...(baseConfig.excludeSkills || []),
      ]);
      finalConfig = {
        ...baseConfig,
        ...existing,
        adoptionTracking: Boolean(opts.withPostHook),
        excludeSkills: [...mergedExclude],
        sources: Array.isArray(existing.sources) ? existing.sources : baseConfig.sources,
      };
    } catch {
      // Fallback to baseConfig
    }
  }

  const lang = opts.lang || finalConfig.lang || "en";
  finalConfig.lang = lang;
  finalConfig.adoptionTracking = Boolean(opts.withPostHook);

  mkdirSync(target, { recursive: true });
  rmSync(join(target, "src"), { recursive: true, force: true });
  cpSync(join(REPO_ROOT, "src"), join(target, "src"), { recursive: true });

  for (const dirName of ["assets", "skills"]) {
    const srcDir = join(REPO_ROOT, dirName);
    if (existsSync(srcDir)) {
      rmSync(join(target, dirName), { recursive: true, force: true });
      cpSync(srcDir, join(target, dirName), { recursive: true });
    }
  }

  for (const docFile of ["README.md", "README.zh-CN.md", "LICENSE"]) {
    const srcDoc = join(REPO_ROOT, docFile);
    if (existsSync(srcDoc)) {
      cpSync(srcDoc, join(target, docFile));
    }
  }

  writeFileSync(
    join(target, "router.config.json"),
    `${JSON.stringify(finalConfig, null, 2)}\n`,
    "utf8"
  );

  const pluginJson =
    lang === "zh"
      ? {
          name: "agy-skill-router",
          displayName: "技能智能路由 (agy-skill-router)",
          version: PKG_VERSION,
          description:
            "低上下文消耗的 Antigravity 技能自主路由、0-token UI 推荐、过时技能体检与极简 MCP 检索插件。",
          logo: "assets/logo.svg",
          author: { name: "chihenho", url: "https://github.com/chihenho" },
          homepage: "https://github.com/chihenho/agy-skill-router",
          repository: "https://github.com/chihenho/agy-skill-router",
          suggestedPrompts: [
            "运行技能体检看看本地有哪些过时或需要适配的 skill",
            "帮我把不常用的 skill 归档到 skill-vault，降低常驻上下文占用",
            "列出当前已被技能路由索引的全部本地能力",
          ],
        }
      : {
          name: "agy-skill-router",
          displayName: "Skill Router (agy-skill-router)",
          version: PKG_VERSION,
          description:
            "Low-context autonomous skill routing, 0-token UI recommendations, skill health/staleness auditing, and minimal MCP discovery for Antigravity.",
          logo: "assets/logo.svg",
          author: { name: "chihenho", url: "https://github.com/chihenho" },
          homepage: "https://github.com/chihenho/agy-skill-router",
          repository: "https://github.com/chihenho/agy-skill-router",
          suggestedPrompts: [
            "Audit my local skills for outdated, broken, or unadapted entries",
            "List all local skills currently indexed by agy-skill-router",
            "Archive low-frequency skills into ~/.gemini/skill-vault to save context",
          ],
        };

  writeFileSync(
    join(target, "plugin.json"),
    `${JSON.stringify(pluginJson, null, 2)}\n`,
    "utf8"
  );

  const hooksJson = {
    "agy-skill-router-pre": {
      PreInvocation: [
        {
          type: "command",
          command: "node ./src/hook-pre-invocation.mjs",
          timeout: 10,
        },
      ],
    },
  };
  if (opts.withPostHook) {
    hooksJson["agy-skill-router-post"] = {
      PostToolUse: [
        {
          matcher: "read_file",
          hooks: [
            {
              type: "command",
              command: "node ./src/hook-post-tool.mjs",
              timeout: 5,
            },
          ],
        },
      ],
    };
  }
  writeFileSync(
    join(target, "hooks.json"),
    `${JSON.stringify(hooksJson, null, 2)}\n`,
    "utf8"
  );

  const mcpPath = join(target, "mcp_config.json");
  if (opts.noMcp) {
    rmSync(mcpPath, { force: true });
  } else {
    const mcpConfig = {
      mcpServers: {
        router: {
          command: "node",
          args: [join(target, "src", "mcp-server.mjs")],
          cwd: target,
          env: {
            AGY_ROUTER_ROOT: target,
          },
        },
      },
    };
    writeFileSync(mcpPath, `${JSON.stringify(mcpConfig, null, 2)}\n`, "utf8");
  }

  // Create off-prompt skill-vault non-destructively
  if (!existsSync(DEFAULT_VAULT)) {
    mkdirSync(DEFAULT_VAULT, { recursive: true });
    writeFileSync(
      join(DEFAULT_VAULT, "README.txt"),
      "Place off-prompt skill folders (<skill-name>/SKILL.md) here so agy-skill-router discovers and routes them without loading their descriptions into every turn.\n",
      "utf8"
    );
  }

  // Build initial index into unified dataDir
  const dataDir = resolvePluginDataDir(target);
  mkdirSync(dataDir, { recursive: true });
  const index = loadOrBuildIndex({ config: finalConfig, dataDir, force: true });
  const stats = loadStats(dataDir);
  const feedback = loadHealthFeedback(dataDir);

  const byKind = {};
  let warnings = 0;
  for (const s of index.skills) {
    byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    const h = evaluateRuntimeHealth({
      skill: s,
      stats,
      feedback,
      config: finalConfig,
      adoptionTrackingEnabled: Boolean(opts.withPostHook),
    });
    if (h.issues.length > 0) warnings += 1;
  }

  console.log("\n=== agy-skill-router installed ===");
  console.log(`Target   : ${target}`);
  console.log(`Lang     : ${lang}`);
  console.log(`MCP      : ${opts.noMcp ? "disabled (--no-mcp)" : "enabled (3 tools)"}`);
  console.log(`Vault    : ${DEFAULT_VAULT}`);
  console.log(`Indexed  : ${index.totalDocs} skills (${JSON.stringify(byKind)})`);
  console.log(`Warnings : ${warnings} skill(s) flagged (run \`node "${join(target, "src", "cli.mjs")}" audit\` for details)`);
}

main();
