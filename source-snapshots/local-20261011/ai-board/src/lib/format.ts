// src/lib/format.ts —— 时间格式化（相对会议起点偏移 / 时钟）
/** 相对会议起点的偏移，格式 +MM:SS（用于来源标注 / 占比 / 导出）。 */
export function fmtOffset(ts: string, baseTs?: string): string {
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return ''
  const base = baseTs ? new Date(baseTs).getTime() : t
  const diff = Math.max(0, Math.round((t - base) / 1000))
  const mm = String(Math.floor(diff / 60)).padStart(2, '0')
  const ss = String(diff % 60).padStart(2, '0')
  return `+${mm}:${ss}`
}

/** 绝对时钟 HH:MM:SS（用于导出原始时间戳）。 */
export function fmtClock(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
