import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEPRECATED_TEXT_RE = /\b(deprecated|obsolete|do not use|legacy only)\b|已废弃|已过时|不建议使用/i;
const FOREIGN_HARNESS_RE = /~\/\.cursor\/rules\/|\.cursor\/rules\/|\bAskQuestion\b|\bTodoWrite\b|\bBugbot\b|\bclaude-opus-/;
const ANTIGRAVITY_ADAPTED_RE = /\bantigravity\b|antigravity\.md/i;
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function inspectSkillHealth({
  description,
  rawBody,
  skillMdPath,
  deprecated,
  mtimeMs,
  config,
}) {
  const issues = [];
  const body = String(rawBody || "");
  const desc = String(description || "");
  const firstHeading = (body.match(/^#\s+(.+)$/m) || [])[1] || "";

  if (deprecated || DEPRECATED_TEXT_RE.test(`${desc}\n${firstHeading}`)) {
    issues.push({
      code: "deprecated_marker",
      severity: "deprecated",
      detail: "Marked as deprecated/obsolete in frontmatter or header.",
    });
  }

  if (desc.trim().length < 12) {
    issues.push({
      code: "weak_description",
      severity: "warning",
      detail: "Skill description is empty or too short (< 12 chars) for reliable routing.",
    });
  }

  // Check relative markdown links inside the skill file
  const skillDir = dirname(skillMdPath);
  const brokenRefs = [];
  for (const [, href] of body.matchAll(MD_LINK_RE)) {
    const clean = href.replace(/[#?].*$/, "").trim();
    if (!clean) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) continue;
    if (/[<>{}*$]/.test(clean)) continue;
    const resolved = resolve(skillDir, clean);
    if (!existsSync(resolved)) {
      brokenRefs.push(clean);
      if (brokenRefs.length >= 3) break;
    }
  }
  if (brokenRefs.length > 0) {
    issues.push({
      code: "broken_local_refs",
      severity: "warning",
      detail: `Missing local reference(s): ${brokenRefs.join(", ")}`,
    });
  }

  if (FOREIGN_HARNESS_RE.test(body) && !ANTIGRAVITY_ADAPTED_RE.test(body)) {
    issues.push({
      code: "unadapted_foreign_harness",
      severity: "warning",
      detail: "References Cursor/Claude-specific tools or paths without an Antigravity adapter.",
    });
  }

  const staleDays = config?.staleDays ?? 180;
  if (mtimeMs && staleDays > 0) {
    const ageDays = (Date.now() - mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays > staleDays) {
      issues.push({
        code: "stale_mtime",
        severity: "warning",
        detail: `Not modified in ${Math.floor(ageDays)} days (threshold: ${staleDays}d).`,
      });
    }
  }

  const hasDeprecated = issues.some((i) => i.severity === "deprecated");
  const status = hasDeprecated ? "deprecated" : issues.length > 0 ? "warning" : "healthy";
  return { status, issues };
}

export function evaluateRuntimeHealth({
  skill,
  stats,
  feedback,
  config,
  adoptionTrackingEnabled = Boolean(config?.adoptionTracking),
}) {
  const issues = [...(skill.health?.issues || [])];
  const reported = feedback?.skills?.[skill.name];

  if (reported) {
    const severity =
      reported.issueType === "broken" ||
      reported.issueType === "deprecated" ||
      reported.issueType === "outdated"
        ? "deprecated"
        : "warning";
    const suffix = reported.suggestion ? ` Suggestion: ${reported.suggestion}` : "";
    issues.unshift({
      code: `reported_${reported.issueType}`,
      severity,
      detail: `${reported.reason}${suffix}`,
    });
  }

  if (adoptionTrackingEnabled) {
    const row = stats?.skills?.[skill.name];
    const minExposures = config?.lowAdoptionMinExposures ?? 6;
    const maxRate = config?.lowAdoptionMaxRate ?? 0.15;
    if (row) {
      const total = (row.autoCount || 0) + (row.recommendCount || 0);
      const rate = total > 0 ? (row.adoptedCount || 0) / total : 1;
      if (total >= minExposures && rate <= maxRate) {
        issues.push({
          code: "low_adoption_noise",
          severity: "warning",
          detail: `Low adoption (${row.adoptedCount || 0}/${total} times read); consider refining description or archiving.`,
        });
      }
    }
  }

  const hasBlock = issues.some((i) => i.severity === "deprecated");
  const status = hasBlock ? "deprecated" : issues.length > 0 ? "warning" : "healthy";
  const scoreMultiplier = hasBlock ? 0.65 : issues.length > 0 ? 0.88 : 1.0;

  return {
    status,
    issues,
    blockAuto: hasBlock,
    scoreMultiplier,
  };
}
