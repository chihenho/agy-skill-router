import { existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateRuntimeHealth } from "./health.mjs";
import { getAdoptionMultiplier } from "./state.mjs";
import { tokenizeQuery } from "./tokenizer.mjs";

const CHIT_CHAT_SET = new Set([
  "ok", "okay", "k", "yes", "no", "yep", "nope", "sure", "thanks", "thx", "ty",
  "continue", "go", "proceed", "done", "nice", "cool", "great", "good",
  "好的", "好", "行", "可以", "嗯", "哦", "收到", "明白", "了解", "谢谢",
  "继续", "下一步", "开始吧", "没问题", "赞", "不错"
]);

export function isChitChat(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/")) return false;
  if (trimmed.length < 3) return true;
  const normalized = trimmed.toLowerCase().replace(/[.!?,~。！？，～]+$/g, "").trim();
  return CHIT_CHAT_SET.has(normalized);
}

export function detectWorkspaceSignals(workspacePaths = [], signalMap = {}) {
  const active = new Set();
  for (const ws of workspacePaths || []) {
    if (!ws) continue;
    for (const [indicatorFile, keywords] of Object.entries(signalMap || {})) {
      try {
        if (existsSync(join(ws, indicatorFile))) {
          for (const kw of keywords || []) {
            active.add(String(kw).toLowerCase());
          }
        }
      } catch {
        // Ignore unreadable paths
      }
    }
  }
  return active;
}

function bm25TermScore(tf, docFreq, totalDocs, docLen, avgDocLen, k1 = 1.2, b = 0.6) {
  if (!tf || tf <= 0) return 0;
  const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
  const norm = tf + k1 * (1 - b + b * (docLen / Math.max(avgDocLen, 1)));
  return idf * ((tf * (k1 + 1)) / Math.max(norm, 0.001));
}

export function matchSkills({
  query,
  index,
  config = {},
  stats = {},
  feedback = {},
  workspacePaths = [],
  excludeNames = [],
  excludeRecommendNames = [],
  includeInstalled = true,
  kindFilter = "all",
  adoptionTrackingEnabled = Boolean(config?.adoptionTracking),
}) {
  const { terms, rawLower, slashMentions } = tokenizeQuery(query);
  const slashSet = new Set(slashMentions);
  const excludeSet = new Set(excludeNames || []);
  const excludeRecommendSet = new Set(excludeRecommendNames || []);
  const activeSignals = detectWorkspaceSignals(workspacePaths, config.workspaceSignals);

  const totalDocs = Math.max(index?.totalDocs || 1, 1);
  const avgDocLen = Math.max(index?.avgDocLen || 1, 1);
  const docFreq = index?.docFreq || {};

  const scored = [];

  for (const skill of index?.skills || []) {
    if (!includeInstalled && skill.kind === "installed") continue;
    if (kindFilter === "off_prompt" && skill.kind !== "vault" && skill.kind !== "folded") continue;
    if (kindFilter === "installed" && skill.kind !== "installed" && skill.kind !== "workspace") {
      continue;
    }

    const explicitSlash = slashSet.has(skill.name.toLowerCase());
    if (excludeSet.has(skill.name) && !explicitSlash) continue;

    let rawBm25 = 0;
    const matchedTerms = [];
    const synonymHits = [];

    for (const [term, qWeight] of terms.entries()) {
      const df = docFreq[term] || 0;
      const tfName = skill.tokens?.name?.[term] || 0;
      const tfDesc = skill.tokens?.description?.[term] || 0;
      const tfHead = skill.tokens?.headings?.[term] || 0;
      const weightedTf = tfName * 3.8 + tfDesc * 2.2 + tfHead * 1.0;

      if (weightedTf > 0) {
        const s = bm25TermScore(weightedTf, df, totalDocs, skill.docLen || 10, avgDocLen) * qWeight;
        rawBm25 += s;
        if (qWeight >= 1.0) {
          matchedTerms.push(term);
        } else {
          synonymHits.push(term);
        }
      }
    }

    let textScore = rawBm25 > 0 ? rawBm25 / (rawBm25 + 4.2) : 0;
    const reasons = [];

    if (matchedTerms.length > 0) {
      reasons.push(`terms:${matchedTerms.slice(0, 4).join(",")}`);
    } else if (synonymHits.length > 0) {
      reasons.push(`syn:${synonymHits.slice(0, 3).join(",")}`);
    }

    const nameMention =
      !explicitSlash && skill.name.length >= 4 && rawLower.includes(skill.name.toLowerCase());

    if (explicitSlash) {
      textScore = Math.max(textScore, 0.98);
      reasons.unshift("explicit:/slash");
    } else if (nameMention) {
      textScore = Math.max(textScore, 0.82);
      reasons.unshift("name-mention");
    }

    // Workspace context bonus (only when text also shows non-trivial relevance)
    let hasWorkspaceSignal = false;
    if (activeSignals.size > 0 && textScore >= 0.15) {
      const skillTokenSet = new Set([
        ...Object.keys(skill.tokens?.name || {}),
        ...Object.keys(skill.tokens?.description || {}),
      ]);
      const overlap = [...activeSignals].filter((sig) => skillTokenSet.has(sig));
      if (overlap.length > 0) {
        hasWorkspaceSignal = true;
        textScore += 0.18;
        reasons.push(`workspace:${overlap.slice(0, 2).join(",")}`);
      }
    }

    if ((skill.kind === "vault" || skill.kind === "folded") && textScore >= 0.2) {
      textScore += 0.04;
    }

    const adoptionMult = getAdoptionMultiplier(stats, skill.name, adoptionTrackingEnabled);
    const health = evaluateRuntimeHealth({
      skill,
      stats,
      feedback,
      config,
      adoptionTrackingEnabled,
    });

    const preHealthScore = textScore * adoptionMult;
    const finalScore = explicitSlash
      ? Number(Math.min(0.99, preHealthScore).toFixed(3))
      : Number(Math.min(0.99, preHealthScore * health.scoreMultiplier).toFixed(3));

    if (finalScore <= 0.05) continue;

    scored.push({
      name: skill.name,
      score: finalScore,
      preHealthScore: Number(Math.min(0.99, preHealthScore).toFixed(3)),
      kind: skill.kind,
      sourceLabel: skill.sourceLabel,
      path: skill.path,
      description: skill.description,
      explicitSlash,
      nameMention,
      hasWorkspaceSignal,
      directMatchCount: matchedTerms.length,
      synonymHitCount: synonymHits.length,
      health,
      reasons,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const autoThreshold = config.autoThreshold ?? 0.78;
  const installedAutoThreshold = config.installedAutoThreshold ?? 0.84;
  const recommendThreshold = config.recommendThreshold ?? 0.62;
  const installedRecommendThreshold = config.installedRecommendThreshold ?? 0.72;
  const minDirectTermsForAuto = config.minDirectTermsForAuto ?? 2;
  const autoMax = config.autoMax ?? 2;
  const recommendMax = config.recommendMax ?? 2;

  const auto = [];
  const recommend = [];
  const warnings = [];

  for (const item of scored) {
    if (item.health.blockAuto) {
      if (
        (item.explicitSlash || item.preHealthScore >= recommendThreshold * 0.9) &&
        warnings.length < 2
      ) {
        warnings.push(item);
      }
      continue;
    }

    const effectiveAutoThreshold =
      item.kind === "installed" ? installedAutoThreshold : autoThreshold;
    const effectiveRecThreshold =
      item.kind === "installed" ? installedRecommendThreshold : recommendThreshold;
    const meetsAutoTermGate =
      item.explicitSlash ||
      item.nameMention ||
      item.directMatchCount >= minDirectTermsForAuto ||
      (item.hasWorkspaceSignal && (item.directMatchCount >= 1 || item.synonymHitCount >= 2));
    const meetsRecGate =
      item.explicitSlash ||
      item.nameMention ||
      item.directMatchCount >= 1 ||
      item.synonymHitCount >= 2;
    const notYetRecommended = item.explicitSlash || !excludeRecommendSet.has(item.name);

    if (item.score >= effectiveAutoThreshold && meetsAutoTermGate && auto.length < autoMax) {
      auto.push(item);
    } else if (
      notYetRecommended &&
      item.score >= effectiveRecThreshold &&
      meetsRecGate &&
      recommend.length < recommendMax
    ) {
      recommend.push(item);
    }
  }

  const tier =
    auto.length > 0
      ? "auto"
      : recommend.length > 0
        ? "recommend"
        : warnings.length > 0
          ? "warning"
          : "silent";

  return {
    tier,
    auto,
    recommend,
    warnings,
    all: scored.slice(0, 10),
  };
}
