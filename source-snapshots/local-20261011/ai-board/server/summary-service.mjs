// server/summary-service.mjs
// 两步确认发信编排：stage → confirm。
// 持有 ctkStore（进程内 Map<confirmationRef, {token, expiresAt, meta}>），前端仅持 confirmationRef。
// 依赖 mail-cli（spawn agently-cli）与 quota（日配额）。
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as mailCli from './mail-cli.mjs'
import { quota } from './quota.mjs'

// ctk 有效期：主理人决策 ~5 分钟（参考 agently skill）；可由测试覆盖
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000
// 邮件正文 body 上限 1MB（主理人实机约束）
export const MAIL_BODY_MAX_BYTES = 1 * 1024 * 1024
// 临时逐字稿附件目录（相对服务进程 cwd，部署后 /opt/aiboard）
const TMP_DIR = join(process.cwd(), '.tmp')

// 可注入的 TTL（测试用），默认 CONFIRMATION_TTL_MS
let ttlMs = CONFIRMATION_TTL_MS
/** 仅测试使用：调整 ctk 有效期。 */
export function __setTtlForTest(ms) {
  ttlMs = ms
}

// 进程内 ctk 暂存：confirmationRef → {token, expiresAt, meta}
const ctkStore = new Map()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false
  const v = email.trim()
  if (!v || v.length > 254) return false
  return EMAIL_RE.test(v)
}

function estimateBytes(str) {
  return Buffer.byteLength(str || '', 'utf8')
}

// 按 UTF-8 字节截断到 maxBytes，且截断点回退到字符边界（避免切断多字节字符 / 代理对）。
// 直接 String.slice 按 UTF-16 码元截断，中文每码元可达 3 字节，会突破 CLI 的 --body≤1MB 约束。
function truncateUtf8ByBytes(str, maxBytes) {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str
  let lo = 0
  let hi = str.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (Buffer.byteLength(str.slice(0, mid), 'utf8') <= maxBytes) lo = mid
    else hi = mid - 1
  }
  // 若截断点恰好落在高代理项（代理对前半），再退一格，避免产生孤立代理项
  if (lo > 0 && lo < str.length && str.charCodeAt(lo - 1) >= 0xd800 && str.charCodeAt(lo - 1) <= 0xdbff) {
    lo -= 1
  }
  return str.slice(0, lo)
}

function generateConfirmationRef() {
  return `cfr_${randomUUID()}`
}

// HTML 转义（防注入 + 保证邮件 HTML 合法）
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 构造六要素总结 HTML（body 承载，≤1MB）
function buildSummaryHtml(summary) {
  const safe = (s) => escapeHtml(s == null ? '' : s)
  const parts = []
  parts.push(`<h1>【AI大咖会议私董会】${safe(summary.subject)} · 会议总结</h1>`)
  parts.push(`<p><b>会议时间：</b>${safe(summary.occurredAt || '—')}</p>`)
  for (const el of summary.elements || []) {
    parts.push(`<h2>${safe(el.title)}</h2>`)
    const content = safe(el.content || '（无内容）').replace(/\n/g, '<br/>')
    parts.push(`<div>${content}</div>`)
  }
  if (summary.bigShots && summary.bigShots.length) {
    parts.push('<h2>各预设大咖核心观点</h2>')
    parts.push('<ul>')
    for (const b of summary.bigShots) {
      const view = safe(b.viewpoint || '（本次会议未见其明确观点）')
      parts.push(`<li><b>${safe(b.cn)}</b>（${safe(b.title)}）：${view}</li>`)
    }
    parts.push('</ul>')
  }
  parts.push('<p><i>逐字稿见附件。</i></p>')
  return parts.join('\n')
}

// 构造邮件（subject + body HTML + 逐字稿附件文本）
function buildMail(summary, transcriptText) {
  const subject = `【AI大咖会议私董会】${summary.subject || 'AI大咖会议私董会'} · 会议总结`
  const html = buildSummaryHtml(summary)
  const hasAttachment = Boolean(transcriptText && String(transcriptText).trim())
  return { subject, html, attachmentText: hasAttachment ? String(transcriptText) : '', hasAttachment }
}

// 临时逐字稿附件文件（发完即删）
function writeTranscriptTemp(meetingId, text) {
  mkdirSync(TMP_DIR, { recursive: true })
  const file = join(TMP_DIR, `transcript-${meetingId}.txt`)
  writeFileSync(file, text, 'utf8')
  return file
}
function removeTranscriptTemp(file) {
  if (!file) return
  try {
    if (existsSync(file)) rmSync(file, { force: true })
  } catch {
    /* 忽略清理失败 */
  }
}

/**
 * step1：校验邮箱、构造邮件、调 CLI 取 ctk、暂存并返回 confirmationRef + preview。
 * @param {string} meetingId
 * @param {string} recipientEmail
 * @param {object} summary SummaryResult（六要素结构化结果）
 * @param {string} transcriptText 全部逐字稿文本（作为附件）
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ok:boolean, confirmationRef?:string, preview?:object, code?:string, error?:string, degraded?:boolean}>}
 */
export async function stage(meetingId, recipientEmail, summary, transcriptText, signal) {
  if (!validateEmail(recipientEmail)) {
    return { ok: false, code: 'RECIPIENT_INVALID', error: '收件人邮箱格式不正确' }
  }
  const { subject, html, attachmentText, hasAttachment } = buildMail(summary, transcriptText)
  // body 上限 1MB 守卫：极端情况下总结超长则截断，避免 CLI 拒绝（逐字稿已在附件，不在此承载）
  let finalHtml = html
  if (estimateBytes(finalHtml) > MAIL_BODY_MAX_BYTES) {
    // 按 UTF-8 字节截断并回退到字符边界（避免切断多字节字符 / 代理对，突破 1MB 限制）
    finalHtml = truncateUtf8ByBytes(finalHtml, MAIL_BODY_MAX_BYTES)
  }
  let attachmentPath = null
  if (hasAttachment) {
    attachmentPath = writeTranscriptTemp(meetingId, attachmentText)
  }
  const cliRes = await mailCli.runAgentlySend({
    mode: 'stage',
    email: recipientEmail,
    subject,
    html: finalHtml,
    attachmentPath,
    signal,
  })
  if (!cliRes.ok) {
    removeTranscriptTemp(attachmentPath)
    return { ok: false, code: cliRes.code, error: cliRes.error, degraded: cliRes.degraded }
  }
  const confirmationRef = generateConfirmationRef()
  const expiresAt = Date.now() + ttlMs
  const elementCount = Array.isArray(summary.elements) ? summary.elements.length : 0
  ctkStore.set(confirmationRef, {
    token: cliRes.token,
    expiresAt,
    meta: {
      email: recipientEmail,
      subject,
      html: finalHtml,
      attachmentPath,
      hasAttachment,
      elementCount,
    },
  })
  const preview = {
    email: recipientEmail,
    subject,
    elementCount,
    hasAttachment,
    sizeHintBytes: estimateBytes(finalHtml),
  }
  return { ok: true, confirmationRef, preview }
}

/**
 * step2：取 ctk 真发，配额计数，清理暂存。
 * @param {string} confirmationRef
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ok:boolean, preview?:object, code?:string, error?:string, degraded?:boolean}>}
 */
export async function confirm(confirmationRef, signal) {
  if (!confirmationRef) {
    return { ok: false, code: 'CONFIRMATION_EXPIRED', error: '确认信息缺失或已失效' }
  }
  const entry = ctkStore.get(confirmationRef)
  if (!entry) {
    return { ok: false, code: 'CONFIRMATION_EXPIRED', error: '确认已失效，请重新发送' }
  }
  if (Date.now() > entry.expiresAt) {
    ctkStore.delete(confirmationRef)
    removeTranscriptTemp(entry.meta.attachmentPath)
    return { ok: false, code: 'CONFIRMATION_EXPIRED', error: '确认已过期，请重新发送' }
  }
  // 配额计数时机：step2 实际发送时（设计 §7.4 / 共享知识 #4）
  if (!quota.checkAndInc()) {
    ctkStore.delete(confirmationRef)
    removeTranscriptTemp(entry.meta.attachmentPath)
    return { ok: false, code: 'QUOTA_EXCEEDED', error: '今日发信额度已用完，请明日再试' }
  }
  const cliRes = await mailCli.runAgentlySend({
    mode: 'confirm',
    email: entry.meta.email,
    subject: entry.meta.subject,
    html: entry.meta.html,
    attachmentPath: entry.meta.attachmentPath,
    token: entry.token,
    signal,
  })
  // confirmationRef 一次性消费：无论成败都清理（防重放），并删除临时附件
  ctkStore.delete(confirmationRef)
  removeTranscriptTemp(entry.meta.attachmentPath)
  if (!cliRes.ok) {
    return { ok: false, code: cliRes.code, error: cliRes.error, degraded: cliRes.degraded }
  }
  const preview = {
    email: entry.meta.email,
    subject: entry.meta.subject,
    elementCount: entry.meta.elementCount || 0,
    hasAttachment: Boolean(entry.meta.attachmentPath),
    sizeHintBytes: estimateBytes(entry.meta.html),
  }
  return { ok: true, preview }
}

/** 仅测试 / 运维：清空 ctkStore 并删除其临时文件。 */
export function __resetStoreForTest() {
  for (const e of ctkStore.values()) removeTranscriptTemp(e.meta?.attachmentPath)
  ctkStore.clear()
}

// —— ctk TTL 定时清理（防泄漏/误用；每 60s 扫描过期项并删临时文件）——
function startTtlSweeper() {
  if (process.env.NODE_ENV === 'test') return // 测试环境不启定时器，避免挂起
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [ref, entry] of ctkStore) {
      if (now > entry.expiresAt) {
        removeTranscriptTemp(entry.meta?.attachmentPath)
        ctkStore.delete(ref)
      }
    }
  }, 60 * 1000)
  // 不阻止进程退出（仅服务常驻需要）
  if (typeof timer.unref === 'function') timer.unref()
}
startTtlSweeper()
