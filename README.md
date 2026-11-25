English | [简体中文](./README.zh-CN.md)

# agy-skill-router

**Low-context autonomous skill routing, 0-token UI recommendations, skill staleness/health auditing, and minimal MCP discovery for Antigravity.**

## Why?

Antigravity injects every installed skill's `name` and `description` into every turn. Once you collect 50–200+ skills, you burn thousands of tokens per turn on irrelevant metadata and the model starts missing or mispicking skills.

`agy-skill-router` solves this using Antigravity's native `hooks.json`, `PLUGIN_DATA`, and a tiny 3-tool Stdio MCP server:

1. **Off-prompt Skill Vault + Auto-Discovery**: Scans `~/.gemini/skill-vault/`, folded plugin subdirs (e.g. `pstack/references/extra-skills/`), `~/.gemini/config/skills/`, `skills.json`, and workspace `.agents/skills/` into a fast local BM25 + bilingual index.
2. **3-Tier `PreInvocation` Hook (< 20 ms)**:
   - **High confidence**: Injects a compact ~60-token pointer with the exact `SKILL.md` path so Antigravity reads and runs it autonomously.
   - **Medium confidence (`0` model tokens!)**: Uses Antigravity's `metadata.user_markdown` with `systemMessage: ""` — displays clickable skill hints to the user in the UI without spending a single model token!
   - **Low confidence / chit-chat** (`ok`, `thanks`, `好的`, etc.): Outputs `{}` — zero noise, zero token cost.
   - **Conversation dedup**: Never re-injects the same skill or repeats routing on the same user input within a conversation.
3. **Outdated / Unrecommended Skill Detection**:
   - **Static health checks**: Flags `deprecated` markers, missing relative file links, unadapted Cursor/Claude-only instructions (`AskQuestion`, `~/.cursor/rules/`, etc.), weak descriptions, and stale modification times (`staleDays`).
   - **Live feedback loop**: The `PostToolUse` (`read_file`) hook tracks actual adoption rates and automatically flags `SKILL.md` read failures; mid-task, the agent can call `report_skill_issue` so future turns warn `⚠️` and stop auto-invoking broken or outdated skills.
4. **Minimal Stdio MCP Server (3 tools)**: Exposes `search_skills`, `list_skill_domains`, and `report_skill_issue` so the agent can discover skills mid-task even if the initial prompt didn't mention them.

---

## 1-Paste Install in Antigravity

Paste this directly into Antigravity on any machine (Windows / macOS / Linux, requires **Git** and **Node.js >= 18**):

```text
Please install https://github.com/chihenho/agy-skill-router into my Antigravity:
Follow INSTALL_FOR_AGENTS.md in the repo — clone to ~/.gemini/antigravity/scratch/agy-skill-router, run `node install.mjs`, run `doctor` and `audit`, verify via GetAllPlugins RPC (filtered) that hooks and MCP are active, and give me the [agy-skill-router](customization://agy-skill-router) link.
```

*(Prefer Chinese UI recommendations and plugin description? Replace `node install.mjs` with `node install.mjs --lang zh`.)*

### Manual CLI Install

```bash
git clone https://github.com/chihenho/agy-skill-router.git
cd agy-skill-router
node install.mjs          # English (default)
# or: node install.mjs --lang zh
```

---

## CLI Tools

After installing to `~/.gemini/config/plugins/agy-skill-router/`:

```bash
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs index
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs test "review my diff for blind spots"
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs audit
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs list
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs stats
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs doctor
```

---

## Cutting Context Usage Further (`~/.gemini/skill-vault`)

`install.mjs` automatically discovers both installed skills and off-prompt skills. To shrink your per-turn prompt down to near zero:
1. Move heavy or occasional skill folders from `~/.gemini/config/skills/` into `~/.gemini/skill-vault/`.
2. Antigravity stops pre-loading their descriptions on every turn, while `agy-skill-router` still auto-routes and recommends them whenever relevant.

## Configuration (`router.config.json`)

- `lang`: `"en"` (default) or `"zh"`
- `autoThreshold` (`0.62`) / `recommendThreshold` (`0.36`)
- `staleDays` (`180`), `lowAdoptionMinExposures` (`6`), `lowAdoptionMaxRate` (`0.15`)
- `sources`: List of local directories, `skills.json` files, or plugin glob paths to index
- `workspaceSignals`: File markers (e.g. `project.config.json`, `tsconfig.json`, `Cargo.toml`) that boost matching domain skills

## License

[MIT](./LICENSE)
