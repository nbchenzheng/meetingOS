// server/asr-service.mjs
// 语音识别：保留阿里云实时 ASR（待用户提供 Key 后启用），当前前端走 Web Speech 兜底。
// 架构 T12 预留接口：ALIYUN_ASR_* 配置读取 + 阿里云实时转写分支均已就位。
import WebSocket from 'ws'
import { Agent as HttpsAgent } from 'node:https'
import { Agent as HttpAgent } from 'node:http'

function proxyAgent(url) {
  if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY && !process.env.https_proxy && !process.env.http_proxy) return undefined
  return new (url.startsWith('wss:') ? HttpsAgent : HttpAgent)({ proxyEnv: process.env })
}
// Node 18 没有全局 crypto，必须显式 import（本地 Node 22 有全局 crypto，所以本地永远不复现线上崩溃）
import { randomUUID } from 'node:crypto'

const ALIYUN_WS_URL = process.env.ALIYUN_ASR_WS_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

export function asrRuntimeConfig() {
  const apiKey = process.env.ALIYUN_ASR_API_KEY || ''
  const appKey = process.env.ALIYUN_ASR_APP_KEY || ''
  const region = process.env.ALIYUN_ASR_REGION || 'cn-shanghai'
  const enabled = String(process.env.ALIYUN_ASR_ENABLED || 'false').toLowerCase() === 'true'
  return {
    provider: enabled && apiKey ? 'aliyun' : 'web-speech',
    enabled,
    apiKeyConfigured: Boolean(apiKey),
    appKeyConfigured: Boolean(appKey),
    region,
    wsUrl: process.env.ALIYUN_ASR_WS_URL || ALIYUN_WS_URL,
  }
}

function decodeAudioData(audioData) {
  const value = String(audioData || '')
  const match = value.match(/^data:([^;]+);base64,(.+)$/)
  const mimeType = match?.[1] || 'audio/webm'
  const base64 = match?.[2] || value
  return { buffer: Buffer.from(base64, 'base64'), mimeType }
}

function audioFormatFromMime(mimeType = '') {
  const value = String(mimeType).toLowerCase()
  if (value.includes('wav')) return 'wav'
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3'
  if (value.includes('aac')) return 'aac'
  if (value.includes('amr')) return 'amr'
  if (value.includes('opus') || value.includes('webm')) return 'opus'
  return 'opus'
}

function waitForSocket(socket, eventName, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${eventName}_timeout`)), timeoutMs)
    socket.once(eventName, (...args) => {
      clearTimeout(timer)
      resolve(args)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

// 阿里云实时语音转写（DashScope WebSocket）。仅当 ALIYUN_ASR_ENABLED=true 且配置了 Key 时调用。
async function transcribeWithAliyun(payload, config, startedAt) {
  const apiKey = process.env.ALIYUN_ASR_API_KEY
  if (!apiKey) {
    return { status: 501, payload: { ok: false, error: 'asr_api_key_missing', message: '阿里云 ASR 缺少 API Key。' } }
  }
  const { buffer, mimeType } = decodeAudioData(payload.audioData)
  if (buffer.length === 0) return { status: 422, payload: { ok: false, error: 'audio_data_required' } }
  const id = randomUUID().replaceAll('-', '')
  const format = payload.format || audioFormatFromMime(payload.mimeType || mimeType)
  const sampleRate = Number(payload.sampleRate ?? 16000)
  const socket = new WebSocket(config.wsUrl, {
    agent: proxyAgent(config.wsUrl),
    headers: { Authorization: `Bearer ${apiKey}`, 'X-DashScope-DataInspection': 'enable' },
  })
  const sentences = []
  try {
    await waitForSocket(socket, 'open', 15000)
    socket.on('message', (data) => {
      let event
      try {
        event = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      const eventName = event.header?.event
      if (eventName === 'result-generated') {
        const sentence = event.payload?.output?.sentence
        const text = sentence?.text || event.payload?.output?.text || ''
        if (text) sentences.push({ text, final: Boolean(sentence?.sentence_end) })
      }
    })
    socket.send(
      JSON.stringify({
        header: { action: 'run-task', task_id: id, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: process.env.ALIYUN_ASR_MODEL || 'fun-asr-realtime',
          parameters: {
            format,
            sample_rate: sampleRate,
            language_hints: ['zh', 'en'],
            punctuation_prediction_enabled: true,
            inverse_text_normalization_enabled: true,
          },
          input: {},
        },
      }),
    )
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('aliyun_task_started_timeout')), 15000)
      const onMessage = (data) => {
        let event
        try {
          event = JSON.parse(data.toString('utf8'))
        } catch {
          return
        }
        if (event.header?.event === 'task-started') {
          clearTimeout(timer)
          socket.off('message', onMessage)
          resolve()
        }
      }
      socket.on('message', onMessage)
    })
    for (let offset = 0; offset < buffer.length; offset += 16384) {
      socket.send(buffer.subarray(offset, Math.min(buffer.length, offset + 16384)))
      await new Promise((r) => setTimeout(r, 8))
    }
    socket.send(JSON.stringify({ header: { action: 'finish-task', task_id: id, streaming: 'duplex' }, payload: { input: {} } }))
    const failed = sentences.find((item) => item.failed)
    if (failed) throw new Error(failed.failed)
    const finalTexts = sentences.filter((item) => item.final && item.text).map((item) => item.text)
    const text = (finalTexts.length > 0 ? finalTexts : sentences.map((item) => item.text)).join('').trim()
    return { status: 200, payload: { ok: true, data: { text, provider: 'aliyun', latencyMs: Date.now() - startedAt } } }
  } catch (error) {
    return { status: 502, payload: { ok: false, error: 'asr_provider_failed', message: error instanceof Error ? error.message : 'aliyun_asr_failed' } }
  } finally {
    socket.close()
  }
}

// 阿里云实时语音「流式」桥：浏览器持续上行 PCM 音频帧，后端转发 DashScope 并回传转写结果。
// 每路 /ws/board/transcribe 会话创建一个，返回 { sendAudio, ready, finish, close }。
export function createAliyunStream({ onResult,onError=()=>{}, sampleRate = 16000, format = 'pcm' } = {}) {
  const apiKey = process.env.ALIYUN_ASR_API_KEY
  // 保留原有「取不到唯一 ID 时降级」的语义；不再引用未声明的全局 crypto（Node 18 会 ReferenceError 崩进程）
  const taskId = (typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now()}-${Math.random()}`
  ).replaceAll('-', '')
  const wsUrl = process.env.ALIYUN_ASR_WS_URL || ALIYUN_WS_URL
  const socket = new WebSocket(wsUrl, {
    agent: proxyAgent(wsUrl),
    headers: { Authorization: `Bearer ${apiKey}`, 'X-DashScope-DataInspection': 'enable' },
  })
  let started = false
  let settled = false
  const startPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('aliyun_task_started_timeout')) }
    }, 15000)
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: process.env.ALIYUN_ASR_MODEL || 'fun-asr-realtime',
            parameters: {
              format,
              sample_rate: sampleRate,
              language_hints: ['zh', 'en'],
              enable_punctuation_prediction: true,
              enable_inverse_text_normalization: true,
              enable_intermediate_result: true,
            },
            input: {},
          },
        }),
      )
      socket.on('message', (data) => {
        let event
        try { event = JSON.parse(data.toString('utf8')) } catch { return }
        const ev = event.header?.event
        if (ev === 'task-started') {
          if (!settled) { settled = true; clearTimeout(timer); started = true; resolve() }
        } else if (ev === 'task-failed') {
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error(event.payload?.message || 'aliyun_task_failed')) }
          else onError()
        } else if (ev === 'result-generated') {
          const sentence = event.payload?.output?.sentence
          const text = sentence?.text || event.payload?.output?.text || ''
          if (text) onResult?.(text, Boolean(sentence?.sentence_end))
        }
      })
    })
    socket.once('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err instanceof Error ? err : new Error('aliyun_ws_error')) }
    })
  })
  socket.on('error',()=>{if(started)onError()})

  return {
    async ready() { await startPromise },
    sendAudio(chunk) {
      if (!started || socket.readyState !== WebSocket.OPEN) return
      const buf = chunk instanceof ArrayBuffer ? Buffer.from(chunk) : chunk
      if (Buffer.isBuffer(buf) && buf.length) socket.send(buf)
    },
    finish() {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } }))
        }
      } catch { /* ignore */ }
      setTimeout(() => { try { socket.close() } catch {} }, 600)
    },
    close() { try { socket.close() } catch {} },
  }
}

// 主入口：当前默认走 Web Speech（前端本地转写）；配置阿里云后切换。
export async function transcribeAudio(payload = {}) {
  const config = asrRuntimeConfig()
  if (config.provider === 'aliyun') return transcribeWithAliyun(payload, config, Date.now())
  return {
    status: 200,
    payload: { ok: true, data: { text: '', provider: 'web-speech', message: '当前使用浏览器端 Web Speech 实时转写，无需服务端 ASR。' } },
  }
}
