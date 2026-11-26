import { readFileSync } from "node:fs";
import { loadOrBuildIndex } from "./indexer.mjs";
import { matchSkills } from "./matcher.mjs";
import { getConfigPath, getDataDir, hasPostToolHook } from "./paths.mjs";
import { loadHealthFeedback, loadStats, recordHealthFeedback } from "./state.mjs";

const PROTOCOL_VERSION = "2024-11-05";

function getTools() {
  return [
    {
      name: "search_skills",
      description:
        "Search local and off-prompt Antigravity skills by task description or keywords. Returns top matching SKILL.md paths, relevance scores, and any outdated/deprecated health warnings.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Task description, symptom, or domain keywords (English or Chinese).",
          },
          limit: {
            type: "integer",
            description: "Max results to return (default 5, max 10).",
          },
          workspace_path: {
            type: "string",
            description: "Optional active workspace path for project-signal boosting.",
          },
          kind: {
            type: "string",
            enum: ["all", "off_prompt", "installed"],
            description: "Filter skill pool: all, off_prompt (vault/folded), or installed.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "list_skill_domains",
      description:
        "List all indexed skills grouped by source/kind (vault, folded, installed, workspace) with health warning flags.",
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["all", "off_prompt", "installed"],
            description: "Optional filter by pool kind.",
          },
          workspace_path: {
            type: "string",
            description: "Optional active workspace path to include repo-local .agents/skills.",
          },
        },
      },
    },
    {
      name: "report_skill_issue",
      description:
        "Report that a skill appears outdated, broken, deprecated, or redundant during execution so future turns warn the user and stop auto-invoking it.",
      inputSchema: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "Exact name of the skill.",
          },
          issue_type: {
            type: "string",
            enum: ["outdated", "broken", "deprecated", "redundant"],
            description: "Category of problem observed.",
          },
          reason: {
            type: "string",
            description: "Concise evidence of why the skill is outdated or unusable.",
          },
          suggestion: {
            type: "string",
            description: "Optional replacement skill or recommended fix.",
          },
        },
        required: ["skill_name", "issue_type", "reason"],
      },
    },
  ];
}

function loadContext() {
  const config = JSON.parse(readFileSync(getConfigPath(), "utf8"));
  const dataDir = getDataDir();
  const stats = loadStats(dataDir);
  const feedback = loadHealthFeedback(dataDir);
  return { config, dataDir, stats, feedback };
}

function handleToolCall(name, args = {}) {
  const { config, dataDir, stats, feedback } = loadContext();

  if (name === "search_skills") {
    const query = String(args.query || "").trim();
    if (!query) {
      return { content: [{ type: "text", text: "Error: query must be non-empty." }], isError: true };
    }
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
    const workspacePaths = args.workspace_path ? [String(args.workspace_path)] : [];
    const index = loadOrBuildIndex({ config, dataDir, workspacePaths });
    const res = matchSkills({
      query,
      index,
      config,
      stats,
      feedback,
      workspacePaths,
      kindFilter: args.kind || "all",
      adoptionTrackingEnabled: Boolean(config.adoptionTracking) || hasPostToolHook(),
    });
    const hits = res.all.slice(0, limit);
    if (hits.length === 0) {
      return { content: [{ type: "text", text: `No matching skills found for: "${query}".` }] };
    }
    const lines = hits.map((h) => {
      const warn =
        h.health?.issues?.length > 0
          ? ` | ⚠️ ${h.health.status}: ${h.health.issues[0].detail}`
          : "";
      return `- ${h.name} [${h.kind}, score=${h.score}] -> ${h.path}\n  ${h.description}${warn}`;
    });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "list_skill_domains") {
    const workspacePaths = args.workspace_path ? [String(args.workspace_path)] : [];
    const index = loadOrBuildIndex({ config, dataDir, workspacePaths });
    const filter = args.kind || "all";
    const grouped = new Map();
    let warnCount = 0;

    for (const s of index.skills) {
      if (filter === "off_prompt" && s.kind !== "vault" && s.kind !== "folded") continue;
      if (filter === "installed" && s.kind !== "installed" && s.kind !== "workspace") continue;
      const key = `${s.kind} (${s.sourceLabel})`;
      if (!grouped.has(key)) grouped.set(key, []);
      const flag = s.health?.status && s.health.status !== "healthy" ? " [⚠️]" : "";
      if (flag || feedback?.skills?.[s.name]) warnCount += 1;
      grouped.get(key).push(`${s.name}${flag}`);
    }

    const lines = [];
    for (const [group, names] of grouped.entries()) {
      lines.push(`${group} [${names.length}]: ${names.join(", ")}`);
    }
    lines.push(`Total: ${index.totalDocs} skills (flagged/warnings: ${warnCount}).`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "report_skill_issue") {
    const skillName = String(args.skill_name || "").trim();
    const issueType = String(args.issue_type || "outdated").trim();
    const reason = String(args.reason || "").trim();
    const suggestion = String(args.suggestion || "").trim();

    if (!skillName || !reason) {
      return {
        content: [{ type: "text", text: "Error: skill_name and reason are required." }],
        isError: true,
      };
    }

    recordHealthFeedback(dataDir, { skillName, issueType, reason, suggestion });
    return {
      content: [
        {
          type: "text",
          text: `Recorded ${issueType} issue for skill "${skillName}". Future turns will warn the user and avoid auto-invoking it.`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;

  if (method === "notifications/initialized" || id === undefined) {
    return null;
  }

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "agy-skill-router", version: "0.2.2" },
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: getTools() },
      };
    }

    if (method === "tools/call") {
      const result = handleToolCall(params?.name, params?.arguments);
      return { jsonrpc: "2.0", id, result };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    };
  }
}

let buffer = Buffer.alloc(0);
let useContentLength = false;

function writeMessage(obj) {
  const json = JSON.stringify(obj);
  if (useContentLength) {
    const body = Buffer.from(json, "utf8");
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

function processBuffer() {
  while (buffer.length > 0) {
    const str = buffer.toString("utf8");
    if (str.startsWith("Content-Length:")) {
      useContentLength = true;
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const len = Number(lenMatch[1]);
      const total = headerEnd + 4 + len;
      if (buffer.length < total) return;
      const payload = buffer.slice(headerEnd + 4, total).toString("utf8");
      buffer = buffer.slice(total);
      dispatchRaw(payload);
    } else {
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl).toString("utf8").trim();
      buffer = buffer.slice(nl + 1);
      if (line) dispatchRaw(line);
    }
  }
}

function dispatchRaw(raw) {
  try {
    const msg = JSON.parse(raw);
    const reply = handleMessage(msg);
    if (reply) writeMessage(reply);
  } catch (err) {
    process.stderr.write(`[agy-skill-router mcp] parse error: ${err}\n`);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
  processBuffer();
});

process.stdin.on("error", (err) => {
  process.stderr.write(`[agy-skill-router mcp] stdin error: ${err}\n`);
});
