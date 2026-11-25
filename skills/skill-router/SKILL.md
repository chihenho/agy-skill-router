---
name: skill-router
description: "Audit local skills for outdated or broken entries, search off-prompt skills in ~/.gemini/skill-vault, or report an outdated skill via agy-skill-router. Only activate when explicitly requested by the user."
---

# Skill Router Management

Use `agy-skill-router` to keep your local skill collection fast, low-context, and up to date.

## Common Workflows

1. **Discover off-prompt or installed skills mid-task**:
   - Call MCP tool `search_skills` with task keywords or `list_skill_domains` for a compact inventory.
2. **Flag an outdated, broken, or redundant skill**:
   - Call MCP tool `report_skill_issue` (`skill_name`, `issue_type`: `outdated` | `broken` | `deprecated` | `redundant`, `reason`, optional `suggestion`). Future turns will surface a `⚠️` warning and stop auto-invoking it.
3. **Run local skill health audit or CLI diagnostics**:
   - Audit outdated/unadapted/low-adoption skills: `node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs audit`
   - Test how a query routes: `node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs test "<query>"`
   - Clear a resolved issue: `node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs clear-issue <skill-name>`
   - Force rebuild index: `node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs index`
4. **Save per-turn context**:
   - Move seldom-used skill folders from `~/.gemini/config/skills/` into `~/.gemini/skill-vault/` so they load only when matched.
