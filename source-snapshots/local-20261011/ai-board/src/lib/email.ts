// src/lib/email.ts —— 邮箱格式校验（前端禁空/禁非法，后端再校验）
//
// 设计约束：仅做格式校验，不发任何请求；真实发信在 T2 后端（summary-service.mjs）。
// 正则覆盖「非空 / 含 @ / @ 前后非空白 / 含点分域」的最基础形态，具体合法性由后端兜底。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 校验邮箱格式。
 * @param email 用户输入的邮箱字符串
 * @returns 是否通过最基础格式校验
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  const v = email.trim()
  // 上限 254 字符（RFC 5321），超长一律视为非法，避免后端截断歧义
  if (!v || v.length > 254) return false
  return EMAIL_RE.test(v)
}
