// server/transcribe-persist.mjs
// 修复 D：阿里云实时 ASR 回传的 interim 仅用于前端实时提示，不落库；
// 仅 final 结果才持久化，避免导出 / 自动发言 prompt 中塞满「今/今天/今天天气」重复碎片。
//
// 抽成纯函数并依赖注入（meetingSvc / commentarySvc），便于单测覆盖，
// 且 api-server 直接复用同一实现，保证「前端展示」与「后端落库」契约一致。
//
// @param {object} args
// @param {string} args.sessionId 会议会话 id（空则跳过，防御）
// @param {string} args.text 识别文本
// @param {boolean} args.final 是否整句定稿（interim 为 false）
// @param {{ addTranscript: (id: string, data: object) => any }} args.meetingSvc
// @param {{ onTranscript: (id: string, entry: any) => void }} [args.commentarySvc]
// @returns {any} 落库后的 entry；interim 或无 sessionId 时返回 null（不落库）
export function persistTranscriptIfFinal({ sessionId, text, final, meetingSvc, commentarySvc }) {
  if (!final || !sessionId) return null
  const entry = meetingSvc.addTranscript(sessionId, { text, final })
  if (entry && commentarySvc && typeof commentarySvc.onTranscript === 'function') {
    commentarySvc.onTranscript(sessionId, entry)
  }
  return entry
}
