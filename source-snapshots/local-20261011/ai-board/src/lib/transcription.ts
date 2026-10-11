// src/lib/transcription.ts —— 浏览器端实时转写
// 两种模式：
//  - 'webspeech'（默认）：浏览器 Web Speech API 本地转写，无需 Key（Chrome/Edge）。
//  - 'aliyun'：采集麦克风 16k PCM，经 /ws/board/transcribe 二进制上行到后端，
//    由阿里云实时 ASR 转写，结果由后端回传。需后端 ALIYUN_ASR_ENABLED=true。

export type AsrMode = 'webspeech' | 'aliyun'

export interface TranscriptionEvents {
  onTranscript: (text: string, final: boolean) => void
  onInterim?: (text: string) => void
  onVolume?: (level: number) => void
  onStatus?: (listening: boolean) => void
  onError?: (message: string) => void
}

type SpeechRecognitionLike = any

// Float32 [-1,1] → 16bit PCM @16000（线性插值降采样）
function toPcm16(float32: Float32Array, fromRate: number): Int16Array<ArrayBuffer> {
  const targetRate = 16000
  const ratio = fromRate / targetRate
  const n = Math.max(1, Math.round(float32.length / ratio))
  const out = new Int16Array(new ArrayBuffer(n * 2))
  for (let i = 0; i < n; i += 1) {
    const idx = i * ratio
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, float32.length - 1)
    const frac = idx - i0
    let s = float32[i0] * (1 - frac) + float32[i1] * frac
    s = s < -1 ? -1 : s > 1 ? 1 : s
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export class TranscriptionController {
  private events: TranscriptionEvents
  private recognition: SpeechRecognitionLike | null = null
  private stream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private processor: ScriptProcessorNode | null = null
  private ws: WebSocket | null = null
  private rafId = 0
  private running = false

  constructor(events: TranscriptionEvents) {
    this.events = events
  }

  get supported(): boolean {
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  }

  async start(mode: AsrMode = 'webspeech', opts: { wsUrl?: string } = {}): Promise<void> {
    if (this.running) return
    this.running = true
    this.events.onStatus?.(true)

    // —— 麦克风采集 + 音量监测（两种模式共用）——
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      this.audioCtx = new Ctx()
      const source = this.audioCtx.createMediaStreamSource(this.stream)
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 1024
      source.connect(this.analyser)
      this.loopVolume()
      if (mode === 'aliyun') {
        this.startAliyunCapture(source, opts.wsUrl || '')
        return
      }
    } catch {
      this.events.onError?.('无法访问麦克风（需 HTTPS 或 localhost 安全上下文，并授予权限）')
      this.running = false
      this.events.onStatus?.(false)
      return
    }

    // —— Web Speech 实时转写 ——
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      this.events.onError?.('当前浏览器不支持 Web Speech API，请使用 Chrome / Edge，或不依赖实时转写直接点大咖发言。')
      return
    }
    const recognition: SpeechRecognitionLike = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'zh-CN'
    recognition.maxAlternatives = 1
    recognition.onresult = (e: any) => {
      let interim = ''
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i]
        if (res.isFinal) finalText += res[0].transcript
        else interim += res[0].transcript
      }
      if (interim) this.events.onInterim?.(interim)
      if (finalText) this.events.onTranscript?.(finalText.trim(), true)
    }
    recognition.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        this.events.onError?.('麦克风权限被拒绝或 Web Speech 服务不可用')
      }
    }
    recognition.onend = () => {
      if (this.running) {
        try {
          recognition.start()
        } catch {
          /* ignore */
        }
      }
    }
    this.recognition = recognition
    try {
      recognition.start()
    } catch {
      /* ignore */
    }
  }

  // 阿里云模式：采集 16k PCM，二进制上行到后端 WS，回传结果经 onTranscript 输出
  private startAliyunCapture(source: MediaStreamAudioSourceNode, wsUrl: string): void {
    if (!wsUrl) {
      this.events.onError?.('阿里云转写地址缺失，请确认后端已启用阿里云 ASR。')
      return
    }
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'transcript' && msg.text) this.events.onTranscript?.(String(msg.text).trim(), msg.final !== false)
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => this.events.onError?.('阿里云实时转写连接异常，请检查网络或后端配置。')

    const ctx = this.audioCtx as AudioContext
    const fromRate = ctx.sampleRate
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const gain = ctx.createGain()
    gain.gain.value = 0 // 静音输出，仅维持处理图运行，避免回声
    source.connect(processor)
    processor.connect(gain)
    gain.connect(ctx.destination)
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const input = e.inputBuffer.getChannelData(0)
      const pcm = toPcm16(input, fromRate)
      if (pcm.length) ws.send(pcm)
    }
    this.processor = processor
  }

  private loopVolume = () => {
    if (!this.analyser || !this.running) return
    const buf = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i += 1) {
      const v = (buf[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / buf.length)
    this.events.onVolume?.(Math.min(1, rms * 2.4))
    this.rafId = requestAnimationFrame(this.loopVolume)
  }

  stop(): void {
    this.running = false
    try {
      this.recognition?.stop()
    } catch {
      /* ignore */
    }
    this.recognition = null
    try {
      this.processor?.disconnect()
    } catch {
      /* ignore */
    }
    this.processor = null
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
    this.analyser = null
    this.events.onVolume?.(0)
    this.events.onStatus?.(false)
  }
}
