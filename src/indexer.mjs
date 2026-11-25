import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSkillMarkdown } from "./frontmatter.mjs";
import { inspectSkillHealth } from "./health.mjs";
import { resolveFrom } from "./paths.mjs";
import { tokenize } from "./tokenizer.mjs";

const KIND_PRIORITY = {
  workspace: 4,
  vault: 3,
  folded: 2,
  installed: 1,
};

function countTokens(tokens) {
  const freq = {};
  for (const t of tokens) {
    freq[t] = (freq[t] || 0) + 1;
  }
  return freq;
}

function readSkillEntry(skillDir, kind, sourceLabel, opts) {
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) return null;

  let raw;
  let mtimeMs = 0;
  try {
    raw = readFileSync(skillMdPath, "utf8");
    mtimeMs = statSync(skillMdPath).mtimeMs;
  } catch {
    return null;
  }

  const parsed = parseSkillMarkdown(raw);
  const name = parsed.name || basename(skillDir);
  if (!name || opts.excludeSet.has(name)) return null;
  if (!opts.includePrinciples && name.startsWith("principle-")) return null;

  const nameTokens = tokenize(`${name} ${parsed.tags.join(" ")}`);
  const descTokens = tokenize(parsed.description);
  const headTokens = tokenize(parsed.headings.join(" "));
  const health = inspectSkillHealth({
    name,
    description: parsed.description,
    rawBody: parsed.rawBody,
    skillMdPath,
    deprecated: parsed.deprecated,
    mtimeMs,
    config: opts.config,
  });

  return {
    name,
    description: parsed.description,
    path: skillMdPath,
    kind,
    sourceLabel,
    headings: parsed.headings,
    mtimeMs,
    health,
    tokens: {
      name: countTokens(nameTokens),
      description: countTokens(descTokens),
      headings: countTokens(headTokens),
    },
    docLen: nameTokens.length * 3 + descTokens.length * 2 + headTokens.length,
  };
}

function scanDirectoryOneLevel(dirPath, kind, sourceLabel, opts, filterFns = {}) {
  if (!dirPath || !existsSync(dirPath)) return [];
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (filterFns.includeOnly && !filterFns.includeOnly.some((re) => re.test(entry.name))) {
      continue;
    }
    if (filterFns.exclude && filterFns.exclude.some((re) => re.test(entry.name))) {
      continue;
    }
    const item = readSkillEntry(join(dirPath, entry.name), kind, sourceLabel, opts);
    if (item) out.push(item);
  }
  return out;
}

function toRegexList(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return null;
  return patterns.map((p) => {
    try {
      return new RegExp(`^${p}$`);
    } catch {
      return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  });
}

function dirnameSafe(p) {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(0, idx) : ".";
}

function scanSkillsJson(jsonPath, kind, opts, visited = new Set()) {
  if (!jsonPath || !existsSync(jsonPath) || visited.has(jsonPath)) return [];
  visited.add(jsonPath);

  let cfg;
  try {
    cfg = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return [];
  }

  const results = [];
  const baseDir = dirnameSafe(jsonPath);

  if (Array.isArray(cfg.inherits)) {
    for (const inh of cfg.inherits) {
      if (!inh?.path) continue;
      const inheritedPath = resolveFrom(baseDir, inh.path);
      const items = scanSkillsJson(inheritedPath, kind, opts, visited);
      const inc = toRegexList(inh.include_only);
      const exc = toRegexList(inh.exclude);
      for (const item of items) {
        if (inc && !inc.some((re) => re.test(item.name))) continue;
        if (exc && exc.some((re) => re.test(item.name))) continue;
        results.push(item);
      }
    }
  }

  if (Array.isArray(cfg.entries)) {
    for (const entry of cfg.entries) {
      if (!entry?.path) continue;
      const targetPath = resolveFrom(baseDir, entry.path);
      const inc = toRegexList(entry.include_only);
      const exc = toRegexList(entry.exclude);
      results.push(
        ...scanDirectoryOneLevel(targetPath, kind, "skills.json", opts, {
          includeOnly: inc,
          exclude: exc,
        })
      );
    }
  }

  return results;
}

function scanPluginsSubpath(pluginsRoot, subpath, kind, opts) {
  if (!pluginsRoot || !existsSync(pluginsRoot)) return [];
  let pluginDirs;
  try {
    pluginDirs = readdirSync(pluginsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const d of pluginDirs) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    if (d.name === "agy-skill-router" || d.name === "node_modules") continue;
    const target = join(pluginsRoot, d.name, subpath);
    out.push(...scanDirectoryOneLevel(target, kind, `plugin:${d.name}`, opts));
  }
  return out;
}

function finalizeCorpus(skillsMap) {
  const skills = [...skillsMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const docFreq = {};
  let totalDocLen = 0;

  for (const s of skills) {
    totalDocLen += s.docLen || 1;
    const seen = new Set([
      ...Object.keys(s.tokens.name),
      ...Object.keys(s.tokens.description),
      ...Object.keys(s.tokens.headings),
    ]);
    for (const tok of seen) {
      docFreq[tok] = (docFreq[tok] || 0) + 1;
    }
  }

  return {
    builtAt: Date.now(),
    totalDocs: skills.length,
    avgDocLen: skills.length > 0 ? totalDocLen / skills.length : 1,
    docFreq,
    skills,
  };
}

function mergeSkills(skillsMap, list) {
  for (const item of list) {
    const existing = skillsMap.get(item.name);
    if (!existing || (KIND_PRIORITY[item.kind] || 0) > (KIND_PRIORITY[existing.kind] || 0)) {
      skillsMap.set(item.name, item);
    }
  }
}

export function buildGlobalIndex(config) {
  const opts = {
    excludeSet: new Set(config.excludeSkills || []),
    includePrinciples: Boolean(config.includePrinciples),
    config,
  };
  const skillsMap = new Map();

  for (const src of config.sources || []) {
    const kind = src.kind || "vault";
    if (kind === "installed" && config.includeInstalledSkills === false) continue;

    if (src.path) {
      const abs = resolveFrom(process.cwd(), src.path);
      mergeSkills(skillsMap, scanDirectoryOneLevel(abs, kind, src.label || src.path, opts));
    } else if (src.skillsJson) {
      const abs = resolveFrom(process.cwd(), src.skillsJson);
      mergeSkills(skillsMap, scanSkillsJson(abs, kind, opts));
    } else if (src.globPlugins && src.subpath) {
      const abs = resolveFrom(process.cwd(), src.globPlugins);
      mergeSkills(skillsMap, scanPluginsSubpath(abs, src.subpath, kind, opts));
    }
  }

  return finalizeCorpus(skillsMap);
}

export function scanWorkspaceSkills(workspacePaths = [], config) {
  const opts = {
    excludeSet: new Set(config.excludeSkills || []),
    includePrinciples: Boolean(config.includePrinciples),
    config,
  };
  const found = [];
  for (const ws of workspacePaths || []) {
    if (!ws) continue;
    for (const dotDir of [".agents", ".agent"]) {
      const candidate = join(ws, dotDir, "skills");
      found.push(...scanDirectoryOneLevel(candidate, "workspace", `workspace:${basename(ws)}`, opts));
    }
  }
  return found;
}

export function loadOrBuildIndex({ config, dataDir, workspacePaths = [], force = false }) {
  const indexPath = join(dataDir, "index.json");
  const ttlMs = (config.indexTtlSeconds ?? 300) * 1000;
  let globalIndex = null;

  if (!force && existsSync(indexPath)) {
    try {
      const mtimeMs = statSync(indexPath).mtimeMs;
      if (Date.now() - mtimeMs <= ttlMs) {
        globalIndex = JSON.parse(readFileSync(indexPath, "utf8"));
      }
    } catch {
      globalIndex = null;
    }
  }

  if (!globalIndex) {
    globalIndex = buildGlobalIndex(config);
    try {
      writeFileSync(indexPath, `${JSON.stringify(globalIndex)}\n`, "utf8");
    } catch {
      // Non-fatal
    }
  }

  const wsSkills = scanWorkspaceSkills(workspacePaths, config);
  if (wsSkills.length === 0) {
    return globalIndex;
  }

  const merged = new Map(globalIndex.skills.map((s) => [s.name, s]));
  mergeSkills(merged, wsSkills);
  return finalizeCorpus(merged);
}
