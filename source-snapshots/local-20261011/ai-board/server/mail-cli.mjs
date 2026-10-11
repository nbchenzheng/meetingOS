// server/mail-cli.mjs
// 封装 agently-cli 的 `message +send` 两步确认发信。
// 负责：构造 CLI 参数、spawn 子进程、解析 stdout JSON、退出码→错误码映射、可重试。
//
// CLI 契约（主理人实机验证，照搬）：
//  - 第一次：`agently-cli message +send --to <email> --subject <str> --body <str>`
//      stdout JSON: {"ok":true,"data":{"confirmation_required":true,"confirmation_token":"ctk_<uuid>", ...}}
//  - 确认：`agently-cli message +send --confirmation-token ctk_<uuid>`
//  - 发件人固定 weispace@agent.qq.com（主别名，无需 --alias）
//  - 退出码映射见 mapExitCode / EXIT_RETRYABLE（设计 §4.3）
import { spawn } from 'node:child_process'

// 超时保护（主理人决策：建议 30s）；可由环境变量覆盖（测试用）
export const CLI_TIMEOUT_MS = Number(process.env.MAIL_CLI_TIMEOUT_MS || 30000)
const SEND_MAX_RETRIES = 2
const SEND_RETRY_BACKOFF_MS = 1500
// 退出码 1（服务端抖动）/4（本地网络）→ 可重试（设计 §4.3）
const EXIT_RETRYABLE = new Set([1, 4])

// 可注入的 spawn 实现（生产用真实 spawn；测试替换为 fake）
let _spawn = spawn
// 可覆盖的超时（测试避免等待 30s）
let cliTimeoutMs = CLI_TIMEOUT_MS

/** 仅测试使用：替换 spawn 实现。 */
export function __setSpawnForTest(fn) {
  _spawn = fn
}
/** 仅测试使用：调整超时（避免测试等待 30s）。 */
export function __setTimeoutForTest(ms) {
  cliTimeoutMs = ms
}

// 退出码 → 错误码映射（设计 §4.3）
function mapExitCode(code) {
  switch (code) {
    case 0:
      return null // 成功
    case 2:
      return 'CLI_AUTH_EXPIRED'
    case 3:
      return 'RECIPIENT_INVALID'
    case 6:
      return 'CTK_MISSING'
    case 7:
      return 'CLI_NOT_FOUND'
    default:
      return 'UNKNOWN'
  }
}

// 各错误码的可读中文文案（绝不回显密钥/堆栈）
export const CLI_ERROR_MESSAGES = {
  CLI_AUTH_EXPIRED: '发信组件授权已过期，请联系管理员刷新授权',
  RECIPIENT_INVALID: '收件人邮箱无效，请检查后重试',
  CTK_MISSING: '未获取到发信确认令牌，请重新发送',
  CLI_NOT_FOUND: '发信组件未安装，请联系管理员',
  NETWORK_ERROR: '发信组件响应超时或网络异常，请稍后重试',
  UNKNOWN: '发信失败，请稍后重试',
}

// 视为「基础设施降级」的错误码（前端展示 warn 而非致命 error）
const DEGRADED_CODES = new Set(['CLI_NOT_FOUND', 'CLI_AUTH_EXPIRED', 'NETWORK_ERROR', 'UNKNOWN'])

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 从 stdout 文本稳健提取 JSON（容忍前后日志噪声）
function extractJson(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  const slice = trimmed.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

// 底层：spawn CLI，返回 {exitCode, stdout, stderr, spawnError?, timedOut?}
function runCli(args, { timeoutMs = cliTimeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    let child
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    const onAbort = () => {
      try {
        child?.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish({ exitCode: null, stdout, stderr, spawnError: new Error('aborted') })
    }
    try {
      child = _spawn('agently-cli', args, { cwd: process.cwd() })
    } catch (err) {
      return finish({ exitCode: null, stdout, stderr, spawnError: err })
    }
    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      // ENOENT → CLI 未安装
      finish({ exitCode: null, stdout, stderr, spawnError: err })
    })
    child.on('close', (code) => {
      finish({ exitCode: code, stdout, stderr, spawnError: null })
    })
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
    timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish({ exitCode: null, stdout, stderr, spawnError: null, timedOut: true })
    }, timeoutMs)
  })
}

// 解析成功响应：stage 取 ctk；confirm 只判成功
function parseSuccess(mode, stdout) {
  const json = extractJson(stdout)
  if (mode === 'stage') {
    const token = json?.data?.confirmation_token || json?.confirmation_token
    if (!token) {
      return { ok: false, code: 'CTK_MISSING', error: CLI_ERROR_MESSAGES.CTK_MISSING, degraded: false }
    }
    return { ok: true, token }
  }
  // confirm：成功即可
  return { ok: true }
}

/**
 * 执行 agently-cli 发信（stage 取 ctk / confirm 真发）。
 * @param {object} opts
 *   mode: 'stage' | 'confirm'
 *   email, subject, html, attachmentPath, token, signal
 * @returns {Promise<{ok:boolean, token?:string, code?:string, error?:string, degraded?:boolean}>}
 */
export async function runAgentlySend(opts) {
  const { mode, email, subject, html, attachmentPath, token, signal } = opts
  let args
  if (mode === 'confirm') {
    // 确认阶段：实机 CLI 契约只需 --confirmation-token（无需 --subject/--body/--attachment），
    // 避免真实 CLI 在确认阶段对多余参数敏感 / 拒绝 / 重复触发，导致端到端真发失败。
    args = ['message', '+send', '--confirmation-token', token ?? '']
  } else {
    args = ['message', '+send', '--to', email]
    if (subject) args.push('--subject', subject)
    // body 上限 1MB（主理人实机约束）：六要素总结 HTML 走 --body
    if (html) args.push('--body', html)
    // 全部逐字稿必须作为附件（不能塞 body）
    if (attachmentPath) args.push('--attachment', attachmentPath)
  }

  let attempt = 0
  // 退出码 1/4 可重试（最多 2 次带短退避）；其余一次即映射
  while (true) {
    const r = await runCli(args, { signal })
    // CLI 不存在（spawn ENOENT）
    if (r.spawnError && r.spawnError.code === 'ENOENT') {
      return { ok: false, code: 'CLI_NOT_FOUND', error: CLI_ERROR_MESSAGES.CLI_NOT_FOUND, degraded: true }
    }
    // 超时 / 信号中止 / 其它 spawn 异常 → 统一 NETWORK_ERROR（降级）
    if (r.timedOut || r.spawnError) {
      return { ok: false, code: 'NETWORK_ERROR', error: CLI_ERROR_MESSAGES.NETWORK_ERROR, degraded: true }
    }
    const exitCode = r.exitCode
    if (exitCode === 0) {
      return parseSuccess(mode, r.stdout)
    }
    // 可重试且未达上限
    if (EXIT_RETRYABLE.has(exitCode) && attempt < SEND_MAX_RETRIES) {
      attempt += 1
      await sleep(SEND_RETRY_BACKOFF_MS)
      continue
    }
    const code = mapExitCode(exitCode) || 'UNKNOWN'
    const error = CLI_ERROR_MESSAGES[code] || CLI_ERROR_MESSAGES.UNKNOWN
    const degraded = DEGRADED_CODES.has(code)
    return { ok: false, code, error, degraded }
  }
}
