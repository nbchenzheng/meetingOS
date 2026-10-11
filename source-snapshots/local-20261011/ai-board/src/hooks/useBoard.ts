// src/hooks/useBoard.ts —— 大咖列表 / 发言状态机 / 转录累积 / 自动发言 / 会中点评
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Commentary, Meeting, Role, TranscriptEntry } from '../types'
import {
  addTranscript,
  autoSpeakers,
  speakRequest,
  transcribeWsUrl,
  fetchAsrProvider,
  getCommentaries,
  setCommentaryEnabled as apiSetCommentaryEnabled,
} from '../lib/api'
import { parseSpeakStream } from '../lib/sse'
import { TranscriptionController, type AsrMode } from '../lib/transcription'

let _uid = 0
const uid = () => `e${Date.now().toString(36)}_${_uid++}`

export function useBoard(meeting: Meeting, allRoles: Role[]) {
  const roles = allRoles.filter((r) => meeting.roleIds.includes(r.id))
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const volumeRef = useRef(0)
  const [auto, setAuto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asrMode, setAsrMode] = useState<AsrMode>('webspeech')
  // 会中实时点评（llm 源在 useLiveCommentary；此处仅承载后端 big-shot 主动点评 WS 推送 + 初始化拉取）
  const [commentaries, setCommentaries] = useState<Commentary[]>([])
  const [commentaryEnabled, setCommentaryEnabledState] = useState(true)

  const ctrlRef = useRef<TranscriptionController | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const entriesRef = useRef(entries)
  const speakingRef = useRef(speaking)
  const lastSpokenRef = useRef<Record<string, number>>({})
  const lastAutoCallRef = useRef(0)
  const autoRef = useRef(auto)
  const rolesRef = useRef(roles)

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])
  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])
  useEffect(() => {
    autoRef.current = auto
  }, [auto])
  useEffect(() => {
    rolesRef.current = roles
  }, [roles])

  // 依据后端 ASR 配置设定默认转写模式（阿里云已启用则默认走阿里云实时语音）
  useEffect(() => {
    let alive = true
    fetchAsrProvider()
      .then((p) => {
        if (alive && p === 'aliyun') setAsrMode('aliyun')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 初始化：拉取已有点评与开关状态（刷新 / 重连恢复，架构 §5.3）
  useEffect(() => {
    let alive = true
    getCommentaries(meeting.id)
      .then((r) => {
        if (!alive) return
        if (Array.isArray(r.commentaries)) setCommentaries(r.commentaries)
        if (typeof r.commentaryEnabled === 'boolean') setCommentaryEnabledState(r.commentaryEnabled)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [meeting.id])

  // 设置实时点评开关（PATCH 后端 + 本地状态；关闭=静音面板，不影响手动发言 / 自动发言）
  const setCommentaryEnabled = useCallback(
    async (enabled: boolean) => {
      setCommentaryEnabledState(enabled)
      try {
        await apiSetCommentaryEnabled(meeting.id, enabled)
      } catch {
        /* 后端失败保留本地意图，不阻断 UI */
      }
    },
    [meeting.id],
  )

  // WebSocket：把浏览器端识别结果推送到后端持久化（架构 §7.3）
  // 同时接收后端 commentary 消息（大咖主动点评推送，复用同一通道）
  useEffect(() => {
    const ws = new WebSocket(transcribeWsUrl(meeting.id))
    wsRef.current = ws
    ws.onmessage = (ev) => {
      let msg: unknown
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      // 仅处理 commentary 类型（其余 transcript 等消息本就被忽略，保持兼容）
      const m = msg as { type?: string; commentary?: Commentary }
      if (m && m.type === 'commentary' && m.commentary) {
        setCommentaries((prev) =>
          prev.some((c) => c.id === m.commentary!.id) ? prev : [...prev, m.commentary!],
        )
      }
    }
    return () => {
      ws.onmessage = null
      ws.close()
    }
  }, [meeting.id])

  const sendTranscript = useCallback(
    (text: string, final: boolean, id?: string) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'transcript', text, final, id }))
      } else {
        addTranscript(meeting.id, text, final, id).catch(() => {})
      }
    },
    [meeting.id],
  )

  const requestSpeak = useCallback(
    async (roleId: string, trigger: 'manual' | 'auto' = 'manual') => {
      if (speakingRef.current[roleId]) return
      const role = rolesRef.current.find((r) => r.id === roleId)
      setSpeaking((s) => ({ ...s, [roleId]: true }))
      const entryId = uid()
      setEntries((es) => [
        ...es,
        {
          id: entryId,
          type: 'opinion',
          roleId,
          speaker: role?.cn ?? roleId,
          color: role?.color,
          text: '',
          ts: new Date().toISOString(),
          final: false,
        },
      ])
      const scheduleStop = () => setTimeout(() => setSpeaking((s) => ({ ...s, [roleId]: false })), 3000)
      try {
        const res = await speakRequest(meeting.id, roleId, trigger)
        await parseSpeakStream(res, {
          onToken: ({ delta }) =>
            setEntries((es) => es.map((e) => (e.id === entryId ? { ...e, text: e.text + delta } : e))),
          onEnd: () => {
            setEntries((es) => es.map((e) => (e.id === entryId ? { ...e, final: true } : e)))
            scheduleStop()
          },
          onError: () => scheduleStop(),
        })
      } catch {
        scheduleStop()
      }
    },
    [meeting.id],
  )

  const maybeAuto = useCallback(() => {
    if (!autoRef.current) return
    const now = Date.now()
    if (now - lastAutoCallRef.current < 1500) return
    lastAutoCallRef.current = now
    const text = entriesRef.current
      .filter((e) => e.type === 'speech')
      .map((e) => e.text)
      .join('\n')
    autoSpeakers(meeting.id, text)
      .then((ids) => {
        for (const id of ids) {
          const last = lastSpokenRef.current[id] || 0
          if (now - last > 60000 && !speakingRef.current[id]) {
            lastSpokenRef.current[id] = now
            requestSpeak(id, 'auto')
          }
        }
      })
      .catch(() => {})
  }, [meeting.id, requestSpeak])

  const addHuman = useCallback(
    (text: string, isFinal: boolean, fromServer = false) => {
      if (!text) return
      const entry: TranscriptEntry = {
        id: uid(),
        text,
        type: 'speech',
        ts: new Date().toISOString(),
        final: isFinal,
      }
      setEntries((es) => [...es, entry])
      // 阿里云模式：转写结果已由后端落库，浏览器侧仅展示，不再回传，避免重复
      if (!fromServer) sendTranscript(text, isFinal, entry.id)
      if (isFinal) maybeAuto()
    },
    [sendTranscript, maybeAuto],
  )

  const toggleListen = useCallback(() => {
    if (ctrlRef.current) {
      ctrlRef.current.stop()
      ctrlRef.current = null
      setListening(false)
      setInterim('')
      return
    }
    const ctrl = new TranscriptionController({
      onTranscript: (text, final) => addHuman(text, final, asrMode === 'aliyun'),
      onInterim: (t) => setInterim(t),
      onVolume: (v) => {
        volumeRef.current = v
      },
      onStatus: (l) => {
        setListening(l)
        if (!l) setInterim('')
      },
      onError: (m) => setError(m),
    })
    ctrlRef.current = ctrl
    ctrl.start(asrMode, { wsUrl: transcribeWsUrl(meeting.id) })
  }, [addHuman, asrMode, meeting.id])

  useEffect(() => () => ctrlRef.current?.stop(), [])

  return {
    roles,
    entries,
    speaking,
    interim,
    listening,
    volumeRef,
    auto,
    setAuto,
    asrMode,
    setAsrMode,
    toggleListen,
    requestSpeak,
    error,
    commentaries,
    commentaryEnabled,
    setCommentaryEnabled,
  }
}
