const EN_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "how", "i", "in", "is", "it", "its", "my", "not", "of", "on", "or", "our",
  "that", "the", "their", "them", "then", "there", "these", "this", "to", "use",
  "using", "was", "we", "when", "where", "which", "who", "will", "with", "you",
  "your", "only", "activate", "explicitly", "requested", "user", "skill", "skills"
]);

const CJK_FILLERS = new Set([
  "的", "了", "吗", "呢", "吧", "啊", "呀", "和", "与", "或", "在", "是", "有",
  "把", "被", "给", "让", "对", "向", "到", "从", "这", "那", "个", "些", "我",
  "你", "他", "她", "它", "们", "请", "帮", "想", "要", "用", "做", "弄", "搞",
  "看", "下", "一", "很", "太", "都", "也", "就", "还", "再", "仅", "当", "时",
  "么", "怎", "啥", "哪", "谁", "几"
]);

const SYNONYMS = [
  [/小程序|微信|小游戏|miniprogram|wechat/i, ["wechatide", "wechat", "miniprogram", "小程序", "小游戏"]],
  [/审查|评审|挑刺|盲区|压测|adversarial|review/i, ["interrogate", "review", "adversarial", "盲区"]],
  [/影响|范围|破坏|风险|波及|blast/i, ["blast-radius", "blast", "radius", "break"]],
  [/架构|数据结构|模块边界|模块结构|design|architecture/i, ["architect", "design", "types", "module"]],
  [/注释|删注释|多余注释|comment/i, ["no-comments", "comment"]],
  [/去ai味|ai腔|套话|润色|精简表达|slop/i, ["unslop", "writing"]],
  [/性能|基准|提速|慢|卡顿|压测|benchmark|perf/i, ["benchmark-checklist", "perf", "benchmark"]],
  [/测试|单测|回归测试|先写测试|tdd/i, ["tdd", "test", "regression"]],
  [/界面|视觉|质感|动效|液态玻璃|卡片|ui|design/i, ["kubai-design-tips", "ui", "design"]],
  [/文档|readme|rfc|pr描述|commit/i, ["technical-writing", "docs"]],
  [/对比|多方案|原型|竞品|并行尝试/i, ["arena", "prototype"]],
  [/bug|排查|复现|根因|修复|debug/i, ["poteto-mode", "bug", "fix"]],
  [/为什么|动机|历史|当初/i, ["why", "rationale"]],
  [/怎么工作|原理|走读|讲解|理解/i, ["how", "teach", "walkthrough"]],
  [/提示词|prompt|需求模糊|重写需求/i, ["sharpen", "reframe"]],
  [/复盘|总结经验|记住教训|老犯错/i, ["reflect", "correct"]],
  [/状态机|tla|形式化|并发竞争|race/i, ["statechart", "create-formal-verification-skill", "formal"]],
  [/生成.*验证|端到端验证|verify/i, ["create-verification-skill", "maintain-verification-skill"]]
];

export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const lower = text.toLowerCase();
  const tokens = [];

  // English / alphanumeric tokens (preserving hyphenated compound + sub-parts)
  const enMatches = lower.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
  for (const tok of enMatches) {
    if (tok.includes("-")) {
      tokens.push(tok);
      for (const part of tok.split("-")) {
        if (part.length >= 2 && !EN_STOP_WORDS.has(part)) {
          tokens.push(part);
        }
      }
    } else if (tok.length >= 2 && !EN_STOP_WORDS.has(tok)) {
      tokens.push(tok);
    }
  }

  // CJK segments -> bigrams for multi-char segments (avoids noisy single-char collisions),
  // unigram only when a standalone single character is non-filler.
  const cjkSegments = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of cjkSegments) {
    const chars = [...seg];
    if (chars.length === 1) {
      if (!CJK_FILLERS.has(chars[0])) {
        tokens.push(chars[0]);
      }
      continue;
    }
    for (let i = 0; i < chars.length - 1; i += 1) {
      if (CJK_FILLERS.has(chars[i]) && CJK_FILLERS.has(chars[i + 1])) continue;
      tokens.push(chars[i] + chars[i + 1]);
    }
  }

  return tokens;
}

export function tokenizeQuery(query) {
  const rawLower = String(query || "").toLowerCase();
  const terms = new Map();

  for (const tok of tokenize(rawLower)) {
    terms.set(tok, Math.max(terms.get(tok) || 0, 1.0));
  }

  // Bilingual synonym expansion at lower weight so direct hits still outrank expanded ones
  for (const [pattern, expansions] of SYNONYMS) {
    if (pattern.test(rawLower)) {
      for (const exp of expansions) {
        for (const t of tokenize(exp)) {
          if (!terms.has(t)) {
            terms.set(t, 0.65);
          }
        }
      }
    }
  }

  const slashMentions = [];
  for (const m of rawLower.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]*)/g)) {
    slashMentions.push(m[1]);
  }

  return { terms, rawLower, slashMentions };
}
