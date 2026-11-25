# Installing `agy-skill-router` for Antigravity

When a user asks you to install `https://github.com/chihenho/agy-skill-router`, follow these exact steps:

1. **Check prerequisites**: Verify `git` and `node` (>= 18) are available in the environment.
2. **Clone or pull**:
   - Target repo directory: `~/.gemini/antigravity/scratch/agy-skill-router` (or inside the active workspace if the user asked).
   - If `.git` exists there, run `git pull --ff-only`; otherwise run `git clone https://github.com/chihenho/agy-skill-router.git` into that directory.
3. **Run installer**:
   - Choose `--lang zh` if the user's request is in Chinese (or asks for Chinese UI messages), otherwise run `node install.mjs` (English default).
   - `install.mjs` installs the plugin into `~/.gemini/config/plugins/agy-skill-router/`, creates `~/.gemini/skill-vault/` if missing, registers `hooks.json` (`PreInvocation` + `PostToolUse`) and `mcp_config.json`, and builds the initial local skill index.
4. **Verify**:
   - Run `node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs doctor` and `audit` (summarize any outdated/broken skill findings concisely).
   - Query Antigravity's Language Server `GetAllPlugins` RPC (filtered! Never print full `SKILL.md` text) to confirm `agy-skill-router` appears with `dir == "agy-skill-router"`, `disabled == false`, `hooks == true`, and `mcp` containing `"agy-skill-router"`.
5. **Reply to user**:
   - Report how many local skills were indexed (grouped by `vault`, `folded`, `installed`) and any outdated/flagged skills discovered by `audit`.
   - Give the user the direct plugin management link `[agy-skill-router](customization://agy-skill-router)` and explain they can move seldom-used skills into `~/.gemini/skill-vault/` to keep per-turn context near zero.
