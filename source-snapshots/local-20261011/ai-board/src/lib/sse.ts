// src/lib/sse.ts —— 解析后端 /speak 返回的 text/event-stream 流式意见分片
export interface SpeakEventHandlers {
  onStart?: (data: { roleId: string; color: string; cn: string }) => void
  onToken?: (data: { delta: string }) => void
  onEnd?: (data: { opinionId?: string; text?: string }) => void
  onError?: (data: { message?: string }) => void
}

export async function parseSpeakStream(response: Response, handlers: SpeakEventHandlers): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf8')
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const flush = () => {
    if (!eventName && dataLines.length === 0) return
    const raw = dataLines.join('\n')
    let payload: any = {}
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      payload = { message: raw }
    }
    if (eventName === 'start') handlers.onStart?.(payload)
    else if (eventName === 'token') handlers.onToken?.(payload)
    else if (eventName === 'end') handlers.onEnd?.(payload)
    else if (eventName === 'error') handlers.onError?.(payload)
    eventName = ''
    dataLines = []
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const text = line.replace(/\r$/, '')
      if (text === '') {
        flush()
        continue
      }
      if (text.startsWith('event:')) {
        eventName = text.slice(6).trim()
      } else if (text.startsWith('data:')) {
        dataLines.push(text.slice(5).trim())
      }
    }
  }
  flush()
}
