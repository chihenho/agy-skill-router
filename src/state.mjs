import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_CONVERSATIONS = 100;

function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  try {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } catch {
    // Non-fatal in hook execution
  }
}

export function hashInput(text) {
  return createHash("sha1")
    .update(String(text || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

export function loadConversations(dataDir) {
  return readJsonSafe(join(dataDir, "conversations.json"), { conversations: {} });
}

export function saveConversations(dataDir, state) {
  const entries = Object.entries(state.conversations || {});
  if (entries.length > MAX_CONVERSATIONS) {
    entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    state.conversations = Object.fromEntries(entries.slice(0, MAX_CONVERSATIONS));
  }
  writeJsonSafe(join(dataDir, "conversations.json"), state);
}

export function getConversationState(dataDir, conversationId) {
  if (!conversationId) return null;
  const state = loadConversations(dataDir);
  return state.conversations[conversationId] || null;
}

export function hasRoutedInput(dataDir, conversationId, inputHash) {
  if (!conversationId || !inputHash) return false;
  const conv = getConversationState(dataDir, conversationId);
  return Boolean(conv && conv.lastInputHash === inputHash);
}

export function recordRoute(dataDir, conversationId, inputHash, autoNames = [], recommendNames = []) {
  const now = Date.now();
  if (conversationId) {
    const state = loadConversations(dataDir);
    const prev = state.conversations[conversationId] || {
      injectedSkills: [],
      recommendedSkills: [],
    };
    const injectedSet = new Set(prev.injectedSkills || []);
    for (const name of autoNames) injectedSet.add(name);
    const recSet = new Set(prev.recommendedSkills || []);
    for (const name of recommendNames) recSet.add(name);

    state.conversations[conversationId] = {
      lastInputHash: inputHash,
      injectedSkills: [...injectedSet],
      recommendedSkills: [...recSet],
      updatedAt: now,
    };
    saveConversations(dataDir, state);
  }

  if (autoNames.length > 0 || recommendNames.length > 0) {
    const stats = loadStats(dataDir);
    for (const name of autoNames) {
      const row = stats.skills[name] || { autoCount: 0, recommendCount: 0, adoptedCount: 0, lastUsedAt: 0 };
      row.autoCount += 1;
      row.lastUsedAt = now;
      stats.skills[name] = row;
    }
    for (const name of recommendNames) {
      const row = stats.skills[name] || { autoCount: 0, recommendCount: 0, adoptedCount: 0, lastUsedAt: 0 };
      row.recommendCount += 1;
      row.lastUsedAt = now;
      stats.skills[name] = row;
    }
    saveStats(dataDir, stats);
  }
}

export function loadStats(dataDir) {
  return readJsonSafe(join(dataDir, "stats.json"), { skills: {} });
}

export function saveStats(dataDir, stats) {
  writeJsonSafe(join(dataDir, "stats.json"), stats);
}

export function recordAdoption(dataDir, skillName) {
  if (!skillName) return;
  const stats = loadStats(dataDir);
  const row = stats.skills[skillName] || {
    autoCount: 0,
    recommendCount: 0,
    adoptedCount: 0,
    lastUsedAt: 0,
  };
  row.adoptedCount += 1;
  row.lastUsedAt = Date.now();
  stats.skills[skillName] = row;
  saveStats(dataDir, stats);
}

export function getAdoptionMultiplier(stats, skillName) {
  const row = stats?.skills?.[skillName];
  if (!row) return 1.0;
  const total = (row.autoCount || 0) + (row.recommendCount || 0);
  if (total < 3) return 1.0;
  const rate = ((row.adoptedCount || 0) + 2) / (total + 2);
  return Number((0.85 + Math.min(1, rate) * 0.35).toFixed(3));
}

export function loadHealthFeedback(dataDir) {
  return readJsonSafe(join(dataDir, "health-feedback.json"), { skills: {} });
}

export function recordHealthFeedback(dataDir, { skillName, issueType, reason, suggestion = "" }) {
  if (!skillName) return;
  const feedback = loadHealthFeedback(dataDir);
  const prev = feedback.skills[skillName];
  feedback.skills[skillName] = {
    issueType: issueType || "outdated",
    reason: String(reason || "").trim() || "Reported as outdated or broken during use.",
    suggestion: String(suggestion || "").trim(),
    reportedAt: Date.now(),
    count: (prev?.count || 0) + 1,
  };
  writeJsonSafe(join(dataDir, "health-feedback.json"), feedback);
}

export function clearHealthFeedback(dataDir, skillName) {
  const feedback = loadHealthFeedback(dataDir);
  if (!feedback.skills[skillName]) return false;
  delete feedback.skills[skillName];
  writeJsonSafe(join(dataDir, "health-feedback.json"), feedback);
  return true;
}
