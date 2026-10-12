// server/meeting-service.mjs
// 会议状态 / 简报 / 资料 / 转录 / 意见 的运行时状态（内存为主 + JSON 落盘，便于重启恢复）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 数据根目录：默认 server/data；测试通过 AI_BOARD_DATA_DIR 指向临时目录，避免污染真实数据。
// 注意：本常量在模块加载时求值，设置 env 必须发生在 import 之前。
const DATA_DIR = process.env.AI_BOARD_DATA_DIR || join(__dirname, 'data')
const MEETINGS_FILE = join(DATA_DIR, 'meetings.json')

const meetings = new Map()

function loadPersisted() {
  try {
    if (!existsSync(MEETINGS_FILE)) return
    const arr = JSON.parse(readFileSync(MEETINGS_FILE, 'utf8'))
    if (Array.isArray(arr)) {
      for (const m of arr) meetings.set(m.id, m)
    }
  } catch {
    /* 忽略损坏的持久化文件 */
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(MEETINGS_FILE, JSON.stringify([...meetings.values()], null, 2), 'utf8')
  } catch {
    /* 落盘失败不影响内存态 */
  }
}

// —— 逐字稿合并落盘 ——
// persist() 是「全量同步写盘」（writeFileSync 整个 meetings 文件），而 addTranscript 每句都调用：
// 若每句都紧跟 persist()，会在流式发声 / 长会议期间反复同步阻塞事件循环（同时拖住 SSE 推送）。
// 故逐字稿走 1s 窗口合并写；其余写操作仍 persist() 立即落盘，行为不变。
const TRANSCRIPT_PERSIST_DELAY_MS = 1000
let transcriptPersistTimer = null

function persistTranscriptSoon() {
  if (transcriptPersistTimer) return
  transcriptPersistTimer = setTimeout(() => {
    transcriptPersistTimer = null
    persist()
  }, TRANSCRIPT_PERSIST_DELAY_MS)
  // 进程有常驻 HTTP 服务，unref 不会导致提前退出，但可避免待落盘定时器拖住退出
  if (typeof transcriptPersistTimer.unref === 'function') transcriptPersistTimer.unref()
}

// 立即写出待落盘的逐字稿（进程退出前 / 测试做确定性断言时调用）
export function flushTranscriptPersist() {
  if (transcriptPersistTimer) {
    clearTimeout(transcriptPersistTimer)
    transcriptPersistTimer = null
  }
  persist()
}

// 退出前保证待落盘内容已写出。
// - process.on('exit')：对正常退出 / process.exit() 有效（含 Windows）。
// - SIGTERM / SIGINT：仅 POSIX 有效；Windows 上进程收到信号会被直接终止，
//   信号处理器与 'exit' 都不触发，强杀不保证落盘（最坏丢 1s 窗口内的逐字稿）。
process.on('exit', () => {
  if (transcriptPersistTimer) {
    transcriptPersistTimer = null
    persist()
  }
})
process.once('SIGTERM', () => {
  flushTranscriptPersist()
  process.exit(143)
})
process.once('SIGINT', () => {
  flushTranscriptPersist()
  process.exit(130)
})

loadPersisted()

export function createMeeting({ title, brief, roleIds } = {}) {
  const id = randomUUID().slice(0, 8)
  const meeting = {
    id,
    title: String(title ?? '未命名私董会').trim() || '未命名私董会',
    brief: String(brief ?? '').trim(),
    roleIds: Array.isArray(roleIds) ? roleIds : [],
    materials: [],
    transcript: [],
    opinions: [],
    commentaries: [], // 会中实时点评（big-shot 主动点评持久化于此，llm 源为前端本地）
    commentaryEnabled: true, // 实时点评总开关（默认开）
    mindmapTopBranches: [], // 最近一次思维导图顶层分支标题（话题切换检测主信号）
    createdAt: new Date().toISOString(),
  }
  meetings.set(id, meeting)
  persist()
  return meeting
}

export function getMeeting(id) {
  return meetings.get(id) ?? null
}

export function updateMeeting(id, { title, brief, commentaryEnabled } = {}) {
  const m = meetings.get(id)
  if (!m) return null
  if (typeof title === 'string') m.title = title.trim() || m.title
  if (typeof brief === 'string') m.brief = brief
  if (typeof commentaryEnabled === 'boolean') m.commentaryEnabled = commentaryEnabled
  meetings.set(id, m)
  persist()
  return m
}

// ===== 会中实时点评（增量 T1）=====

/** 追加一条点评（llm / bigshot 均可），并落盘。沿用转录 200 条上限控内存。 */
export function addCommentary(id, commentary) {
  const m = meetings.get(id)
  if (!m) return null
  const c = { ...commentary }
  if (!Array.isArray(m.commentaries)) m.commentaries = []
  m.commentaries.push(c)
  if (m.commentaries.length > 200) m.commentaries = m.commentaries.slice(-200)
  meetings.set(id, m)
  persist()
  return c
}

/** 读取会议全部点评（缺字段时回退空数组，兼容旧持久化文件）。 */
export function getCommentaries(id) {
  const m = meetings.get(id)
  return Array.isArray(m?.commentaries) ? m.commentaries : []
}

/** 设置实时点评总开关（false=静音：前端停 LLM 采集 + 后端跳过大咖主动点评）。 */
export function setCommentaryEnabled(id, enabled) {
  const m = meetings.get(id)
  if (!m) return
  m.commentaryEnabled = Boolean(enabled)
  meetings.set(id, m)
  persist()
}

/** 记录最近一次思维导图顶层分支标题（话题切换检测主信号，零额外 LLM 成本）。 */
export function setMindmapTopBranches(id, branches) {
  const m = meetings.get(id)
  if (!m) return
  m.mindmapTopBranches = Array.isArray(branches) ? branches.map(String) : []
  meetings.set(id, m)
  persist()
}

export function addMaterial(id, { name, type, parsedText, sizeBytes } = {}) {
  const m = meetings.get(id)
  if (!m) return null
  const doc = {
    id: randomUUID().slice(0, 8),
    name: String(name ?? 'material'),
    type: String(type ?? 'txt'),
    parsedText: String(parsedText ?? ''),
    sizeBytes: Number(sizeBytes ?? 0),
    addedAt: new Date().toISOString(),
  }
  m.materials.push(doc)
  meetings.set(id, m)
  persist()
  return doc
}

export function listMaterials(id) {
  return getMeeting(id)?.materials ?? []
}

export function addTranscript(id, { text, final = true, id: clientId } = {}) {
  const m = meetings.get(id)
  if (!m) return null
  // 优先沿用前端条目 id（保证会中点评 anchorEntryIds 与前端 data-entry-ids 一致，@关联定位可命中）
  const eid = typeof clientId === 'string' && clientId ? clientId : randomUUID().slice(0, 8)
  const entry = {
    id: eid,
    text: String(text ?? '').trim(),
    final: Boolean(final),
    ts: new Date().toISOString(),
  }
  if (!entry.text) return null
  m.transcript.push(entry)
  // 逐字稿不截断：换取「一个字不丢」（用户明确要求）。代价是 persist() 全量写体积随会议时长增长，
  // 已由 addTranscript 的 1s 合并落盘（persistTranscriptSoon）缓解写频次。
  meetings.set(id, m)
  // 与其它写操作一致地落盘；逐字稿高频，走 1s 窗口合并写（见 persistTranscriptSoon）
  persistTranscriptSoon()
  return entry
}

export function listTranscript(id) {
  return getMeeting(id)?.transcript ?? []
}

export function addOpinion(id, { roleId, text, severity = 'info', trigger = 'manual' } = {}) {
  const m = meetings.get(id)
  if (!m) return null
  const opinion = {
    id: randomUUID().slice(0, 8),
    roleId: String(roleId ?? ''),
    text: String(text ?? ''),
    severity: String(severity ?? 'info'),
    trigger: String(trigger ?? 'manual'),
    ts: new Date().toISOString(),
  }
  m.opinions.push(opinion)
  meetings.set(id, m)
  persist()
  return opinion
}

export function listOpinions(id) {
  return getMeeting(id)?.opinions ?? []
}

// 全文转录（供 LLM prompt 使用）。
// 口径：**存储 / 展示 / 导出都不截断（一个字不丢）；只有 LLM 输入做窗口保护**。
// 放开 200 条上限后，长会议的全文会无限增长，直接拼进 prompt 会撑爆上下文 / 触发上游 400，
// 故这里从末尾向前累积到 maxChars 为止（越近的内容对当下的发言越重要），返回时保持正序。
// exportMarkdown 是直取 m.transcript，不经过本函数，导出仍是全量。
export function transcriptText(id, { maxChars = 24000 } = {}) {
  const m = getMeeting(id)
  if (!m) return ''
  const texts = (m.transcript || []).map((t) => t.text)
  const out = []
  let len = 0
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const t = texts[i]
    // 至少保留最后一句，避免单句就超限时返回空串
    if (len + t.length > maxChars && out.length) break
    out.unshift(t)
    len += t.length + 1 // +1 为连接换行
  }
  return out.join('\n')
}

// 取最近若干句转录（从末尾向前累积，直到超过 maxChars），用于大咖「最近发言」窗口
export function recentTranscriptText(id, { maxChars = 600 } = {}) {
  const m = getMeeting(id)
  if (!m) return ''
  const texts = m.transcript.filter((t) => t.final).map((t) => t.text)
  const out = []
  let len = 0
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const t = texts[i]
    if (len + t.length > maxChars && out.length) break
    out.unshift(t)
    len += t.length
  }
  return out.join('\n')
}

export function materialsText(id) {
  const m = getMeeting(id)
  if (!m) return ''
  return m.materials
    .map((d) => `【资料：${d.name}】\n${d.parsedText}`)
    .join('\n\n')
}

export function exportMarkdown(id) {
  const m = getMeeting(id)
  if (!m) return '# 会议纪要\n\n（会议不存在）\n'
  const lines = [
    `# 会议纪要：${m.title}`,
    '',
    `> 生成时间：${new Date().toISOString()}`,
    '',
  ]
  if (m.brief) {
    lines.push('## 项目简报', '', m.brief, '')
  }
  if (m.materials.length) {
    lines.push('## 会议资料', '')
    for (const d of m.materials) lines.push(`- ${d.name}（${d.type}，${d.sizeBytes} 字节）`)
    lines.push('')
  }
  lines.push('## 实时转录', '')
  if (m.transcript.length) {
    for (const t of m.transcript) lines.push(`- ${t.text}`)
  } else {
    lines.push('- （无转录）')
  }
  lines.push('', '## 大咖意见', '')
  const ranked = [...m.opinions].sort((a, b) => {
    const w = { risk: 0, warn: 1, info: 2 }
    return (w[a.severity] ?? 2) - (w[b.severity] ?? 2)
  })
  if (ranked.length) {
    for (const o of ranked) lines.push(`- **[${o.severity}]** ${o.roleId}（${o.trigger}）：${o.text}`)
  } else {
    lines.push('- （暂无意见）')
  }
  lines.push('', '## 会中实时点评精选', '')
  const comms = Array.isArray(m.commentaries) ? m.commentaries : []
  if (comms.length) {
    // 优先展示：已收藏(pinned) 与 风险(risk) 项，其余按类型权重排序
    const weight = { risk: 0, highlight: 1, suggestion: 2, clarify: 3 }
    const pin = (x) => (x.pinned ? -2 : 0)
    const sorted = [...comms].sort(
      (a, b) =>
        // G4：括号必须补齐。`??` 优先级低于 `+`/`-`，原写法
        // `weight[a.type] ?? 2 + pin(a) - (...)` 会被解析成
        // `weight[a.type] ?? (2 + pin(a) - (...))`；只要 a.type 命中权重表，
        // 比较器就直接返回 a 的权重（0~3 的常量，与 b 无关），排序整体失效。
        (weight[a.type] ?? 2) + pin(a) - ((weight[b.type] ?? 2) + pin(b)),
    )
    for (const c of sorted) {
      const src = c.source === 'bigshot' ? `[大咖·${c.roleCn || c.roleId || ''}]` : '[AI]'
      lines.push(`- **[${c.type}]** ${src}：${c.text}`)
    }
  } else {
    lines.push('- （暂无点评）')
  }
  lines.push('', '---', '_本纪要由 AI 大咖会议私董会生成，内容为大咖角色基于公开认知的风格化模拟，仅供参考，非本人真实发言。_')
  return lines.join('\n')
}
