// src/lib/api.ts —— 前端接口层：REST 封装 + WebSocket URL 构造 + 发言 SSE 发起
import type {
  CommentaryListResponse,
  CommentaryRequest,
  CommentaryResponse,
  GenerateSummaryRequest,
  GenerateSummaryResponse,
  Meeting,
  MeetingDoc,
  MindmapResponse,
  Opinion,
  RefineEntryInput,
  RefineResponse,
  Role,
  SendConfirmRequest,
  SendRequest,
  SendResponse,
  UploadParseResult,
} from '../types'
import { UPLOAD_TIMEOUT_MS } from './limits'

const BASE = '' // 经 Vite dev proxy 转发到 Node 后端（/api, /ws）

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      detail = body.error || body.message || detail
    } catch {
      /* 响应体非 JSON 时保留状态码文案 */
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

export async function listRoles(): Promise<Role[]> {
  const r = await json<{ ok: boolean; roles: Role[] }>(await fetch(`${BASE}/api/roles`))
  return r.roles
}

export async function createMeeting(input: {
  title: string
  brief: string
  roleIds: string[]
}): Promise<Meeting> {
  const res = await fetch(`${BASE}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const r = await json<{ ok: boolean; meeting: Meeting }>(res)
  return r.meeting
}

export async function getMeeting(id: string): Promise<Meeting> {
  const r = await json<{ ok: boolean; meeting: Meeting }>(await fetch(`${BASE}/api/meetings/${id}`))
  return r.meeting
}

export async function updateMeeting(
  id: string,
  patch: { title?: string; brief?: string },
): Promise<Meeting> {
  const res = await fetch(`${BASE}/api/meetings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const r = await json<{ ok: boolean; meeting: Meeting }>(res)
  return r.meeting
}

export async function addRole(meetingId: string, role: Partial<Role>): Promise<Role> {
  const res = await fetch(`${BASE}/api/meetings/${meetingId}/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(role),
  })
  const r = await json<{ ok: boolean; role: Role }>(res)
  return r.role
}

export async function removeRole(meetingId: string, roleId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/meetings/${meetingId}/roles/${roleId}`, { method: 'DELETE' })
  const r = await json<{ ok: boolean }>(res)
  return r.ok
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadMaterial(
  meetingId: string,
  file: File,
  options: { timeoutMs?: number } = {},
): Promise<UploadParseResult> {
  const timeoutMs = options.timeoutMs ?? UPLOAD_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const base64 = await fileToBase64(file)
    const res = await fetch(`${BASE}/api/meetings/${meetingId}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64, sizeBytes: file.size }),
      signal: controller.signal,
    })
    return await json<UploadParseResult>(res)
  } catch (err) {
    // 超时（signal 已 abort）给出明确提示，避免页面无限期卡在等待中
    if (controller.signal.aborted) {
      throw new Error(
        `附件「${file.name}」解析超时（>${Math.round(timeoutMs / 1000)}s），请稍后重试或减小文件体积`,
      )
    }
    throw err instanceof Error ? err : new Error('附件上传失败')
  } finally {
    clearTimeout(timer)
  }
}

export async function listMaterials(meetingId: string): Promise<MeetingDoc[]> {
  const r = await json<{ ok: boolean; materials: MeetingDoc[] }>(
    await fetch(`${BASE}/api/meetings/${meetingId}/materials`),
  )
  return r.materials
}

export async function addTranscript(
  meetingId: string,
  text: string,
  final = true,
  clientId?: string,
): Promise<void> {
  await fetch(`${BASE}/api/meetings/${meetingId}/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, final, id: clientId }),
  }).catch(() => {})
}

export async function autoSpeakers(meetingId: string, transcriptText: string): Promise<string[]> {
  const res = await fetch(`${BASE}/api/meetings/${meetingId}/auto-speakers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcriptText }),
  })
  const r = await json<{ ok: boolean; roleIds: string[] }>(res)
  return r.roleIds
}

// 发起发言：返回 fetch Response，调用方用 sse.ts 解析流式事件
export function speakRequest(meetingId: string, roleId: string, trigger: 'manual' | 'auto' = 'manual'): Promise<Response> {
  return fetch(`${BASE}/api/meetings/${meetingId}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ roleId, trigger }),
  })
}

export async function listOpinions(meetingId: string): Promise<Opinion[]> {
  const r = await json<{ ok: boolean; opinions: Opinion[] }>(
    await fetch(`${BASE}/api/meetings/${meetingId}/opinions`),
  )
  return r.opinions
}

export async function exportMarkdown(meetingId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/meetings/${meetingId}/export`)
  return res.text()
}

export function transcribeWsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws/board/transcribe?sessionId=${encodeURIComponent(sessionId)}`
}

// 读取后端 ASR 配置，决定默认转写模式。
// 只有后端「provider=aliyun 且 AppKey 已配置」时才走阿里云实时语音；
// 其余情况（未启用 / 缺少 AppKey / 接口异常）一律回退到浏览器 Web Speech，
// 保证在没填阿里云 Key 时用户仍能看到实时转写文字。
export async function fetchAsrProvider(): Promise<'aliyun' | 'web-speech'> {
  try {
    const r = await fetch(`${BASE}/api/health`)
    const j = (await r.json()) as {
      asr?: { provider?: string; appKeyConfigured?: boolean }
    }
    const aliyunReady = j?.asr?.provider === 'aliyun' && j?.asr?.appKeyConfigured === true
    return aliyunReady ? 'aliyun' : 'web-speech'
  } catch {
    return 'web-speech'
  }
}

// ===== 转录增强：整理 / 思维导图 =====
// 这两个接口后端恒返回 200，由响应体 ok 字段判定成败；故此处不在 !res.ok 抛错，
// 直接解析 body。失败时（HTTP 异常 / 超时 / 网络错误）本地构造降级响应，
// 保证调用方只判 ok 字段即可、绝不白屏。

const REFINE_TIMEOUT_MS = 30_000 // 前端安全网，略大于后端 25s，使后端先优雅降级
const MINDMAP_TIMEOUT_MS = 45_000 // 略大于后端 40s

/**
 * 组合一个带超时、并可被外部 signal 联动中止的 AbortController。
 * 外部 signal abort 时会同步取消本控制器；返回 clear() 释放监听与定时器。
 */
function makeAbortController(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
      if (external) external.removeEventListener('abort', onExternalAbort)
    },
  }
}

export async function refineTranscript(entries: RefineEntryInput[], signal?: AbortSignal): Promise<RefineResponse> {
  const ac = makeAbortController(REFINE_TIMEOUT_MS, signal)
  try {
    const res = await fetch(`${BASE}/api/transcript/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      signal: ac.signal,
    })
    return (await res.json()) as RefineResponse
  } catch {
    // 前端安全网：超时 / 网络错误一律降级为「保留原稿」
    const fallback = entries.map((e) => e.text).join('\n')
    return { ok: false, refinedText: fallback, structured: null, keywords: [], error: '整理请求超时，已保留原始转录', degraded: true }
  } finally {
    ac.clear()
  }
}

export async function mindmapTranscript(
  rawText: string,
  meetingTitle?: string,
  meetingId?: string,
  entryIds?: string[],
  signal?: AbortSignal,
): Promise<MindmapResponse> {
  const ac = makeAbortController(MINDMAP_TIMEOUT_MS, signal)
  try {
    const res = await fetch(`${BASE}/api/transcript/mindmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText,
        meetingTitle: meetingTitle ?? '',
        meetingId: meetingId ?? '',
        entryIds: Array.isArray(entryIds) ? entryIds : [],
      }),
      signal: ac.signal,
    })
    return (await res.json()) as MindmapResponse
  } catch {
    return { ok: false, root: null, error: '思维导图请求超时', degraded: true }
  } finally {
    ac.clear()
  }
}

// ===== 会议总结 + 邮件发送（增量 T1-T5）=====
// 与 refine/mindmap 同策略：后端恒返回 200，以响应体 ok 字段判定成败；
// 失败（HTTP 异常 / 超时 / 网络错误）本地构造降级响应，绝不白屏。

/** 前端安全网：略大于后端 60s，使后端先优雅降级。 */
const SUMMARY_TIMEOUT_MS = 65_000

/** 前端安全网：略大于后端发信 30s，使后端先优雅降级。 */
const SEND_TIMEOUT_MS = 35_000

// 按 meetingId 的内存缓存，避免重复消耗 LLM（与后端缓存互补，设计 §7.4）。
const summaryCache = new Map<string, GenerateSummaryResponse>()

/**
 * 生成六要素会议总结。
 * 命中前端缓存时直接返回（cached:true, tookMs:0），跳过网络请求。
 */
export async function generateSummary(req: GenerateSummaryRequest): Promise<GenerateSummaryResponse> {
  const cached = summaryCache.get(req.meetingId)
  if (cached && cached.ok && cached.result) {
    return { ...cached, cached: true, tookMs: 0 }
  }
  const ac = makeAbortController(SUMMARY_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/summary/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: req.meetingId,
        entries: req.entries,
        level: req.level ?? 'detailed',
      }),
      signal: ac.signal,
    })
    const data = (await res.json()) as GenerateSummaryResponse
    if (data.ok && data.result) summaryCache.set(req.meetingId, data)
    return data
  } catch {
    return { ok: false, error: '总结生成请求超时，请稍后重试', degraded: true }
  } finally {
    ac.clear()
  }
}

/** 清除总结缓存（单会议 / 全部）。调试或重新进入会议时调用。 */
export function clearSummaryCache(meetingId?: string): void {
  if (meetingId) summaryCache.delete(meetingId)
  else summaryCache.clear()
}

/**
 * 发送会议总结邮件（两步确认 step1）。
 * 真实请求后端 /api/summary/send：校验邮箱→构邮件→CLI 取 ctk→返回 confirmationRef + preview。
 * 后端恒返回 200，以响应体 ok 判定成败；失败时（HTTP 异常 / 超时 / 网络错误）
 * 本地构造降级响应，绝不白屏。前端仅持有 confirmationRef，绝不直接接触 ctk。
 */
export async function sendSummary(req: SendRequest): Promise<SendResponse> {
  const ac = makeAbortController(SEND_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/summary/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: req.meetingId,
        email: req.email,
        level: req.level ?? 'detailed',
      }),
      signal: ac.signal,
    })
    return (await res.json()) as SendResponse
  } catch {
    // 前端安全网：超时 / 网络错误一律降级（NETWORK_ERROR），不白屏
    return { ok: false, code: 'NETWORK_ERROR', error: '邮件发送请求超时，请稍后重试', degraded: true }
  } finally {
    ac.clear()
  }
}

/** 确认发送（两步确认 step2）。真实请求后端 /api/summary/send/confirm：带 confirmationRef 取 ctk 真发。 */
export async function confirmSendSummary(req: SendConfirmRequest): Promise<SendResponse> {
  const ac = makeAbortController(SEND_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/summary/send/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationRef: req.confirmationRef }),
      signal: ac.signal,
    })
    return (await res.json()) as SendResponse
  } catch {
    return { ok: false, code: 'NETWORK_ERROR', error: '邮件确认发送请求超时，请稍后重试', degraded: true }
  } finally {
    ac.clear()
  }
}

// ===== 会中实时反馈 / 点评（增量 T1-T5）=====
// 与 refine/mindmap/summary 同策略：后端恒返回 200，以响应体 ok 字段判定成败；
// 失败（HTTP 异常 / 超时 / 网络错误）本地构造降级响应，绝不白屏、保留历史。
/** 前端安全网：略大于后端 25s，使后端先优雅降级。 */
const LIVE_COMMENTARY_TIMEOUT_MS = 28_000

/**
 * 生成一条 LLM 轻量点评（前端定时 / 话题补驱动）。
 * 命中 200 + commentary:null（本窗口无可点评）→ 返回该值，由调用方静默跳过（非降级）。
 * 失败 / 超时 → 返回 {ok:false, commentary:null, degraded:true}，调用方保留历史不白屏。
 */
export async function liveCommentary(req: CommentaryRequest): Promise<CommentaryResponse> {
  const ac = makeAbortController(LIVE_COMMENTARY_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/transcript/commentary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText: req.rawText, ctx: req.ctx }),
      signal: ac.signal,
    })
    return (await res.json()) as CommentaryResponse
  } catch {
    return { ok: false, commentary: null, error: '点评请求超时，已保留历史', degraded: true }
  } finally {
    ac.clear()
  }
}

/** 拉取会议全部点评与开关状态（刷新 / 重连恢复）。 */
export async function getCommentaries(id: string): Promise<CommentaryListResponse> {
  try {
    const r = await json<CommentaryListResponse>(
      await fetch(`${BASE}/api/meetings/${id}/commentaries`),
    )
    return r
  } catch {
    return { ok: false, commentaries: [], commentaryEnabled: true }
  }
}

/** 设置实时点评开关（PATCH meeting.commentaryEnabled）。 */
export async function setCommentaryEnabled(id: string, enabled: boolean): Promise<Meeting> {
  const res = await fetch(`${BASE}/api/meetings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentaryEnabled: enabled }),
  })
  const r = await json<{ ok: boolean; meeting: Meeting }>(res)
  return r.meeting
}
