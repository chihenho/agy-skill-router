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
  [/小程序|微信开发者|小游戏|miniprogram|wechatide/i, ["wechatide", "wechat", "miniprogram", "小程序", "小游戏"]],
  [/对抗审查|对抗评审|查盲区|盲区|挑刺|压测代码|adversarial\s*review|stress\s*test/i, ["interrogate", "review", "adversarial", "盲区"]],
  [/影响范围|波及范围|会破坏什么|blast\s*radius/i, ["blast-radius", "blast", "radius", "break"]],
  [/架构设计|数据结构|模块边界|模块结构|system\s*architecture/i, ["architect", "design", "types", "module"]],
  [/删注释|多余注释|清理注释|no[- ]comments/i, ["no-comments", "comment"]],
  [/去ai味|ai腔|空洞套话|unslop/i, ["unslop", "writing"]],
  [/性能基准|基准测试|benchmark|性能回归/i, ["benchmark-checklist", "perf", "benchmark"]],
  [/先写测试|回归测试|单元测试|单测|测试驱动|\btdd\b/i, ["tdd", "test", "regression"]],
  [/视觉质感|液态玻璃|滚动卡片|微交互|界面质感|ui\s*polish|design\s*tips|动效质感/i, ["kubai-design-tips", "ui", "design"]],
  [/技术写作|撰写\s*rfc|pr\s*描述规范|technical[- ]writing/i, ["technical-writing", "docs"]],
  [/并行对比|多方案对比|竞品原型|arena/i, ["arena", "prototype"]],
  [/根因排查|先复现|严谨修复|poteto/i, ["poteto-mode", "bug", "fix"]],
  [/设计动机|当初为什么|历史原因/i, ["why", "rationale"]],
  [/怎么工作|源码走读|讲透原理/i, ["how", "teach", "walkthrough"]],
  [/打磨提示词|优化提示词|重写\s*prompt|需求模糊|润色提示词/i, ["sharpen", "reframe"]],
  [/复盘总结|总结教训|反复犯错/i, ["reflect", "correct"]],
  [/状态机|tla\+|形式化验证|并发竞争|race\s*condition/i, ["statechart", "create-formal-verification-skill", "formal"]],
  [/生成.*验证技能|端到端验证技能|create[- ]verification/i, ["create-verification-skill", "maintain-verification-skill"]]
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
            terms.set(t, 0.6);
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
