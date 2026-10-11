// server/meeting-service.mjs
// 会议状态 / 简报 / 资料 / 转录 / 意见 的运行时状态（内存为主 + JSON 落盘，便于重启恢复）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
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
  // 仅保留最近 200 句，控制 prompt 长度
  if (m.transcript.length > 200) m.transcript = m.transcript.slice(-200)
  meetings.set(id, m)
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

export function transcriptText(id) {
  const m = getMeeting(id)
  if (!m) return ''
  return m.transcript.map((t) => t.text).join('\n')
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
        weight[a.type] ?? 2 + pin(a) - ((weight[b.type] ?? 2) + pin(b)),
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
