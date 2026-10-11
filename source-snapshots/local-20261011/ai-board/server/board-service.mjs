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

export function assembleMessages(role, transcript, docs) {
  const extraction = extractionText(role)
  const system = [
    `你正在参加一场「AI 大咖会议私董会」，你是角色【${role.cn}】，${role.title}。`,
    `你的视角与风格：${role.persona || ''}`,
    `你的思想萃取（请据此把握语气、立场与关注点）：\n${extraction}`,
    '',
    '任务：基于下方【实时会议转录】与【背景资料】，以你的第一人称视角，给出一条简短、犀利、可执行的董事式意见。要求：',
    '1. 中文，3-5 句，控制在 120 字以内；',
    '2. 紧扣会议正在讨论的内容，不要泛泛而谈；',
    '3. 以建议口吻、基于公开认知，不编造具体数据或事实；',
    '4. 若信息不足，先抛出一个关键追问，引导讨论。',
  ].join('\n')

  const user = [
    `【实时会议转录】\n${transcript || '（尚无转录，请根据背景资料与你的判断，主动给出一条开场意见）'}`,
    '',
    `【背景资料】\n${docs || '（无上传资料）'}`,
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// 流式生成一条意见：异步生成器逐字 yield 文本 delta
export async function* generateOpinion({ role, transcript, docs, signal }) {
  const messages = assembleMessages(role, transcript, docs)
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

export async function* speakForMeeting({ role, meetingId, signal }) {
  const transcript = meetingSvc.transcriptText(meetingId)
  const docs = meetingSvc.materialsText(meetingId)
  yield* generateOpinion({ role, transcript, docs, signal })
}
