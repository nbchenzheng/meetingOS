// src/components/MicControls.tsx —— 麦克风状态 + 音量条 + 开始/停止 + 自动发言开关 + 转写模式
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { AsrMode } from '../lib/transcription'

interface Props {
  listening: boolean
  volumeRef: MutableRefObject<number>
  onToggle: () => void
  auto: boolean
  setAuto: (v: boolean) => void
  asrMode: AsrMode
  setAsrMode: (v: AsrMode) => void
  error: string | null
}

const BARS = 14

export default function MicControls({ listening, volumeRef, onToggle, auto, setAuto, asrMode, setAsrMode, error }: Props) {
  const barsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = volumeRef.current
      const bars = barsRef.current?.children
      if (bars) {
        for (let i = 0; i < bars.length; i += 1) {
          const phase = Math.sin(Date.now() / 120 + i * 0.7)
          const h = listening ? Math.max(12, (v * (0.55 + 0.45 * (phase * 0.5 + 0.5))) * 100) : 12
          ;(bars[i] as HTMLElement).style.height = `${h}%`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [listening, volumeRef])

  return (
    <div className="mic-wrap">
      <span className="mic-dot" />
      <span className="mic-label">{listening ? '正在收音…' : '麦克风已关闭'}</span>
      <div className="volume" ref={barsRef}>
        {Array.from({ length: BARS }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      <button className={`btn primary${listening ? ' on' : ''}`} type="button" onClick={onToggle}>
        {listening ? '⏹ 停止收音' : '🎙️ 开始收音'}
      </button>
      <div className="asr-mode">
        <button
          type="button"
          className={`seg${asrMode === 'webspeech' ? ' on' : ''}`}
          onClick={() => setAsrMode('webspeech')}
          disabled={listening}
        >
          浏览器语音
        </button>
        <button
          type="button"
          className={`seg${asrMode === 'aliyun' ? ' on' : ''}`}
          onClick={() => setAsrMode('aliyun')}
          disabled={listening}
        >
          阿里云实时
        </button>
      </div>
      <label className={`toggle${auto ? ' on' : ''}`} onClick={() => setAuto(!auto)}>
        <span className="track">
          <span className="knob" />
        </span>
        自动发言
      </label>
      {error && <span className="hint" style={{ color: '#f87171' }}>{error}</span>}
    </div>
  )
}

