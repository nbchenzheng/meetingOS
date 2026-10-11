// server/transcript-service.mjs
// 转录增强服务：复用 DeepSeek V4 Pro 做「批量（非流式）」整理与思维导图生成。
// 设计约束：
//  - 无状态、不读库、不写库（边界 7/8）。
//  - 所有 LLM 调用都通过 streamDeepSeek 收集全文后一次性返回。
//  - refine/mindmap 出错由调用方（api-server）兜底降级，本模块只负责抛出可读异常。
import { streamDeepSeek } from './llm-router.mjs'
import { randomUUID } from 'node:crypto'

const REFINE_MODEL = 'deepseek-v4-pro' // 与 big-shot 使用同一 model 字符串

// —— Prompt 构造 ——

// 整理润色：改造为「结构化纪要 + 关键词 + 来源锚点」一次 LLM 调用产出受限 JSON
function buildRefineMessages(entries) {
  const transcript = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.text && e.text.trim())
    .map((e) => {
      const who = e.speaker || (e.roleId ? `#${e.roleId}` : e.type === 'opinion' ? '大咖AI' : '发言人')
      return `- [id=${e.id}] [${e.ts}] [${who}] ${e.text}`
    })
    .join('\n')
  return [
    {
      role: 'system',
      content:
        '你是会议纪要整理助手。请基于下面逐条给出的会议转录（每条已标注条目 id、时间戳、说话人），' +
        '整理成结构化纪要，并一次性输出一个 JSON 对象（不要任何解释，不要 Markdown 代码块包裹）。\n' +
        'JSON 结构：\n' +
        '{\n' +
        '  "chapters": [\n' +
        '    {\n' +
        '      "id": "ch_1",\n' +
        '      "title": "章节小标题（≤24字）",\n' +
        '      "paragraphs": [\n' +
        '        { "id":"p_1", "text":"要点文本", "type":"conclusion|normal",\n' +
        '          "sourceEntryId":"对应转录条目 id", "sourceTs":"对应条目 ts（ISO8601）", "aiSupplement": false }\n' +
        '      ],\n' +
        '      "actionItems": [\n' +
        '        { "id":"a_1", "text":"行动项描述", "owner":"负责人（AI推断，可空）", "due":"截止（可空）",\n' +
        '          "sourceEntryId":"来源条目 id", "sourceTs":"来源 ts" }\n' +
        '      ]\n' +
        '    }\n' +
        '  ],\n' +
        '  "keywords": [ { "word":"关键词", "count": 命中次数(整数,可空) } ],\n' +
        '  "plainText": "由章节文本拼接而成的可阅读全文（便于降级展示）"\n' +
        '}\n' +
        '约束：\n' +
        '1) sourceEntryId 必须取自下方给定条目的 id 列表（严禁编造）；无法对应时省略该字段；\n' +
        '2) 章节 ≤6，每章段落 ≤12，行动项 ≤10；标题 ≤24 字（超出截断加「…」）；\n' +
        '3) 结论性要点 type 用 "conclusion"，其余用 "normal"；AI 推断补充且原文未出现的内容 aiSupplement:true；\n' +
        '4) 严格保留原意，不虚构内容。',
    },
    { role: 'user', content: transcript || '（无转录内容）' },
  ]
}

// 思维导图：从转录抽取主题/分支/要点，仅输出受限 JSON（叶子节点尽力回带 entryIds）
function buildMindmapMessages(rawText, entryIds) {
  const idHint =
    Array.isArray(entryIds) && entryIds.length
      ? `\n可用的转录条目 id 列表（仅可从此列表选取）：[${entryIds.join(', ')}]`
      : ''
  return [
    {
      role: 'system',
      content:
        '你是思维导图抽取助手。请从给定的会议转录文本中抽取主题、分支与要点，并仅输出一个 JSON 对象，结构为：\n' +
        '{"title": string, "children": [{"title": string, "children": [...]}]}\n' +
        '约束：\n' +
        '1) 嵌套深度不超过 4 层；\n' +
        '2) 每一层子节点数量不超过 8 个；\n' +
        '3) 每个标题不超过 24 个汉字；\n' +
        '4) 只输出合法 JSON，不要任何解释，也不要用 Markdown 代码块包裹；\n' +
        '5) 叶子节点（无 children 的节点）可在对象中附加 "entryIds": string[] 字段，' +
        '尽力回带该要点对应的转录条目 id（仅取自下方提供的 id 列表，最多 8 个）；若无法确定来源则省略该字段。' +
        idHint,
    },
    { role: 'user', content: rawText },
  ]
}

// 从 LLM 文本中稳健解析结构化纪要 JSON（与 parseMindmapJson 同策略）
function parseRefinedJson(text) {
  if (!text || typeof text !== 'string') return null
  let cleaned = text.trim()
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  cleaned = cleaned.slice(start, end + 1)
  try {
    const obj = JSON.parse(cleaned)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    return obj
  } catch {
    return null
  }
}

// 归一化结构化纪要：章节/段落/行动项层级兜底 + 来源锚点校验（仅保留真实存在的 entry id）
function normalizeRefined(raw, entries) {
  if (!raw || typeof raw !== 'object') return null
  const validIds = new Set(
    Array.isArray(entries) ? entries.map((e) => (e && e.id) || '').filter(Boolean) : [],
  )
  const cleanId = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
  const cleanTs = (v) =>
    typeof v === 'string' && v.trim() && !Number.isNaN(Date.parse(v)) ? v.trim() : undefined

  const chapters = Array.isArray(raw.chapters) ? raw.chapters : []
  const normChapters = chapters
    .slice(0, 6)
    .map((ch, ci) => {
      const rawTitle = typeof ch.title === 'string' && ch.title.trim() ? ch.title.trim() : ''
      const title = rawTitle ? (rawTitle.length > 24 ? `${rawTitle.slice(0, 24)}…` : rawTitle) : `章节 ${ci + 1}`
      const paragraphs = Array.isArray(ch.paragraphs) ? ch.paragraphs : []
      const normParas = paragraphs
        .slice(0, 12)
        .map((p, pi) => {
          const text = typeof p.text === 'string' ? p.text.trim() : ''
          if (!text) return null
          const sourceEntryId =
            typeof p.sourceEntryId === 'string' && validIds.has(p.sourceEntryId) ? p.sourceEntryId : undefined
          return {
            id: cleanId(p.id, `p_${ci}_${pi}`),
            text,
            type: p.type === 'conclusion' ? 'conclusion' : 'normal',
            sourceEntryId,
            sourceTs: sourceEntryId ? cleanTs(p.sourceTs) : undefined,
            aiSupplement: p.aiSupplement === true,
          }
        })
        .filter(Boolean)
      const items = Array.isArray(ch.actionItems) ? ch.actionItems : []
      const normItems = items
        .slice(0, 10)
        .map((a, ai) => {
          const text = typeof a.text === 'string' ? a.text.trim() : ''
          if (!text) return null
          const sourceEntryId =
            typeof a.sourceEntryId === 'string' && validIds.has(a.sourceEntryId) ? a.sourceEntryId : undefined
          return {
            id: cleanId(a.id, `a_${ci}_${ai}`),
            text,
            owner: typeof a.owner === 'string' && a.owner.trim() ? a.owner.trim() : null,
            due: typeof a.due === 'string' && a.due.trim() ? a.due.trim() : null,
            sourceEntryId,
            sourceTs: sourceEntryId ? cleanTs(a.sourceTs) : undefined,
          }
        })
        .filter(Boolean)
      return { id: cleanId(ch.id, `ch_${ci}`), title, paragraphs: normParas, actionItems: normItems }
    })
    .filter((c) => c.paragraphs.length > 0 || c.actionItems.length > 0)

  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords
        .map((k) =>
          typeof k === 'string'
            ? { word: k }
            : {
                word: typeof k.word === 'string' ? k.word : '',
                count: typeof k.count === 'number' ? k.count : undefined,
              },
        )
        .filter((k) => k.word && k.word.trim())
        .slice(0, 24)
    : []

  let plainText = typeof raw.plainText === 'string' && raw.plainText.trim() ? raw.plainText.trim() : ''
  if (!plainText) {
    plainText = normChapters
      .map((c) => `${c.title}\n${c.paragraphs.map((p) => p.text).join('\n')}`)
      .join('\n\n')
  }

  return {
    structured: { chapters: normChapters, keywords, plainText },
    plainText,
    keywords,
  }
}

// —— 底层：收集 streamDeepSeek 全文 ——

// 迭代 streamDeepSeek 的逐字 delta，累加为完整文本；可选 onToken 回调供上层使用。
async function collectDeepSeek(messages, signal, onToken) {
  let full = ''
  for await (const delta of streamDeepSeek({ messages, signal })) {
    if (onToken) onToken(delta)
    full += delta
  }
  return full
}

// —— 对外 API ——

// 整理润色：重构为「结构化纪要 + 关键词 + 来源锚点」一次 LLM 调用；出错向上抛出（由 api-server 捕获降级）。
// 返回 { structured, plainText, keywords } 或 null（由 api-server 转 degraded）。
export async function refine(entries, signal) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const messages = buildRefineMessages(entries)
  const text = await collectDeepSeek(messages, signal)
  const parsed = parseRefinedJson(text)
  if (!parsed) return null
  return normalizeRefined(parsed, entries)
}

// 思维导图：解析 LLM 返回的 JSON，必要时以 meetingTitle 覆盖根标题，最后归一化。
// 入参 rawText 为空或 LLM 返回非法 JSON 时返回 null（由 api-server 转 degraded）。
export async function mindmap(rawText, meetingTitle, signal, validIds) {
  if (!rawText || !rawText.trim()) return null
  const messages = buildMindmapMessages(rawText, validIds)
  const text = await collectDeepSeek(messages, signal)
  const parsed = parseMindmapJson(text)
  if (!parsed) return null
  const normalized = normalizeMindmap(parsed, 0)
  if (!normalized) return null
  // 决策 2：若前端提供了会议标题，以其为根标题（LLM 只负责生成子分支）。
  // 该覆盖放在归一化之后，确保根标题为会议标题（不被 24 字截断规则削掉）。
  if (meetingTitle && String(meetingTitle).trim()) {
    normalized.title = String(meetingTitle).trim()
  }
  return normalized
}

// —— 工具：从 LLM 文本中稳健解析思维导图 JSON ——

function parseMindmapJson(text) {
  if (!text || typeof text !== 'string') return null
  let cleaned = text.trim()
  // 去掉可能的 Markdown 代码块包裹（```json ... ```）
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) cleaned = fence[1].trim()
  // 定位第一个 { 与最后一个 }，容忍前后多余文字
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  cleaned = cleaned.slice(start, end + 1)
  try {
    const obj = JSON.parse(cleaned)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    return obj
  } catch {
    return null
  }
}

// —— 归一化：深度≤4 / 每层≤8 / 标题≤24 字 ——
// 递归归一化单个节点：
//  - depth >= 4：丢弃 children（叶子化）；
//  - 任一节点 title 超过 24 字：截断并加「…」；
//  - 每层 children 超过 8：截断保留前 8；
//  - title 为空或节点非法：返回 null（由上层过滤）。
export function normalizeMindmap(node, depth = 0, validIds) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null
  let title = typeof node.title === 'string' ? node.title : node.title == null ? '' : String(node.title)
  if (!title.trim()) return null
  if (title.length > 24) title = `${title.slice(0, 24)}…`

  let children = []
  if (depth < 4 && Array.isArray(node.children)) {
    children = node.children
      .map((c) => normalizeMindmap(c, depth + 1, validIds))
      .filter((c) => c !== null)
      .slice(0, 8)
  }
  const entryIds =
    Array.isArray(node.entryIds) && Array.isArray(validIds) && validIds.length
      ? node.entryIds.filter((id) => validIds.includes(id)).slice(0, 8)
      : undefined
  return entryIds && entryIds.length ? { title, children, entryIds } : { title, children }
}

// ===== 会议总结生成（增量功能 T1）=====
// 复用 streamDeepSeek（deepseek-v4-pro）与 collectDeepSeek 文本收集。
// 让 LLM 直接产出六要素受限 JSON，parseSummaryJson 稳健解析，normalizeSummary 兜底结构。
// 出错或解析失败向上抛出，由 api-server 捕获降级（保留原始转录，绝不白屏）。

// 六要素固定顺序与默认标题（LLM 缺失时兜底）
const ELEMENT_DEFS = [
  { key: 'meta', title: '会议主题与时间' },
  { key: 'topics', title: '核心议题' },
  { key: 'conclusions', title: '关键结论与决策' },
  { key: 'actions', title: '行动项 / 待办' },
  { key: 'views', title: '各预设大咖核心观点摘要' },
  { key: 'thread', title: '整体脉络' },
]

// 主题默认标题（决策 #1）：标题缺失或仍为占位值时回退固定主题
const DEFAULT_SUMMARY_TITLE = 'AI大咖会议私董会'

/** 解析会议标题：占位值或非空时回退默认值。 */
function resolveSummarySubject(title) {
  if (title && typeof title === 'string' && title.trim() && title.trim() !== '未命名私董会') {
    return title.trim()
  }
  return DEFAULT_SUMMARY_TITLE
}

// 构造 LLM 消息：六要素约束 + 逐字稿 + 大咖白名单
function buildSummaryMessages(entries, meta) {
  // 合并 speech / opinion 为带说话人的转录文本，按时间排序
  const transcriptText = entries
    .filter((e) => e && (e.type === 'speech' || e.type === 'opinion') && e.text && e.text.trim())
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .map((e) => {
      const who = e.speaker || (e.roleId ? `#${e.roleId}` : '发言人')
      return `[${who}] ${e.text}`
    })
    .join('\n')

  const bigShotHint = meta.bigShots && meta.bigShots.length
    ? meta.bigShots.map((b) => `- ${b.cn}（${b.title || ''}）`).join('\n')
    : '（无预设大咖）'

  const system =
    '你是资深私董会会议纪要官。请根据下方的会议转录，生成结构化的会后总结。\n' +
    '要求：\n' +
    '1) 只输出一个 JSON 对象，不要任何解释，不要用 Markdown 代码块包裹；\n' +
    '2) JSON 结构如下：\n' +
    '{\n' +
    '  "subject": string,            // 会议主题，无法判断时用给定标题\n' +
    '  "occurredAt": string,         // 会议时间（ISO 8601），取自给定参数\n' +
    '  "elements": [                 // 固定 6 项，顺序固定，每项可折叠\n' +
    '    { "key": "meta",       "title": "会议主题与时间",      "content": "..." },\n' +
    '    { "key": "topics",     "title": "核心议题",            "content": "..." },\n' +
    '    { "key": "conclusions", "title": "关键结论与决策",      "content": "..." },\n' +
    '    { "key": "actions",    "title": "行动项 / 待办",       "content": "..." },\n' +
    '    { "key": "views",      "title": "各预设大咖核心观点摘要", "content": "..." },\n' +
    '    { "key": "thread",     "title": "整体脉络",            "content": "..." }\n' +
    '  ],\n' +
    '  "bigShots": [                // 要素5 的结构化展开，仅针对下列预设大咖\n' +
    '    { "roleId": string, "cn": string, "title": string, "viewpoint": string }\n' +
    '  ]\n' +
    '}\n' +
    '3) 每个 content 使用简练中文，可含必要的要点列表（用换行分隔）；不要虚构内容；\n' +
    '   转录中未涉及的信息写「（会议未涉及）」。\n' +
    `4) 预设大咖白名单（仅对下列角色提炼观点，roleId 必须完全一致）：\n${bigShotHint}\n` +
    '   若某预设大咖在转录中无明确观点，仍保留其条目，viewpoint 写「本次会议未见其明确观点」。'
  const user =
    `会议标题：${meta.title || '（未命名）'}\n` +
    `会议时间：${meta.occurredAt || ''}\n\n` +
    `转录内容：\n${transcriptText || '（无转录内容）'}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// 从 LLM 文本中稳健解析总结 JSON（与 parseMindmapJson 同策略）
function parseSummaryJson(text) {
  if (!text || typeof text !== 'string') return null
  let cleaned = text.trim()
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  cleaned = cleaned.slice(start, end + 1)
  try {
    const obj = JSON.parse(cleaned)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    return obj
  } catch {
    return null
  }
}

// 归一化六要素：以固定定义兜底，缺失要素补空内容，保证恒为 6 项
function normalizeElements(rawEls) {
  const map = new Map()
  if (Array.isArray(rawEls)) {
    for (const e of rawEls) {
      if (e && typeof e === 'object' && typeof e.key === 'string') {
        map.set(e.key, e)
      }
    }
  }
  return ELEMENT_DEFS.map((def) => {
    const found = map.get(def.key)
    return {
      key: def.key,
      title: found && typeof found.title === 'string' && found.title.trim() ? found.title : def.title,
      content: found && typeof found.content === 'string' ? found.content : '',
      collapsed: found && typeof found.collapsed === 'boolean' ? found.collapsed : false,
    }
  })
}

// 归一化预设大咖观点：以白名单兜底，确保每个预设大咖都有条目
function normalizeBigShots(rawShots, meta) {
  const whiteList = Array.isArray(meta.bigShots) ? meta.bigShots : []
  const map = new Map()
  if (Array.isArray(rawShots)) {
    for (const b of rawShots) {
      if (b && typeof b.roleId === 'string') map.set(b.roleId, b)
    }
  }
  return whiteList.map((w) => {
    const id = w.id || w.roleId
    const found = id ? map.get(id) : undefined
    return {
      roleId: id || '',
      cn: (found && found.cn) || w.cn || '',
      title: (found && found.title) || w.title || '',
      viewpoint: found && typeof found.viewpoint === 'string' ? found.viewpoint : '本次会议未见其明确观点',
    }
  })
}

// 归一化 SummaryResult：subject/occurredAt 由 meta 决定（确定性，不依赖 LLM 措辞）
function normalizeSummary(raw, meta) {
  if (!raw || typeof raw !== 'object') return null
  const level = raw.level === 'brief' ? 'brief' : 'detailed'
  const subject = resolveSummarySubject(meta.title)
  const occurredAt = meta.createdAt && typeof meta.createdAt === 'string'
    ? meta.createdAt
    : (typeof raw.occurredAt === 'string' ? raw.occurredAt : '')
  const elements = normalizeElements(raw.elements)
  const bigShots = normalizeBigShots(raw.bigShots, meta)
  return { level, subject, occurredAt, elements, bigShots }
}

// 生成六要素会议总结：流式收集 → 解析 JSON → 归一化兜底。
export async function summarize(entries, meta, signal) {
  const messages = buildSummaryMessages(entries, meta)
  const text = await collectDeepSeek(messages, signal)
  const parsed = parseSummaryJson(text)
  if (!parsed) return null
  return normalizeSummary(parsed, meta)
}

// ===== 会中实时点评（增量功能 T1）=====
// 复用 streamDeepSeek（deepseek-v4-pro）与 collectDeepSeek 文本收集。
// 让 LLM 直接产出受限 JSON {type,text}，parseCommentaryJson 稳健解析。
// 出错或解析失败向上抛出，由 api-server 捕获降级（保留历史，不白屏）。
export const COMMENTARY_MODEL = 'deepseek-v4-pro'
/** LLM 轻量点评正文上限（架构 §8.4）。 */
export const LLM_COMMENTARY_MAX_CHARS = 80
/** 点评类型枚举（架构 §4.1）。 */
const COMMENTARY_TYPES = ['highlight', 'risk', 'clarify', 'suggestion']

/** 归一化点评类型：确保落在四枚举之一，非法/缺失回退 highlight。 */
export function normalizeCommentaryType(type) {
  return ['highlight', 'risk', 'clarify', 'suggestion'].includes(type) ? type : 'highlight'
}

// RECENT_COMMENTARY_DEDUP_WINDOW 需与前端一致（架构 §8.4）
const RECENT_COMMENTARY_DEDUP_WINDOW = 10

// 构造 LLM 消息：四类型约束 + 近期去重提示 + 当前话题 + 转录片段
function buildCommentaryMessages(rawText, ctx) {
  const meetingTitle = ctx && ctx.meetingTitle ? `会议主题：${ctx.meetingTitle}\n` : ''
  const topics =
    Array.isArray(ctx && ctx.topTopics) && ctx.topTopics.length
      ? `当前核心话题：${ctx.topTopics.join('、')}\n`
      : ''
  const recent =
    Array.isArray(ctx && ctx.recentCommentary) && ctx.recentCommentary.length
      ? '近期已点评（请避免重复观点）：\n' +
        ctx.recentCommentary
          .slice(-RECENT_COMMENTARY_DEDUP_WINDOW)
          .map((c) => `- [${c.type}] ${c.text}`)
          .join('\n') +
        '\n'
      : ''
  const system =
    '你是私董会实时点评助手。请针对下面的会议实时转录片段，给出一条简短、犀利、可执行的「会中点评」。\n' +
    '要求：\n' +
    '1) 只输出一个 JSON 对象，不要任何解释，不要用 Markdown 代码块包裹；\n' +
    '2) JSON 结构：{"type": string, "text": string}\n' +
    '   - type 只能取：highlight（高亮要点）/ risk（风险预警）/ clarify（澄清疑问）/ suggestion（行动建议）；\n' +
    '   - text 是点评正文，中文，80 字以内，一句话即可；不要问候、不要总结全文，只点一处；\n' +
    '3) 若本片段信息很少或无可评点，输出 {"type":"highlight","text":""}（空 text 表示跳过）；\n' +
    '4) 紧扣当前正在讨论的内容，给出新洞察或风险提示，不要泛泛而谈。'
  const user = `${meetingTitle}${topics}${recent}转录片段：\n${rawText || '（无转录内容）'}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// 从 LLM 文本中稳健解析点评 JSON（与 parseMindmapJson 同策略）
function parseCommentaryJson(text) {
  if (!text || typeof text !== 'string') return null
  let cleaned = text.trim()
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  cleaned = cleaned.slice(start, end + 1)
  try {
    const obj = JSON.parse(cleaned)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    const type = typeof obj.type === 'string' ? obj.type : 'highlight'
    const t = typeof obj.text === 'string' ? obj.text : ''
    return { type, text: t }
  } catch {
    return null
  }
}

/**
 * 生成一条 LLM 轻量点评，直接返回完整 Commentary(source:'llm')（设计 §4.2 / §5.1）。
 * 窗口无可点评（解析失败 / LLM 返回空 text / type=none）时返回 null，由 api-server 转 commentary:null。
 * LLM 网络/超时异常向上抛出，由路由捕获降级（保留历史，不白屏）。
 */
export async function liveCommentary(rawText, ctx = {}, signal) {
  if (!rawText || !String(rawText).trim()) return null
  const messages = buildCommentaryMessages(rawText, ctx)
  const text = await collectDeepSeek(messages, signal)
  const parsed = parseCommentaryJson(text)
  if (!parsed || !parsed.type || parsed.type === 'none' || !parsed.text || !String(parsed.text).trim()) {
    return null
  }
  const type = COMMENTARY_TYPES.includes(parsed.type) ? parsed.type : 'suggestion'
  let ctext = String(parsed.text).trim()
  if (ctext.length > LLM_COMMENTARY_MAX_CHARS) ctext = ctext.slice(0, LLM_COMMENTARY_MAX_CHARS)
  const now = new Date().toISOString()
  const trigger = ctx && ctx.trigger === 'topic' ? 'topic' : 'timer'
  return {
    id: randomUUID().slice(0, 8),
    source: 'llm',
    roleId: '',
    roleCn: '',
    color: '',
    type,
    text: ctext,
    ts: now,
    anchorTs: (ctx && ctx.anchorTs) || now,
    anchorEntryIds: Array.isArray(ctx && ctx.anchorEntryIds) ? ctx.anchorEntryIds : [],
    trigger,
    pinned: false,
    ignored: false,
    importance: 2,
  }
}
