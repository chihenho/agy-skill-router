import { readFileSync } from "node:fs";
import { loadOrBuildIndex } from "./indexer.mjs";
import { isChitChat, matchSkills } from "./matcher.mjs";
import { getConfigPath, getDataDir } from "./paths.mjs";
import {
  getConversationState,
  hashInput,
  hasRoutedInput,
  loadHealthFeedback,
  loadStats,
  recordRoute,
} from "./state.mjs";

function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => finish(data), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => finish(data));
    process.stdin.on("error", () => finish(""));
  });
}

function formatWarningMarkdown(warnings, lang) {
  if (!warnings || warnings.length === 0) return "";
  const lines = warnings.map((w) => {
    const firstIssue = w.health?.issues?.[0]?.detail || "flagged as outdated or broken";
    return lang === "zh"
      ? `- ⚠️ **不建议直接使用** \`${w.name}\`（${firstIssue}）`
      : `- ⚠️ **Not recommended** \`${w.name}\` (${firstIssue})`;
  });
  return lines.join("\n");
}

function formatCautionInline(item, lang) {
  const warn = item.health?.issues?.[0];
  if (!warn) return "";
  return lang === "zh" ? ` *(⚠️ ${warn.code})*` : ` *(⚠️ ${warn.code})*`;
}

export function buildPreInvocationResponse(payload, { config, dataDir, forceIndex = false } = {}) {
  const rawInput = String(payload?.lastUserInput || "");
  if (isChitChat(rawInput)) return {};

  const input = rawInput.slice(0, 600);
  const conversationId = String(payload?.conversationId || "");
  const inputHash = hashInput(rawInput);
  if (conversationId && hasRoutedInput(dataDir, conversationId, inputHash)) {
    return {};
  }

  const workspacePaths = Array.isArray(payload?.workspacePaths)
    ? payload.workspacePaths
    : payload?.cwd
      ? [payload.cwd]
      : [];

  const index = loadOrBuildIndex({
    config,
    dataDir,
    workspacePaths,
    force: forceIndex,
  });

  const convState = getConversationState(dataDir, conversationId);
  const excludeNames = convState?.injectedSkills || [];
  const stats = loadStats(dataDir);
  const feedback = loadHealthFeedback(dataDir);

  const result = matchSkills({
    query: input,
    index,
    config,
    stats,
    feedback,
    workspacePaths,
    excludeNames,
    includeInstalled: config.includeInstalledSkills !== false,
  });

  const lang = config.lang === "zh" ? "zh" : "en";

  if (result.auto.length > 0) {
    const autoNames = result.auto.map((s) => s.name);
    const skillLines = result.auto.map((s) => {
      const caution = s.health?.issues?.length
        ? ` [caution: ${s.health.issues[0].detail}]`
        : "";
      return `- \`${s.name}\` (${s.kind}, score ${s.score}): read \`${s.path}\`${caution}`;
    });

    const warnLine =
      result.warnings.length > 0
        ? `\nAvoid outdated/broken match(es): ${result.warnings
            .map((w) => `\`${w.name}\` (${w.health.issues[0]?.detail || "outdated"})`)
            .join("; ")}.`
        : "";

    const sysMsg =
      `[agy-skill-router] Matched skill(s) for this request:\n` +
      `${skillLines.join("\n")}\n` +
      `Read the relevant SKILL.md via read_file before acting if it applies. If a skill turns out outdated or broken during execution, call report_skill_issue so future runs warn the user.${warnLine}`;

    const mdHeader =
      lang === "zh"
        ? `> 🎯 **技能路由** 已自动匹配：`
        : `> 🎯 **Skill Router** auto-matched: `;
    const mdItems = result.auto
      .map((s) => `\`${s.name}\` (${Math.round(s.score * 100)}%)${formatCautionInline(s, lang)}`)
      .join("、");
    const warnMd = formatWarningMarkdown(result.warnings, lang);
    const userMarkdown = warnMd ? `${mdHeader}${mdItems}\n${warnMd}` : `${mdHeader}${mdItems}`;

    recordRoute(dataDir, conversationId, inputHash, autoNames, []);
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: sysMsg,
            metadata: { user_markdown: userMarkdown },
          },
        },
      ],
    };
  }

  if (result.recommend.length > 0) {
    const recNames = result.recommend.map((s) => s.name);
    const header =
      lang === "zh"
        ? `> 💡 **技能推荐**（未注入模型，0 上下文开销；如需使用请直接说明技能名）：`
        : `> 💡 **Suggested skills** (0-token UI hint; mention a skill name to activate):`;

    const items = result.recommend.map((s) => {
      const shortDesc = s.description ? s.description.slice(0, 72) : s.kind;
      return `- \`${s.name}\` (${Math.round(s.score * 100)}%)${formatCautionInline(s, lang)} — ${shortDesc}`;
    });
    const warnMd = formatWarningMarkdown(result.warnings, lang);
    const userMarkdown = [header, ...items, warnMd].filter(Boolean).join("\n");

    recordRoute(dataDir, conversationId, inputHash, [], recNames);
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: "",
            metadata: { user_markdown: userMarkdown },
          },
        },
      ],
    };
  }

  if (result.warnings.length > 0) {
    const warnMd = formatWarningMarkdown(result.warnings, lang);
    const explicitHit = result.warnings.some((w) => w.explicitSlash);
    const sysMsg = explicitHit
      ? `[agy-skill-router] Caution: ${result.warnings
          .map((w) => `\`${w.name}\` is flagged (${w.health.issues[0]?.detail || "outdated/deprecated"})`)
          .join("; ")}. Prefer an updated alternative or verify before following it.`
      : "";

    recordRoute(dataDir, conversationId, inputHash, [], []);
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: sysMsg,
            metadata: { user_markdown: warnMd },
          },
        },
      ],
    };
  }

  recordRoute(dataDir, conversationId, inputHash, [], []);
  return {};
}

async function runCli() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      process.stdout.write("{}");
      return;
    }
    const payload = JSON.parse(raw);
    const config = JSON.parse(readFileSync(getConfigPath(), "utf8"));
    const dataDir = getDataDir();
    const out = buildPreInvocationResponse(payload, { config, dataDir });
    process.stdout.write(JSON.stringify(out));
  } catch {
    process.stdout.write("{}");
  }
}

const isEntry =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());

if (isEntry) {
  runCli();
}
