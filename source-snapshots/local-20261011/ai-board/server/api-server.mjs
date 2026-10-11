// server/api-server.mjs
// 私董会主服务：REST 路由 + 发言 SSE(/speak) + 转录 WebSocket(/ws/board/transcribe)。
// 采用 Node 原生 http + ws，单进程同时托管。密钥经 dotenv 注入 process.env，禁止打印。
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

import * as roleSvc from './role-service.mjs'
import * as meetingSvc from './meeting-service.mjs'
import * as boardSvc from './board-service.mjs'
import { extractMaterialTextFromFile } from './material-service.mjs'
import { asrRuntimeConfig, createAliyunStream } from './asr-service.mjs'
import * as transcriptSvc from './transcript-service.mjs'
import * as commentarySvc from './commentary-service.mjs'
import * as summarySvc from './summary-service.mjs'
import * as wsHub from './ws-hub.mjs'

// 载入 .env（若存在）；零依赖手动解析，不打印任何密钥
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
if (existsSync(envPath)) {
  try {
    const text = readFileSync(envPath, 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    /* 忽略 .env 读取错误 */
  }
}

const PORT = Number(process.env.PORT || 3001)
// 生产环境静态资源根目录（Vite 构建产物），可由 WEB_ROOT 覆盖
const WEB_ROOT = join(__dirname, '..', process.env.WEB_ROOT || 'out')
// 整理接口对外标注的 model 名（与 big-shot / streamDeepSeek 保持一致）
const REFINE_MODEL = 'deepseek-v4-pro'

// 会议总结内存缓存：按 meetingId 缓存，避免重复消耗 LLM（设计 §7.4）
const summaryCache = new Map()

// 由 meeting 构造总结元信息（标题默认规则见决策 #1；bigShots 由 roleIds 映射白名单）
function buildSummaryMeta(meeting) {
  const title =
    meeting.title && meeting.title.trim() && meeting.title.trim() !== '未命名私董会'
      ? meeting.title.trim()
      : 'AI大咖会议私董会'
  const bigShots = (meeting.roleIds || [])
    .map((id) => roleSvc.getRole(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, cn: r.cn, title: r.title }))
  return { meetingId: meeting.id, title, createdAt: meeting.createdAt, bigShots }
}

// 由 meeting 构造全部逐字稿纯文本（按时间排序），作为邮件附件内容（设计微调：逐字稿走附件）
function buildTranscriptText(meeting) {
  return (meeting.transcript || [])
    .filter((e) => e && (e.type === 'speech' || e.type === 'opinion') && e.text && e.text.trim())
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .map((e) => `[${e.speaker || (e.roleId ? `#${e.roleId}` : '发言人')}] ${e.text}`)
    .join('\n')
}

// —— 通用工具 ——
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 32 * 1024 * 1024) {
        reject(new Error('payload_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// —— 发言 SSE 端点 ——
async function handleSpeak(req, res, meetingId, body) {
  const meeting = meetingSvc.getMeeting(meetingId)
  if (!meeting) return sendJson(res, 404, { ok: false, message: '会议不存在' })
  const role = roleSvc.getRole(body.roleId)
  if (!role) return sendJson(res, 404, { ok: false, message: '角色不存在' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const ac = new AbortController()
  req.on('close', () => ac.abort())

  send('start', { roleId: role.id, color: role.color, cn: role.cn })
  let full = ''
  try {
    for await (const delta of boardSvc.speakForMeeting({ role, meetingId, signal: ac.signal })) {
      full += delta
      send('token', { delta })
    }
  } catch {
    send('error', { message: '服务暂不可用' })
  }
  const opinion = meetingSvc.addOpinion(meetingId, {
    roleId: role.id,
    text: full,
    trigger: body.trigger === 'auto' ? 'auto' : 'manual',
  })
  send('end', { opinionId: opinion?.id, text: full })
  res.end()
}

// —— 路由分发 ——
async function router(req, res, url) {
  const path = url.pathname
  const method = req.method || 'GET'

  // 健康检查
  if (path === '/api/health') {
    return sendJson(res, 200, { ok: true, asr: asrRuntimeConfig() })
  }

  // —— 转录增强：整理润色（LLM 每 60s 调用）——
  if (path === '/api/transcript/refine' && method === 'POST') {
    const body = await readJsonBody(req)
    const entries = Array.isArray(body.entries) ? body.entries : []
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 25000) // 后端超时 25s，先于前端 30s 安全网
    const started = Date.now()
    try {
      if (entries.length === 0) {
        return sendJson(res, 200, { ok: false, refinedText: '', structured: null, error: '转录内容为空', degraded: true })
      }
      const result = await transcriptSvc.refine(entries, ac.signal)
      if (!result || !result.structured || result.structured.chapters.length === 0) {
        const fb = entries.map((e) => e.text).join('\n')
        return sendJson(res, 200, { ok: false, refinedText: fb, structured: null, error: '未能生成结构化纪要', degraded: true })
      }
      const tookMs = Date.now() - started
      return sendJson(res, 200, {
        ok: true,
        refinedText: result.plainText,
        structured: result.structured,
        keywords: result.keywords,
        model: REFINE_MODEL,
        tookMs,
      })
    } catch {
      const fb = entries.map((e) => e.text).join('\n')
      const tookMs = Date.now() - started
      return sendJson(res, 200, { ok: false, refinedText: fb, structured: null, error: '整理服务暂不可用，已保留原始转录', degraded: true })
    } finally {
      clearTimeout(timer)
    }
  }

  // —— 转录增强：思维导图（LLM 每 5min 调用）——
  if (path === '/api/transcript/mindmap' && method === 'POST') {
    const body = await readJsonBody(req)
    const rawText = typeof body.rawText === 'string' ? body.rawText : ''
    const meetingTitle = typeof body.meetingTitle === 'string' ? body.meetingTitle : ''
    // 可选 meetingId：用于话题切换检测（顶层分支 diff → 触发大咖主动点评）
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : ''
    // 可选 entryIds：供思维导图叶子节点回带来源锚点（B2）
    const entryIds = Array.isArray(body.entryIds) ? body.entryIds.filter((x) => typeof x === 'string') : []
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 40000) // 后端超时 40s，先于前端 45s 安全网
    const started = Date.now()
    try {
      if (!rawText.trim()) {
        return sendJson(res, 200, { ok: false, root: null, error: '转录内容为空', degraded: true })
      }
      const root = await transcriptSvc.mindmap(rawText, meetingTitle, ac.signal, entryIds)
      const tookMs = Date.now() - started
      if (!root) {
        return sendJson(res, 200, { ok: false, root: null, error: '未能生成思维导图', degraded: true })
      }
      // 话题切换主信号（零额外 LLM）：比较顶层分支 → 触发大咖主动点评
      if (meetingId) {
        const branches = Array.isArray(root.children)
          ? root.children.map((c) => (c && c.title) || '').filter(Boolean)
          : []
        commentarySvc.onTopicSwitch(meetingId, branches)
      }
      return sendJson(res, 200, { ok: true, root, tookMs })
    } catch {
      const tookMs = Date.now() - started
      return sendJson(res, 200, { ok: false, root: null, error: '思维导图服务暂不可用', degraded: true })
    } finally {
      clearTimeout(timer)
    }
  }

  // —— 会中实时点评：LLM 轻量点评（前端定时/话题补驱动，恒 200 降级）——
  if (path === '/api/transcript/commentary' && method === 'POST') {
    const body = await readJsonBody(req)
    const rawText = typeof body.rawText === 'string' ? body.rawText : ''
    const ctx = body.ctx && typeof body.ctx === 'object' ? body.ctx : {}
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 25000) // 后端超时 25s，先于前端安全网
    const started = Date.now()
    try {
      if (!rawText.trim()) {
        // 窗口无转录内容：返回 commentary:null（前端静默跳过，非降级）
        return sendJson(res, 200, { ok: true, commentary: null, tookMs: 0 })
      }
      // liveCommentary 直接返回完整 Commentary(source:'llm')（设计 §4.2 / §5.1），
      // 此处仅做空值校验与超时/降级包装，不重复构造。
      const commentary = await transcriptSvc.liveCommentary(rawText, ctx, ac.signal)
      const tookMs = Date.now() - started
      // 本窗口无可点评（解析失败 / LLM 返回空 text）：前端静默跳过
      if (!commentary || !commentary.text || !commentary.text.trim()) {
        return sendJson(res, 200, { ok: true, commentary: null, tookMs })
      }
      return sendJson(res, 200, { ok: true, commentary, tookMs, model: REFINE_MODEL })
    } catch {
      const tookMs = Date.now() - started
      // 无论 LLM 成败均返回 200 + ok:false，不绝白屏，保留历史
      return sendJson(res, 200, { ok: false, commentary: null, error: '点评服务暂不可用，已保留历史', degraded: true })
    } finally {
      clearTimeout(timer)
    }
  }

  // —— 会议总结：六要素结构化生成（按 meetingId 缓存，恒 200 降级）——
  if (path === '/api/summary/generate' && method === 'POST') {
    const body = await readJsonBody(req)
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : ''
    const entries = Array.isArray(body.entries) ? body.entries : []
    const level = body.level === 'brief' ? 'brief' : 'detailed'
    const meeting = meetingSvc.getMeeting(meetingId)
    if (!meeting) {
      return sendJson(res, 200, { ok: false, error: '会议不存在，无法生成总结', degraded: true })
    }
    // 命中缓存：直接返回，避免重复消耗 LLM
    if (summaryCache.has(meetingId)) {
      const cached = summaryCache.get(meetingId)
      return sendJson(res, 200, { ok: true, model: REFINE_MODEL, tookMs: 0, cached: true, result: cached })
    }
    if (!entries.length) {
      return sendJson(res, 200, { ok: false, error: '尚无转录内容，无法生成总结', degraded: true })
    }
    const meta = buildSummaryMeta(meeting)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 60000) // 后端超时 60s，先于前端 65s 安全网
    const started = Date.now()
    try {
      const result = await transcriptSvc.summarize(entries, meta, ac.signal)
      if (!result) {
        return sendJson(res, 200, { ok: false, error: '未能生成会议总结', degraded: true })
      }
      summaryCache.set(meetingId, result)
      const tookMs = Date.now() - started
      return sendJson(res, 200, { ok: true, model: REFINE_MODEL, tookMs, cached: false, result })
    } catch {
      const tookMs = Date.now() - started
      // 无论 LLM 成败均返回 200 + ok:false，绝不回显密钥/堆栈
      return sendJson(res, 200, { ok: false, error: '总结服务暂不可用，已保留原始转录', degraded: true })
    } finally {
      clearTimeout(timer)
    }
  }

  // —— 会议总结邮件发送 step1：两步确认 stage（校验邮箱→构邮件→CLI 取 ctk→返回 confirmationRef+preview）——
  // 恒 HTTP 200，以响应体 ok 判定成败（沿用 refine/mindmap 降级约定）。
  if (path === '/api/summary/send' && method === 'POST') {
    const body = await readJsonBody(req)
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : ''
    const email = typeof body.email === 'string' ? body.email : ''
    const meeting = meetingSvc.getMeeting(meetingId)
    if (!meeting) {
      return sendJson(res, 200, { ok: false, code: 'MEETING_NOT_FOUND', error: '会议不存在，无法发送邮件' })
    }
    const summary = summaryCache.get(meetingId)
    if (!summary) {
      return sendJson(res, 200, { ok: false, code: 'SUMMARY_EMPTY', error: '尚未生成总结，无法发送邮件' })
    }
    const transcriptText = buildTranscriptText(meeting)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30000) // 后端超时 30s，先于前端 35s 安全网
    const started = Date.now()
    try {
      const result = await summarySvc.stage(meetingId, email, summary, transcriptText, ac.signal)
      if (result.ok) {
        return sendJson(res, 200, {
          ok: true,
          confirmationRef: result.confirmationRef,
          preview: result.preview,
        })
      }
      return sendJson(res, 200, {
        ok: false,
        code: result.code,
        error: result.error,
        degraded: result.degraded,
      })
    } catch {
      const tookMs = Date.now() - started
      // 无论成败均返回 200 + ok:false，绝不回显密钥/堆栈
      return sendJson(res, 200, { ok: false, code: 'UNKNOWN', error: '邮件发送服务暂不可用', degraded: true })
    } finally {
      clearTimeout(timer)
    }
  }

  // —— 会议总结邮件发送 step2：两步确认 confirm（取 ctk 真发 + 配额计数）——
  // 恒 HTTP 200，以响应体 ok 判定成败。
  if (path === '/api/summary/send/confirm' && method === 'POST') {
    const body = await readJsonBody(req)
    const confirmationRef = typeof body.confirmationRef === 'string' ? body.confirmationRef : ''
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30000) // 后端超时 30s，先于前端 35s 安全网
    const started = Date.now()
    try {
      const result = await summarySvc.confirm(confirmationRef, ac.signal)
      if (result.ok) {
        return sendJson(res, 200, { ok: true, preview: result.preview })
      }
      return sendJson(res, 200, {
        ok: false,
        code: result.code,
        error: result.error,
        degraded: result.degraded,
      })
    } catch {
      const tookMs = Date.now() - started
      return sendJson(res, 200, { ok: false, code: 'UNKNOWN', error: '邮件确认发送失败', degraded: true })
    } finally {
      clearTimeout(timer)
    }
  }

  // 角色库（22 位）
  if (path === '/api/roles' && method === 'GET') {
    return sendJson(res, 200, { ok: true, roles: roleSvc.listRoles() })
  }

  // 会议集合
  if (path === '/api/meetings' && method === 'POST') {
    const body = await readJsonBody(req)
    const meeting = meetingSvc.createMeeting({ title: body.title, brief: body.brief, roleIds: body.roleIds })
    return sendJson(res, 200, { ok: true, meeting })
  }

  // /api/meetings/:id/...
  const mt = path.match(/^\/api\/meetings\/([^/]+)(?:\/(roles|materials|transcript|auto-speakers|speak|opinions|export))?\/?(?:([^/]+))?$/)
  if (mt && path.startsWith('/api/meetings/')) {
    const meetingId = mt[1]
    const sub = mt[2] // roles | materials | transcript | auto-speakers | speak | opinions | export
    const tail = mt[3] // roleId (for roles/:roleId) 或空
    const meeting = meetingSvc.getMeeting(meetingId)
    if (!meeting && !(method === 'POST' && sub === undefined)) {
      return sendJson(res, 404, { ok: false, message: '会议不存在' })
    }

    // 会议详情 / 更新
    if (!sub) {
      if (method === 'GET') return sendJson(res, 200, { ok: true, meeting })
      if (method === 'PATCH') {
        const body = await readJsonBody(req)
        const updated = meetingSvc.updateMeeting(meetingId, {
          title: body.title,
          brief: body.brief,
          commentaryEnabled: typeof body.commentaryEnabled === 'boolean' ? body.commentaryEnabled : undefined,
        })
        return sendJson(res, 200, { ok: true, meeting: updated })
      }
    }

    if (sub === 'commentaries' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        commentaries: meetingSvc.getCommentaries(meetingId),
        commentaryEnabled: meeting?.commentaryEnabled !== false,
      })
    }

    if (sub === 'roles' && method === 'POST') {
      const body = await readJsonBody(req)
      const role = roleSvc.addCustomRole(body)
      return sendJson(res, 200, { ok: true, role })
    }
    if (sub === 'roles' && method === 'DELETE' && tail) {
      const removed = roleSvc.removeRole(tail)
      return sendJson(res, 200, { ok: removed })
    }

    if (sub === 'materials' && method === 'POST') {
      const body = await readJsonBody(req)
      const ext = String(body.fileName || '').toLowerCase().split('.').pop() || 'txt'
      const parsed = extractMaterialTextFromFile({
        fileName: body.fileName || 'material.txt',
        mimeType: body.mimeType || '',
        fileData: body.base64 || '',
      })
      // 体积守卫：超大附件直接回明确错误，避免前端进入无反馈的长时间等待
      if (parsed.error) {
        return sendJson(res, 413, { ok: false, error: parsed.error })
      }
      const type = ['pdf', 'docx', 'md', 'txt'].includes(ext) ? ext : 'txt'
      const doc = meetingSvc.addMaterial(meetingId, {
        name: body.fileName || 'material',
        type,
        parsedText: parsed.extractedText,
        sizeBytes: parsed.byteLength,
      })
      return sendJson(res, 200, {
        ok: true,
        id: doc.id,
        name: doc.name,
        type: doc.type,
        parsedText: doc.parsedText,
        sizeBytes: doc.sizeBytes,
      })
    }
    if (sub === 'materials' && method === 'GET') {
      return sendJson(res, 200, { ok: true, materials: meetingSvc.listMaterials(meetingId) })
    }

    if (sub === 'transcript' && method === 'POST') {
      const body = await readJsonBody(req)
      const entry = meetingSvc.addTranscript(meetingId, {
        text: body.text,
        final: body.final !== false,
        id: typeof body.id === 'string' ? body.id : undefined,
      })
      // 会中点评·辅信号 + 固定间隔门控（零额外 LLM，纯启发式）
      if (entry) commentarySvc.onTranscript(meetingId, entry)
      return sendJson(res, 200, { ok: true, entry })
    }

    if (sub === 'auto-speakers' && method === 'POST') {
      const body = await readJsonBody(req)
      const roleIds = (meeting.roleIds || []).map((id) => roleSvc.getRole(id)).filter(Boolean)
      const picks = boardSvc.autoPickSpeakers({ roles: roleIds, transcriptText: body.transcriptText || '' })
      return sendJson(res, 200, { ok: true, roleIds: picks })
    }

    if (sub === 'speak' && method === 'POST') {
      const body = await readJsonBody(req)
      return handleSpeak(req, res, meetingId, body)
    }

    if (sub === 'opinions' && method === 'GET') {
      return sendJson(res, 200, { ok: true, opinions: meetingSvc.listOpinions(meetingId) })
    }

    if (sub === 'export' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
      return res.end(meetingSvc.exportMarkdown(meetingId))
    }
  }

  return sendJson(res, 404, { ok: false, message: 'not found' })
}

// —— 生产环境静态资源托管（SPA）——
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}
function serveStatic(req, res, url) {
  return new Promise((resolve) => {
    if (!existsSync(WEB_ROOT)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('前端未构建：请先执行 npm run build')
      return resolve()
    }
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    const filePath = join(WEB_ROOT, pathname)
    // 防目录穿越
    if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + sep)) {
      res.writeHead(403)
      res.end('forbidden')
      return resolve()
    }
    let target = filePath
    if (!existsSync(target) || statSync(target).isDirectory()) {
      target = join(WEB_ROOT, 'index.html') // SPA 历史回退
    }
    if (!existsSync(target)) {
      res.writeHead(404)
      res.end('not found')
      return resolve()
    }
    const ext = extname(target).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    })
    createReadStream(target).pipe(res)
    res.on('finish', resolve)
  })
}

// —— HTTP 服务 ——
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const p = url.pathname
  if (p.startsWith('/api') || p.startsWith('/ws')) {
    router(req, res, url).catch(() => {
      // 不回显内部错误细节 / 密钥
      sendJson(res, 500, { ok: false, message: '服务暂不可用' })
    })
  } else {
    serveStatic(req, res, url)
  }
})

// —— WebSocket：实时转录上行 ——
// 阿里云模式：浏览器上行二进制 PCM 音频帧 → 转发 DashScope 实时 ASR → 回传转写结果 + 落库；
// 兜底模式：浏览器端 Web Speech 直接推送识别文本，此处仅落库。
const wss = new WebSocketServer({ server, path: '/ws/board/transcribe' })
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost')
  const sessionId = url.searchParams.get('sessionId') || ''
  const useAliyun = asrRuntimeConfig().provider === 'aliyun' && Boolean(sessionId)

  // 注册到 ws-hub（供会中点评 commentary 消息精准下行推送）
  if (sessionId) wsHub.register(sessionId, ws)

  // 每路会话一个阿里云实时流（浏览器上行 PCM → DashScope → 回传）
  const stream = useAliyun
    ? createAliyunStream({
        sampleRate: 16000,
        format: 'pcm',
        onResult: (text, final) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'transcript', text, final }))
          }
          if (sessionId) {
            const entry = meetingSvc.addTranscript(sessionId, { text, final })
            // 会中点评·辅信号 + 固定间隔门控
            if (entry) commentarySvc.onTranscript(sessionId, entry)
          }
        },
      })
    : null

  ws.on('message', (raw, isBinary) => {
    // 阿里云模式：二进制帧即 PCM 音频，直接转发
    if (stream && isBinary) {
      stream.sendAudio(raw)
      return
    }
    let msg
    try {
      msg = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }
    if (msg.type === 'transcript' && sessionId) {
      const entry = meetingSvc.addTranscript(sessionId, {
        text: msg.text,
        final: msg.final !== false,
        id: typeof msg.id === 'string' ? msg.id : undefined,
      })
      // 会中点评·辅信号 + 固定间隔门控（零额外 LLM，纯启发式）
      if (entry) commentarySvc.onTranscript(sessionId, entry)
    } else if (msg.type === 'audio_done' && stream) {
      stream.finish()
    }
  })

  ws.on('close', () => {
    if (sessionId) wsHub.unregister(sessionId, ws)
    stream?.finish()
  })
  ws.on('error', () => {
    if (sessionId) wsHub.unregister(sessionId, ws)
    stream?.finish()
  })
})

server.listen(PORT, () => {
  console.log(`[ai-board] 后端已启动：http://localhost:${PORT}`)
  console.log(`[ai-board] 角色数=${roleSvc.listRoles().length}，ASR=${asrRuntimeConfig().provider}`)
})
