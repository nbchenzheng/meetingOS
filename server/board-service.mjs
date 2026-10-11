// server/board-service.mjs
// 私董会核心：拼装 prompt、流式生成意见、关键词命中自动发言。
import { streamLLM } from './llm-router.mjs'
import * as meetingSvc from './meeting-service.mjs'

// 萃取内容优先取 dossier；为空则回退 persona + focus（架构 T11 留接口）
function extractionText(role) {
  if (role.dossier && role.dossier.trim()) return role.dossier
  const focus = Array.isArray(role.focus) && role.focus.length ? role.focus.join('、') : '战略与执行'
  return `人设：${role.persona || ''}\n关注点：${focus}`
}

export function assembleMessages(role, transcript, docs, recentTranscript = '') {
  const extraction = extractionText(role)
  const system = [
    `你正在参加一场「AI 大咖会议私董会」，你是角色【${role.cn}】，${role.title}。`,
    `你的视角与风格：${role.persona || ''}`,
    `你的思想萃取（请据此把握语气、立场与关注点）：\n${extraction}`,
    '',
    '任务：以【背景资料】为事实依据，结合【全部转录】把握全局、以【最近发言】聚焦当下，给出一条有依据、犀利、可执行的董事式分析意见。要求：',
    '1. 中文，4-7 句，控制在 200 字以内（可稍长以容纳分析）；',
    '2. 紧扣会议正在讨论的内容，不要泛泛而谈；优先用【背景资料】与【最近发言】支撑观点；',
    '3. 以分析+建议口吻、基于公开认知，不编造具体数据或事实；',
    '4. 若资料/转录信息不足，先抛出一个关键追问引导讨论，不要凭空发挥。',
  ].join('\n')

  const user = [
    `【背景资料（会议上传的文档/资料）】\n${docs || '（无上传资料）'}`,
    '',
    `【全部转录（会议全程文字）】\n${transcript || '（尚无转录，请根据背景资料与你的判断，主动给出一条开场意见）'}`,
    '',
    `【最近发言（最近几句，重点参考）】\n${recentTranscript || '（暂无）'}`,
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// 流式生成一条意见：异步生成器逐字 yield 文本 delta
export async function* generateOpinion({ role, transcript, docs, recentTranscript, signal }) {
  const messages = assembleMessages(role, transcript, docs, recentTranscript)
  for await (const delta of streamLLM({ model: role.model, messages, signal, role })) {
    yield delta
  }
}

// 关键词命中自动发言：统计各角色 focus 在转录中的命中数，返回 top-N 候选
export function autoPickSpeakers({ roles, transcriptText, limit = 2 }) {
  const text = String(transcriptText || '')
  if (!text.trim()) return []
  const scored = roles
    .map((role) => {
      const focus = Array.isArray(role.focus) ? role.focus : []
      const hits = focus.filter((kw) => kw && text.includes(kw)).length
      return { roleId: role.id, hits }
    })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  return scored.slice(0, limit).map((item) => item.roleId)
}

/**
 * 会中点评大咖挑选（增量 T2）：复用 focus 命中相关性，排除近期已发言者。
 * @param roles 候选大咖（本次会议 roleIds 映射）
 * @param transcriptText 当前转录文本
 * @param recentRoleIds 近期已主动点评的 roleId 列表（去重）
 * @param limit 返回数量（默认 1）
 * @returns roleId[]（可能为空，表示无合适人选 → 调用方跳过）
 */
export function pickForCommentary({ roles, transcriptText, recentRoleIds = [], limit = 1 } = {}) {
  const text = String(transcriptText || '')
  if (!text.trim()) return []
  const exclude = new Set(recentRoleIds)
  const scored = roles
    .filter((r) => !exclude.has(r.id))
    .map((role) => {
      const focus = Array.isArray(role.focus) ? role.focus : []
      const hits = focus.filter((kw) => kw && text.includes(kw)).length
      return { roleId: role.id, hits }
    })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  return scored.slice(0, limit).map((item) => item.roleId)
}

export async function* speakForMeeting({ role, meetingId, signal, transcript, docs, recentTranscript } = {}) {
  const full = transcript ?? meetingSvc.transcriptText(meetingId)
  const recent = recentTranscript ?? meetingSvc.recentTranscriptText(meetingId, { maxChars: 600 })
  const docsText = docs ?? meetingSvc.materialsText(meetingId)
  yield* generateOpinion({ role, transcript: full, docs: docsText, recentTranscript: recent, signal })
}
