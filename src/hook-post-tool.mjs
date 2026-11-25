import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDataDir } from "./paths.mjs";
import { recordAdoption, recordHealthFeedback } from "./state.mjs";

function readStdin() {
  return new Promise((resolveStdin) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveStdin(data));
    process.stdin.on("error", () => resolveStdin(""));
  });
}

function normalizeFsPath(p) {
  return resolve(String(p || "")).replace(/\\/g, "/").toLowerCase();
}

export function processPostToolPayload(payload, dataDir) {
  const args = payload?.toolCall?.args || {};
  const rawPath = args.Path || args.path || args.TargetFile || args.file || "";
  if (!rawPath || !/skill\.md$/i.test(String(rawPath))) {
    return {};
  }

  const indexPath = join(dataDir, "index.json");
  if (!existsSync(indexPath)) return {};

  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return {};
  }

  const targetNorm = normalizeFsPath(rawPath);
  const matched = (index.skills || []).find((s) => normalizeFsPath(s.path) === targetNorm);
  if (!matched) return {};

  if (payload?.error) {
    recordHealthFeedback(dataDir, {
      skillName: matched.name,
      issueType: "broken",
      reason: `Failed to read SKILL.md (${String(payload.error).slice(0, 120)})`,
      suggestion: "Rebuild index or remove broken skill entry.",
    });
  } else {
    recordAdoption(dataDir, matched.name);
  }

  return {};
}

async function runCli() {
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      const payload = JSON.parse(raw);
      processPostToolPayload(payload, getDataDir());
    }
  } catch {
    // Non-fatal
  }
  process.stdout.write("{}");
}

const isEntry =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());

if (isEntry) {
  runCli();
}
