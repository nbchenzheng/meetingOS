// server/quota.mjs
// weispace@agent.qq.com 进程内日配额计数（设计 §7 / 共享知识 #3）。
// 阈值 50/日（实机 +me：daily_send_quota=50）；进程重启清零（已知问题）。
export const DAILY_QUOTA = 50

let count = 0
let date = todayStr()

/**
 * 当前服务器本地日期（YYYY-MM-DD），以本地日切为基准。
 */
function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 检查并递增配额。
 * @returns {boolean} 未超限返回 true（已计数）；已超限返回 false（本次不计数）。
 */
export function checkAndInc() {
  const t = todayStr()
  if (t !== date) {
    // 跨日：清零重新计数
    count = 0
    date = t
  }
  if (count >= DAILY_QUOTA) return false
  count += 1
  return true
}

/**
 * 剩余配额数。
 * @returns {number}
 */
export function remaining() {
  const t = todayStr()
  if (t !== date) return DAILY_QUOTA
  return Math.max(0, DAILY_QUOTA - count)
}

/** 仅测试：重置计数与日切基准。 */
export function reset() {
  count = 0
  date = todayStr()
}

export const quota = { checkAndInc, remaining, reset, DAILY_QUOTA }
