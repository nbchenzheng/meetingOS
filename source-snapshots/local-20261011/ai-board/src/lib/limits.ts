// src/lib/limits.ts —— 会议资料上传的体积约束（单一事实来源，避免多处硬编码）
//
// 设计目标：把「附件过大导致进入会议卡死」这类问题前置到用户操作层拦截，
// 并让阈值在前后端各只出现一次，便于统一调整。

/**
 * 单份会议资料允许的最大体积（字节）。
 * 超过此阈值的附件在「进入会议」时会被拦截并提示拆分，
 * 避免把大文件（如 18MB PDF）直接送进后端做耗时 / 易失败的文本解析而静默卡死。
 */
export const MAX_MATERIAL_SIZE_BYTES = 15 * 1024 * 1024 // 15 MB

/** 软阈值：超过仅给出「解析可能较慢」的非阻断提醒，仍允许进入会议。 */
export const MATERIAL_SIZE_WARN_BYTES = 8 * 1024 * 1024 // 8 MB

/** 单个附件上传 / 解析的超时时间（毫秒）。超时即 abort 并给出可读提示，避免无限等待。 */
export const UPLOAD_TIMEOUT_MS = 30_000 // 30s

/** 将字节数格式化为人类可读文本，如 18.0 MB / 960.0 KB。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/** 判断单个文件是否超过硬上限（应被拦截）。 */
export function isMaterialOversized(file: { size: number }): boolean {
  return file.size > MAX_MATERIAL_SIZE_BYTES
}

/** 判断单个文件是否超过软阈值（仅提醒，不拦截）。 */
export function isMaterialLarge(file: { size: number }): boolean {
  return file.size > MATERIAL_SIZE_WARN_BYTES
}
