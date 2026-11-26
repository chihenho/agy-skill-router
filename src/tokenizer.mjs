const EN_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "how", "i", "in", "is", "it", "its", "my", "not", "of", "on", "or", "our",
  "that", "the", "their", "them", "then", "there", "these", "this", "to", "use",
  "using", "was", "we", "when", "where", "which", "who", "will", "with", "you",
  "your", "only", "activate", "explicitly", "requested", "user", "skill", "skills",
  "me", "no", "ok", "okay", "yes", "one", "two", "all", "any", "can", "also",
  "get", "set", "new", "now", "see", "out", "into", "about", "what", "just",
  "more", "some", "make", "need", "want", "time", "md", "json", "txt", "http",
  "https", "com", "org", "www", "input", "output", "users"
]);

const CJK_PARTICLES = new Set([
  "的", "了", "着", "过", "吗", "呢", "吧", "啊", "呀", "嘛", "啦", "哦", "嗯",
  "得", "地", "之", "和", "与", "或", "把", "被", "给", "让", "对", "向", "到",
  "从", "在", "是", "有", "不", "这", "那", "个", "些", "我", "你", "他", "她",
  "它", "们", "您", "请", "帮", "很", "太", "都", "也", "就", "还", "再", "仅",
  "一", "么", "啥", "哪", "谁", "几"
]);

const CJK_STOP_BIGRAMS = new Set([
  "一下", "一个", "一些", "一起", "一样", "一直", "一般", "一次", "一段", "可以",
  "没有", "什么", "如果", "需要", "使用", "目前", "现在", "已经", "这里", "那里",
  "怎么", "如何", "可能", "应该", "就是", "还是", "或者", "以及", "因为", "所以",
  "但是", "不过", "然后", "其他", "自己", "直接", "开始", "完成", "继续", "确认",
  "看看", "处理", "问题", "工作", "用户", "方案", "更新", "记录", "内容", "信息",
  "相关", "对应", "支持", "进行", "通过", "根据", "关于", "之后", "之前", "最近",
  "刚才", "另外", "同样", "其实", "必须", "尽量", "顺便", "稍微", "大概", "好像",
  "觉得", "意思", "时候", "地方", "东西", "情况", "方面", "部分", "主要", "具体",
  "基本", "简单", "正常", "默认", "当前", "本地", "所有", "全部", "每个", "指定",
  "生成", "回复", "请求", "结果", "提供", "包含", "用于", "适用", "能够", "是否",
  "还有", "这样", "那样", "因此", "虽然", "而且", "并且", "不仅", "比如", "例如",
  "等等", "左右", "前后", "里面", "外面", "上面", "下面", "马上", "正在", "重新",
  "自动", "手动", "页面", "显示", "查看", "检查", "调整", "修改", "新增", "删除",
  "添加", "去掉", "保留", "补充", "参考", "建议", "注意", "避免", "确保", "实现",
  "功能", "操作", "方式", "步骤", "效果", "影响", "原因", "目的", "目标", "需求",
  "背景", "讨论", "说明", "描述", "介绍", "总结", "分析"
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
  [/生成.*验证技能|端到端验证技能|create[- ]verification/i, ["create-verification-skill", "maintain-verification-skill"]],
  [/归档对话|历史会话|会话管理|恢复对话|session[- ]manager/i, ["session-manager", "archive", "transcript"]],
  [/token\s*审计|token\s*消耗|上下文瘦身|token[- ]audit/i, ["token-audit", "token", "context"]],
  [/代码骨架|skeleton|符号索引|code[- ]skeleton/i, ["code-skeleton", "skeleton", "index"]]
];

function stripUrlsAndPaths(text) {
  return String(text || "")
    .replace(/https?:\/\/[^\s)>"']+/gi, " ")
    .replace(/(?:~|\/[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+){2,}/g, " ");
}

export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const lower = stripUrlsAndPaths(text).toLowerCase();
  const tokens = [];

  // English / alphanumeric tokens (preserving hyphenated compound + sub-parts, skipping pure numbers)
  const enMatches = lower.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
  for (const tok of enMatches) {
    if (/^\d+(?:-\d+)*$/.test(tok)) continue;
    if (tok.includes("-")) {
      tokens.push(tok);
      for (const part of tok.split("-")) {
        if (part.length >= 2 && !/^\d+$/.test(part) && !EN_STOP_WORDS.has(part)) {
          tokens.push(part);
        }
      }
    } else if (tok.length >= 2 && !EN_STOP_WORDS.has(tok)) {
      tokens.push(tok);
    }
  }

  // CJK segments -> bigrams for multi-char segments (skipping particle boundaries and generic stop-bigrams),
  // unigram only when a standalone single character is non-particle.
  const cjkSegments = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of cjkSegments) {
    const chars = [...seg];
    if (chars.length === 1) {
      if (!CJK_PARTICLES.has(chars[0])) {
        tokens.push(chars[0]);
      }
      continue;
    }
    for (let i = 0; i < chars.length - 1; i += 1) {
      if (CJK_PARTICLES.has(chars[i]) || CJK_PARTICLES.has(chars[i + 1])) continue;
      const bg = chars[i] + chars[i + 1];
      if (CJK_STOP_BIGRAMS.has(bg)) continue;
      tokens.push(bg);
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
