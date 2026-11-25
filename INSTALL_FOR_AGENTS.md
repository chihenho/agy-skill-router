# Installing `agy-skill-router` for Antigravity

When a user asks you to install `https://github.com/chihenho/agy-skill-router` (or `agy-skill-router`), follow these steps:

1. **Check prerequisites**: Verify `node` (>= 18) and `npx` (or `git`) are available.
2. **Install**:
   - **Recommended (fastest, via npm)**: Run `npx -y agy-skill-router install --lang zh` if the user's request is in Chinese (or asks for Chinese UI messages), otherwise `npx -y agy-skill-router install` (English default).
   - **Fallback (via Git)**: Clone `https://github.com/chihenho/agy-skill-router.git` to `~/.gemini/antigravity/scratch/agy-skill-router` (or `git pull --ff-only` if present) and run `node install.mjs` (or `--lang zh`).
   - This installs the plugin into `~/.gemini/config/plugins/agy-skill-router/`, creates `~/.gemini/skill-vault/` if missing, registers `PreInvocation` hook (`hooks.json`) and 3-tool Stdio MCP (`mcp_config.json`), and builds the initial local skill index.
3. **Verify**:
   - Run `npx -y agy-skill-router doctor` and `npx -y agy-skill-router audit` (or `node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs doctor` / `audit`) and summarize any outdated/broken skill findings concisely.
   - Query Antigravity's Language Server `GetAllPlugins` RPC (filtered! Never print full `SKILL.md` text) to confirm `agy-skill-router` appears with `dir == "agy-skill-router"`, `disabled == false`, `hooks == true`, and `mcp` containing `"agy-skill-router_router"`.
4. **Reply to user**:
   - Report how many local skills were indexed (grouped by `vault`, `folded`, `installed`) and any outdated/flagged skills discovered by `audit`.
   - Give the user the direct plugin management link `[agy-skill-router](customization://agy-skill-router)` and explain they can move seldom-used skills into `~/.gemini/skill-vault/` to keep per-turn context near zero.
