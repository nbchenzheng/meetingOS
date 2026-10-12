// server/commentary-service.mjs
// 会中实时点评·大咖主动点评 + 话题切换检测（增量 T2）。
// 设计要点（架构 §二/§八）：
//  - 话题切换主信号：思维导图顶层分支 diff（零额外 LLM 成本）；辅信号：转场短语 + 弱信号(Jaccard)。
//  - 大咖主动点评：挑最相关 1 位 → 复用 board-service.generateOpinion 生成 → 镜像为 Commentary(source:'bigshot')。
//  - 去重窗口 15min / 频率上限 ≤20 / 最小间隔 60s / 单发言门控；commentaryEnabled=false 全程跳过。
//  - 生成成功后落库 meeting.commentaries + 经 ws-hub 推送到面板。
import { randomUUID } from 'node:crypto'
import * as meetingSvc from './meeting-service.mjs'
import * as boardSvc from './board-service.mjs'
import * as roleSvc from './role-service.mjs'
import * as wsHub from './ws-hub.mjs'

// —— 共享常量（与前端 CommentaryHook / 设计 §8.4 一致）——
export const COMMENTARY_TIMER_MS = 150_000 // 前端 LLM 采集周期（本模块未直接使用，仅作文档对齐）
export const COMMENTARY_MIN_GAP_MS = 60_000 // 最小间隔门控（防刷屏 / 单发言门控）
export const COMMENTARY_TOPIC_COOLDOWN_MS = 60_000 // 话题切换补采冷却
export const LLM_COMMENTARY_MAX_CHARS = 80
export const BIGSHOT_COMMENTARY_MAX_CHARS = 200
export const BIGSHOT_DEDUP_MS = 900_000 // 15min 大咖去重窗口
export const BIGSHOT_INTERVAL_MS = 270_000 // 4.5min 固定间隔门控（无话题则轮值 1 位）
export const BIGSHOT_FREQ_CAP = 20 // 单会议大咖主动点评上限
export const TOPIC_SILENCE_MS = 12_000 // 弱信号：相邻 final 段静默阈值
export const TOPIC_JACCARD_THRESHOLD = 0.3 // 弱信号：词重叠率低于此判切换
export const TRANSITION_PHRASES = [
  '接下来',
  '下一个议题',
  '我们讨论',
  '转到',
  '换个话题',
  '总结一下',
  '那关于',
  '回到',
]
export const RECENT_COMMENTARY_DEDUP_WINDOW = 10

// —— 每会议话题状态 ——
// topicStates: meetingId -> {
//   lastBranchKey, cooldownUntil, lastBigShotAt, lastAttemptAt, bigShotCount,
//   recentBigShots:[{roleId,text,ts}], lastFinalTs, lastWindowWords:[]
// }
const topicStates = new Map()

function getTopicState(meetingId) {
  if (!topicStates.has(meetingId)) {
    topicStates.set(meetingId, {
      lastBranchKey: '',
      cooldownUntil: 0,
      lastBigShotAt: 0,
      lastAttemptAt: 0,
      bigShotCount: 0,
      recentBigShots: [],
      lastFinalTs: 0,
      lastWindowWords: [],
    })
  }
  return topicStates.get(meetingId)
}

// —— 文本工具（零依赖，纯字符串/集合运算）——
function bigram(s) {
  const str = String(s || '')
  const chars = str.match(/[一-鿿]/g) || []
  const grams = []
  for (let i = 0; i < chars.length - 1; i++) grams.push(chars[i] + chars[i + 1])
  return grams
}

function dice(a, b) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let overlap = 0
  for (const g of a) if (setB.has(g)) overlap++
  return (2 * overlap) / (a.length + b.length)
}

function tokenize(text) {
  return String(text || '').match(/[一-鿿]|[a-zA-Z0-9]+/g) || []
}

function jaccard(a, b) {
  if (!a.length && !b.length) return 1
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const x of setA) if (setB.has(x)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

/** 大咖点评类型启发式（零额外 LLM）。 */
function deriveBigShotType(text) {
  const t = String(text || '')
  if (/风险|隐患|警惕|注意|危机|坑|雷/.test(t)) return 'risk'
  if (/结论|关键|核心|要点|重点|本质/.test(t)) return 'highlight'
  if (/建议|可以|应该|不妨|应当|推荐|不妨|值得|最好/.test(t)) return 'suggestion'
  if (/澄清|疑问|是否|是不是|？|\?|难道/.test(t)) return 'clarify'
  return 'suggestion'
}

/** 关联转录锚点：取最近 1~2 条 entry 作为 anchorEntryIds / anchorTs。 */
function deriveAnchor(meeting) {
  const entries = Array.isArray(meeting.transcript) ? meeting.transcript : []
  const last = entries[entries.length - 1]
  const prev = entries[entries.length - 2]
  const anchorEntryIds = []
  if (last) anchorEntryIds.push(last.id)
  if (prev) anchorEntryIds.push(prev.id)
  return {
    anchorTs: last?.ts || new Date().toISOString(),
    anchorEntryIds,
  }
}

/** 相似去重：与近期(15min 内)同大咖点评的 bigram Dice > 0.6 → 跳过。 */
function isSimilarRecent(state, roleId, text) {
  const now = Date.now()
  const grams = bigram(text)
  for (const b of state.recentBigShots) {
    if (now - new Date(b.ts).getTime() > BIGSHOT_DEDUP_MS) continue
    if (b.roleId === roleId && dice(grams, bigram(b.text)) > 0.6) return true
  }
  return false
}

// —— 触发门控（最小间隔 + 频率上限 + 开关）——
function maybeFire(meetingId) {
  const meeting = meetingSvc.getMeeting(meetingId)
  if (!meeting || meeting.commentaryEnabled === false) return
  if (meetingSvc.getCommentaries(meetingId).length >= BIGSHOT_FREQ_CAP) return
  const state = getTopicState(meetingId)
  const now = Date.now()
  if (now - state.lastAttemptAt < COMMENTARY_MIN_GAP_MS) return
  state.lastAttemptAt = now
  fireBigShot(meetingId).catch(() => {})
}

// —— 生成一条大咖主动点评并落库 + 推送 ——
async function fireBigShot(meetingId) {
  const meeting = meetingSvc.getMeeting(meetingId)
  if (!meeting || meeting.commentaryEnabled === false) return
  const state = getTopicState(meetingId)
  if (state.bigShotCount >= BIGSHOT_FREQ_CAP) return
  if (Date.now() - state.lastBigShotAt < COMMENTARY_MIN_GAP_MS) return

  const roles = (meeting.roleIds || [])
    .map((id) => roleSvc.getRole(id))
    .filter(Boolean)
  if (!roles.length) return

  const transcriptText = meetingSvc.transcriptText(meetingId)
  const recentRoleIds = state.recentBigShots.map((b) => b.roleId).slice(-3)
  const picks = boardSvc.pickForCommentary({ roles, transcriptText, recentRoleIds, limit: 1 })
  const roleId = picks && picks[0]
  if (!roleId) return

  const role = roleSvc.getRole(roleId)
  if (!role) return

  // 收集该大咖的一条意见（复用 generateOpinion / streamLLM），截断至 120 字
  let text = ''
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 30_000)
  try {
    for await (const delta of boardSvc.speakForMeeting({ role, meetingId, signal: ac.signal })) {
      text += delta
    }
  } catch {
    text = ''
  } finally {
    clearTimeout(timer)
  }
  text = (text || '').trim()
  if (!text) return
  text = text.slice(0, BIGSHOT_COMMENTARY_MAX_CHARS)

  // 相似去重（同大咖 15min 内）
  if (isSimilarRecent(state, roleId, text)) return

  const type = deriveBigShotType(text)
  const anchor = deriveAnchor(meeting)
  const commentary = {
    id: randomUUID().slice(0, 8),
    source: 'bigshot',
    roleId: role.id,
    roleCn: role.cn,
    color: role.color,
    type,
    text,
    ts: new Date().toISOString(),
    anchorTs: anchor.anchorTs,
    anchorEntryIds: anchor.anchorEntryIds,
    trigger: 'auto',
    pinned: false,
    ignored: false,
    importance: 2,
  }

  meetingSvc.addCommentary(meetingId, commentary)
  state.lastBigShotAt = Date.now()
  state.bigShotCount += 1
  state.recentBigShots.push({ roleId, text, ts: commentary.ts })
  if (state.recentBigShots.length > RECENT_COMMENTARY_DEDUP_WINDOW) state.recentBigShots.shift()

  // 经既有 WS 通道推送到面板（新增 commentary 消息类型）
  wsHub.broadcast(meetingId, { type: 'commentary', commentary })
}

// —— 对外 API ——

/**
 * 话题切换检测（主信号：思维导图顶层分支 diff）。
 * 计算新分支 key，与上次比较；变化则进入冷却并异步触发大咖点评。
 * 无论是否变化，都持久化最新分支（供重启恢复与 C-P2-2 消费）。
 */
export function onTopicSwitch(meetingId, branches = []) {
  const meeting = meetingSvc.getMeeting(meetingId)
  if (!meeting || meeting.commentaryEnabled === false) {
    // 仍记录分支（便于开关重新打开后对比），但不生成
    if (meeting) meetingSvc.setMindmapTopBranches(meetingId, branches)
    return
  }
  const state = getTopicState(meetingId)
  const key = [...branches].sort().join('|')
  const changed = key !== state.lastBranchKey
  state.lastBranchKey = key
  meetingSvc.setMindmapTopBranches(meetingId, branches)
  if (!changed) return
  if (Date.now() < state.cooldownUntil) return
  state.cooldownUntil = Date.now() + COMMENTARY_TOPIC_COOLDOWN_MS
  maybeFire(meetingId)
}

/**
 * 每句 final 转录钩子（辅信号 + 固定间隔门控）。
 * - 固定间隔：距上次大咖点评 > 4.5min 且无话题触发 → 轮值 1 位；
 * - 转场短语命中 → 冷却内则跳过，否则补一次；
 * - 弱信号：相邻 final 段静默 > 12s 且词重叠率 Jaccard < 0.3 → 判切换补一次；
 * 全程受 commentaryEnabled=false 跳过。
 */
export function onTranscript(meetingId, entry) {
  const meeting = meetingSvc.getMeeting(meetingId)
  if (!meeting || meeting.commentaryEnabled === false) return
  if (!entry || entry.final !== true || !entry.text || !entry.text.trim()) return

  const state = getTopicState(meetingId)
  const now = Date.now()

  // 固定间隔门控：超时则轮值 1 位（受 maybeFire 的 60s 最小间隔二次保护）
  if (now - state.lastBigShotAt > BIGSHOT_INTERVAL_MS) {
    maybeFire(meetingId)
    return
  }

  // 转场短语命中：冷却内跳过，否则补一次
  if (TRANSITION_PHRASES.some((p) => entry.text.includes(p))) {
    if (now >= state.cooldownUntil) {
      state.cooldownUntil = now + COMMENTARY_TOPIC_COOLDOWN_MS
      maybeFire(meetingId)
      return
    }
  }

  // 弱信号：相邻 final 段间隔过大 + 词重叠率低 → 判话题切换
  const entryTs = new Date(entry.ts).getTime()
  if (state.lastFinalTs && entryTs - state.lastFinalTs > TOPIC_SILENCE_MS) {
    const overlap = jaccard(tokenize(entry.text), state.lastWindowWords)
    if (overlap < TOPIC_JACCARD_THRESHOLD && now >= state.cooldownUntil) {
      state.cooldownUntil = now + COMMENTARY_TOPIC_COOLDOWN_MS
      maybeFire(meetingId)
      return
    }
  }
  state.lastFinalTs = entryTs
  state.lastWindowWords = tokenize(entry.text)
}
