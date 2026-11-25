[English](./README.md) | 简体中文

# agy-skill-router

[![npm version](https://img.shields.io/npm/v/agy-skill-router)](https://www.npmjs.com/package/agy-skill-router)

**为 Antigravity 打造的低上下文消耗技能自主路由、0-token 推荐、过时技能体检与极简 MCP 发现插件。**

## 为什么做这个项目？

在 Antigravity 中，所有已启用 Skill 的 `name` 和 `description` 每轮都会注入系统提示词。当你的本地技能攒到 50~200+ 个时：
- 每轮都在白烧数千 token；
- 描述一多，模型反而更容易漏选或选偏；
- 有些老旧、未适配或路径失效的 Skill 还会把 Agent 带偏。

`agy-skill-router` 利用 Antigravity 原生 `hooks.json`、`PLUGIN_DATA` 和极简 3 工具 Stdio MCP 解决上述痛点：

1. **离线技能池 + 多源自动扫描**：自动索引 `~/.gemini/skill-vault/`、插件折叠目录（如 `pstack/references/extra-skills/`）、`~/.gemini/config/skills/`、`skills.json` 以及当前工作区 `.agents/skills/`，构建本地毫秒级 BM25 + 中英双语索引。
2. **三级 `PreInvocation` 智能路由（< 20 ms）**：
   - **高置信度（自动触发）**：注入 ~60 token 的极简指针（技能名 + `SKILL.md` 绝对路径），让 Agent 自主 `read_file` 后执行。
   - **中置信度（0-token 推荐！）**：利用 Antigravity 原生 `metadata.user_markdown` 并把 `systemMessage` 置空 `""`——只在聊天界面内嵌展示推荐卡片给用户看，**模型 0 token 消耗**！
   - **低置信度 / 寒暄**（如“好的”、“谢谢”、“ok”）：直接返回 `{}`，零打扰、零上下文消耗。
   - **会话级去重**：同一会话同一句话只路由一次，已注入过的技能不重复注入。
3. **过时 / 失效 / 不建议使用技能检测**：
   - **静态体检（`audit`）**：自动识别 `deprecated` 标记、失效的本地相对引用链接、未适配的 Cursor/Claude 专属指令（如 `AskQuestion`、`~/.cursor/rules/`）、过短描述以及超期未更新（`staleDays`）。
   - **运行期自学习与反馈**：`PostToolUse`（监听 `read_file`）统计真实采纳率并自动标记读取失败的 `SKILL.md`；Agent 在长任务中途发现某个 Skill 过时或失效时，可调用 `report_skill_issue` 记录原因，后续对话会自动标出 `⚠️ 不建议使用` 并阻止盲目自动调用。
4. **极简 Stdio MCP（仅 3 个工具）**：提供 `search_skills`、`list_skill_domains`、`report_skill_issue`，让 Agent 在复杂任务做到一半时也能自主检索合适技能。

---

## 快速安装（Quick Start）

### 方式 1：`npx` 一行安装（最快，无需 clone）

```bash
npx -y agy-skill-router install --lang zh   # 中文提示
npx -y agy-skill-router install             # 默认英文
```

*（默认只启用 `PreInvocation` 路由钩子，不对 `read_file` 挂同步钩子，高频并发读文件 0 额外延迟；如需开启 `read_file` 采纳率统计，可加 `--with-post-hook`。）*

### 方式 2：一键让 Antigravity 自动部署（复制即用）

在任意设备（Windows / macOS / Linux，需已安装 **Node.js >= 18**）把下面这段话直接发给 Antigravity：

```text
请帮我安装并配置 https://github.com/chihenho/agy-skill-router ：
运行 `npx -y agy-skill-router install --lang zh` 自动安装并扫描匹配我本地所有 skill，接着运行 `npx -y agy-skill-router doctor` 和 `npx -y agy-skill-router audit` 检查健康状态，并通过 GetAllPlugins RPC（过滤输出）确认 hooks 和 MCP 已激活，最后给我 `[agy-skill-router](customization://agy-skill-router)` 链接与体检摘要。
```

### 方式 3：Antigravity CLI 或 GitHub 源码安装

```bash
# Antigravity CLI 直接安装
agy plugin install https://github.com/chihenho/agy-skill-router

# 或从 GitHub 源码安装
git clone https://github.com/chihenho/agy-skill-router.git
cd agy-skill-router
node install.mjs --lang zh
```

### 分发与聚合目录支持

- 根目录自带 [`plugin.json`](./plugin.json)、[`hooks.json`](./hooks.json)、[`mcp_config.json`](./mcp_config.json) 与 [`assets/logo.svg`](./assets/logo.svg)，可直接通过 `agy plugin validate --strict .` 校验并提交至 **Antigravity 官方插件市场**。
- 自带 [`skills/skill-router/SKILL.md`](./skills/skill-router/SKILL.md)（`/skill-router`）以适配 **skills.sh** / **SkillsMP** 索引。
- 自带 [`smithery.yaml`](./smithery.yaml) 与 [`glama.json`](./glama.json)，支持 **Smithery** / **Glama** / 标准 MCP 客户端通过 `npx -y agy-skill-router mcp` 拉起。

---

## 常用 CLI 命令

安装后插件位于 `~/.gemini/config/plugins/agy-skill-router/`：

```bash
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs index
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs test "帮我审查这次改动的盲区和风险"
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs audit
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs list
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs stats
node ~/.gemini/config/plugins/agy-skill-router/src/cli.mjs doctor
```

---

## 如何把常驻上下文压到最低（`~/.gemini/skill-vault`）

1. 把低频或大体积 Skill 文件夹从 `~/.gemini/config/skills/` 挪到 `~/.gemini/skill-vault/`；
2. Antigravity 不会再每轮把它们的描述塞进系统提示词；
3. 当你的提问或当前项目环境命中它们时，`agy-skill-router` 会通过 Hook 自动路由或在 UI 里 0-token 推荐给你。

## 协议

[MIT](./LICENSE)
