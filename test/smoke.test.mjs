import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectSkillHealth } from "../src/health.mjs";
import { loadOrBuildIndex } from "../src/indexer.mjs";
import { matchSkills } from "../src/matcher.mjs";
import { tokenize, tokenizeQuery } from "../src/tokenizer.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "agy-router-test-"));
  const vaultDir = join(root, "vault");
  const wsDir = join(root, "workspace");
  const dataDir = join(root, "data");
  const pluginRoot = join(root, "plugin");

  mkdirSync(join(vaultDir, "blast-radius"), { recursive: true });
  mkdirSync(join(vaultDir, "wechatide-skill"), { recursive: true });
  mkdirSync(join(vaultDir, "old-cursor-skill"), { recursive: true });
  mkdirSync(join(vaultDir, "legacy-deprecated"), { recursive: true });
  mkdirSync(join(wsDir, ".agents", "skills", "repo-release"), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(pluginRoot, { recursive: true });

  writeFileSync(
    join(vaultDir, "blast-radius", "SKILL.md"),
    `---\nname: blast-radius\ndescription: "Find what a small change could break before shipping beyond the diff."\n---\n# Blast Radius\nCheck callers and runtime impact.\n`,
    "utf8"
  );

  writeFileSync(
    join(vaultDir, "wechatide-skill", "SKILL.md"),
    `---\nname: wechatide-skill\ndescription: "WeChat MiniProgram CLI automation, build preview, and simulator debugging."\n---\n# WeChat MiniProgram\nRun miniprogram preview.\n`,
    "utf8"
  );
  writeFileSync(join(wsDir, "project.config.json"), '{"appid":"wx123"}\n', "utf8");

  writeFileSync(
    join(vaultDir, "old-cursor-skill", "SKILL.md"),
    `---\nname: old-cursor-skill\ndescription: "Old workflow referencing missing doc and Cursor AskQuestion tool."\n---\n# Old Cursor Skill\nRead [missing](./does-not-exist.md) and call AskQuestion with ~/.cursor/rules/foo.mdc.\n`,
    "utf8"
  );

  writeFileSync(
    join(vaultDir, "legacy-deprecated", "SKILL.md"),
    `---\nname: legacy-deprecated\ndescription: "Legacy deployment helper for v1."\ndeprecated: true\n---\n# Legacy Deprecated\nDo not use.\n`,
    "utf8"
  );

  writeFileSync(
    join(wsDir, ".agents", "skills", "repo-release", "SKILL.md"),
    `---\nname: repo-release\ndescription: "Cut a release tag and verify package checksums for this repo."\n---\n# Repo Release\nRun release script.\n`,
    "utf8"
  );

  const config = {
    lang: "zh",
    autoThreshold: 0.55,
    recommendThreshold: 0.32,
    autoMax: 2,
    recommendMax: 3,
    indexTtlSeconds: 300,
    staleDays: 180,
    lowAdoptionMinExposures: 6,
    lowAdoptionMaxRate: 0.15,
    includeInstalledSkills: true,
    includePrinciples: false,
    sources: [{ path: vaultDir, kind: "vault" }],
    workspaceSignals: {
      "project.config.json": ["wechatide", "wechat", "miniprogram"],
    },
    excludeSkills: ["agy-skill-router"],
  };
  writeFileSync(join(pluginRoot, "router.config.json"), JSON.stringify(config, null, 2), "utf8");

  return { root, vaultDir, wsDir, dataDir, pluginRoot, config };
}

test("tokenizer handles hyphenated English, CJK bigrams, and bilingual synonyms", () => {
  const tokens = tokenize("blast-radius 微信小程序");
  assert.ok(tokens.includes("blast-radius"));
  assert.ok(tokens.includes("blast"));
  assert.ok(tokens.includes("微信"));
  assert.ok(tokens.includes("程序"));

  const q = tokenizeQuery("帮我看看这次改动的影响范围");
  assert.ok(q.terms.has("blast-radius"));
});

test("indexer & health inspection flag broken refs, unadapted harness, and deprecated skills", () => {
  const fx = createFixture();
  try {
    const index = loadOrBuildIndex({
      config: fx.config,
      dataDir: fx.dataDir,
      workspacePaths: [fx.wsDir],
      force: true,
    });
    assert.equal(index.totalDocs, 5);

    const oldCursor = index.skills.find((s) => s.name === "old-cursor-skill");
    assert.equal(oldCursor.health.status, "warning");
    const codes = oldCursor.health.issues.map((i) => i.code);
    assert.ok(codes.includes("broken_local_refs"));
    assert.ok(codes.includes("unadapted_foreign_harness"));

    const deprecatedSkill = index.skills.find((s) => s.name === "legacy-deprecated");
    assert.equal(deprecatedSkill.health.status, "deprecated");

    const healthyCheck = inspectSkillHealth({
      description: "Valid comprehensive skill description here.",
      rawBody: "# Valid\nWorks with Antigravity.",
      skillMdPath: join(fx.vaultDir, "blast-radius", "SKILL.md"),
      deprecated: false,
      mtimeMs: Date.now(),
      config: fx.config,
    });
    assert.equal(healthyCheck.status, "healthy");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("matcher handles explicit slash, workspace boost, chit-chat, and blocks deprecated auto-invoke", () => {
  const fx = createFixture();
  try {
    const index = loadOrBuildIndex({
      config: fx.config,
      dataDir: fx.dataDir,
      workspacePaths: [fx.wsDir],
      force: true,
    });

    const slashHit = matchSkills({
      query: "/blast-radius check this PR",
      index,
      config: fx.config,
    });
    assert.equal(slashHit.tier, "auto");
    assert.equal(slashHit.auto[0].name, "blast-radius");

    const wsHit = matchSkills({
      query: "运行一下小程序预览构建",
      index,
      config: fx.config,
      workspacePaths: [fx.wsDir],
    });
    assert.equal(wsHit.tier, "auto");
    assert.equal(wsHit.auto[0].name, "wechatide-skill");

    const depHit = matchSkills({
      query: "/legacy-deprecated deploy v1",
      index,
      config: fx.config,
    });
    assert.equal(depHit.auto.length, 0);
    assert.equal(depHit.warnings[0].name, "legacy-deprecated");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("PreInvocation & PostToolUse hooks handle auto, dedup, 0-token recommend, chit-chat, and read adoption", () => {
  const fx = createFixture();
  try {
    loadOrBuildIndex({
      config: fx.config,
      dataDir: fx.dataDir,
      workspacePaths: [fx.wsDir],
      force: true,
    });

    const env = {
      ...process.env,
      AGY_ROUTER_ROOT: fx.pluginRoot,
      AGY_ROUTER_DATA: fx.dataDir,
    };

    const runPre = (payload) => {
      const r = spawnSync("node", [join(REPO_ROOT, "src", "hook-pre-invocation.mjs")], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env,
      });
      assert.equal(r.status, 0);
      return JSON.parse(r.stdout);
    };

    // 1. Chit-chat returns {}
    assert.deepEqual(runPre({ conversationId: "c1", lastUserInput: "好的" }), {});

    // 2. Auto match injects compact systemMessage + user_markdown
    const autoRes = runPre({
      conversationId: "c1",
      lastUserInput: "帮我分析这次改动的影响范围 blast-radius",
      workspacePaths: [fx.wsDir],
    });
    assert.equal(autoRes.injectSteps.length, 1);
    assert.ok(autoRes.injectSteps[0].systemMessage.systemMessage.includes("blast-radius"));
    assert.ok(autoRes.injectSteps[0].systemMessage.metadata.user_markdown.includes("blast-radius"));

    // 3. Same input in same conversation deduplicates to {}
    const dupRes = runPre({
      conversationId: "c1",
      lastUserInput: "帮我分析这次改动的影响范围 blast-radius",
      workspacePaths: [fx.wsDir],
    });
    assert.deepEqual(dupRes, {});

    // 4. Recommend tier uses 0-token systemMessage="" + user_markdown
    const recConfig = { ...fx.config, autoThreshold: 0.99, recommendThreshold: 0.25 };
    writeFileSync(join(fx.pluginRoot, "router.config.json"), JSON.stringify(recConfig, null, 2), "utf8");
    const recRes = runPre({
      conversationId: "c2",
      lastUserInput: "cut release checksums",
      workspacePaths: [fx.wsDir],
    });
    assert.equal(recRes.injectSteps[0].systemMessage.systemMessage, "");
    assert.ok(recRes.injectSteps[0].systemMessage.metadata.user_markdown.includes("repo-release"));

    // 5. PostToolUse records adoption on successful read_file
    const postRes = spawnSync("node", [join(REPO_ROOT, "src", "hook-post-tool.mjs")], {
      input: JSON.stringify({
        conversationId: "c1",
        toolCall: {
          name: "read_file",
          args: { Path: join(fx.vaultDir, "blast-radius", "SKILL.md") },
        },
      }),
      encoding: "utf8",
      env,
    });
    assert.equal(postRes.status, 0);
    const stats = JSON.parse(readFileSync(join(fx.dataDir, "stats.json"), "utf8"));
    assert.equal(stats.skills["blast-radius"].adoptedCount, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("MCP server supports search_skills, list_skill_domains, and report_skill_issue", async () => {
  const fx = createFixture();
  try {
    loadOrBuildIndex({
      config: fx.config,
      dataDir: fx.dataDir,
      workspacePaths: [fx.wsDir],
      force: true,
    });

    const child = spawn("node", [join(REPO_ROOT, "src", "mcp-server.mjs")], {
      env: {
        ...process.env,
        AGY_ROUTER_ROOT: fx.pluginRoot,
        AGY_ROUTER_DATA: fx.dataDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses = [];
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) responses.push(JSON.parse(line));
      }
    });

    const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_skills", arguments: { query: "blast-radius" } },
    });
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "report_skill_issue",
        arguments: {
          skill_name: "blast-radius",
          issue_type: "outdated",
          reason: "CLI flag changed in v2",
          suggestion: "Update flag to --json",
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "list_skill_domains", arguments: { workspace_path: fx.wsDir } },
    });

    await new Promise((resolveDone) => {
      const check = setInterval(() => {
        if (responses.length >= 5) {
          clearInterval(check);
          resolveDone();
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        resolveDone();
      }, 3000);
    });

    child.kill();

    assert.equal(responses.length, 5);
    assert.equal(responses[1].result.tools.length, 3);
    assert.ok(responses[2].result.content[0].text.includes("blast-radius"));
    assert.ok(responses[3].result.content[0].text.includes("Recorded outdated issue"));
    assert.ok(responses[4].result.content[0].text.includes("Total: 5 skills"));

    const fb = JSON.parse(readFileSync(join(fx.dataDir, "health-feedback.json"), "utf8"));
    assert.equal(fb.skills["blast-radius"].issueType, "outdated");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
