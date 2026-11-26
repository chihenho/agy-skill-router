import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_OR_PLUGIN_ROOT = dirname(SRC_DIR);

export function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return inputPath;
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveFrom(baseDir, targetPath) {
  const expanded = expandHome(targetPath);
  if (!expanded) return expanded;
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

export function getPluginRoot() {
  if (process.env.PLUGIN_ROOT) return resolve(process.env.PLUGIN_ROOT);
  if (process.env.AGY_ROUTER_ROOT) return resolve(process.env.AGY_ROUTER_ROOT);
  return REPO_OR_PLUGIN_ROOT;
}

function normCase(p) {
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

export function resolvePluginDataDir(pluginRoot = getPluginRoot()) {
  const defaultPluginDir = join(homedir(), ".gemini", "config", "plugins", "agy-skill-router");
  const agyPluginData = join(homedir(), ".gemini", "antigravity", "plugin_data", "agy-skill-router");
  if (normCase(pluginRoot) === normCase(defaultPluginDir) && existsSync(agyPluginData)) {
    return agyPluginData;
  }
  return join(pluginRoot, ".data");
}

export function getDataDir() {
  const dir = process.env.PLUGIN_DATA
    ? resolve(process.env.PLUGIN_DATA)
    : process.env.AGY_ROUTER_DATA
      ? resolve(process.env.AGY_ROUTER_DATA)
      : resolvePluginDataDir(getPluginRoot());
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function hasPostToolHook(pluginRoot = getPluginRoot()) {
  try {
    const hooksPath = join(pluginRoot, "hooks.json");
    if (!existsSync(hooksPath)) return false;
    return readFileSync(hooksPath, "utf8").includes('"PostToolUse"');
  } catch {
    return false;
  }
}

export function getConfigPath() {
  return join(getPluginRoot(), "router.config.json");
}
