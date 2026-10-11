// src/hooks/useLiveCommentary.ts —— 会中 LLM 轻量点评采集状态机（前端驱动）
// 设计要点（架构 §二/§八）：
//  - 定时（默认 150s）调 POST /api/transcript/commentary；话题切换事件触发时立即补一次（≥60s 冷却）；
//  - 最小间隔门控 60s 防刷屏；随 listening / commentaryEnabled 暂停；失败降级保留上次、不白屏、不重试；
//  - llm 源点评为前端本地状态（不落库），与后端 big-shot 主动点评在面板层合并展示。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Commentary, TranscriptEntry } from '../types'
import { liveCommentary } from '../lib/api'

/** 定时采集周期（架构 §8.4）。 */
export const COMMENTARY_TIMER_MS = 150_000
/** 最小间隔门控（防刷屏 / 与话题补采冷却一致）。 */
export const COMMENTARY_MIN_GAP_MS = 60_000
/** 话题切换补采冷却（与后端 onTopicSwitch 冷却一致）。 */
export const COMMENTARY_TOPIC_COOLDOWN_MS = 60_000
/** 去重窗口：仅把最近 N 条传给 LLM 作为「避免重复」提示。 */
export const RECENT_COMMENTARY_DEDUP_WINDOW = 10

export interface LiveCommentaryState {
  /** 本地 llm 源点评（最新在上）。 */
  commentaries: Commentary[]
  /** 正在请求一条点评。 */
  collecting: boolean
  /** 上次成功/跳过的时间戳（ms）。 */
  lastAt: number | null
  /** 本地点评条数。 */
  count: number
  /** 降级原因（保留历史，不白屏）。 */
  error: string | null
  /** 话题切换补采（≥60s 冷却，受 enabled/listening 门控）。 */
  topicBoost: () => void
}

interface Options {
  meetingId: string
  entries: TranscriptEntry[]
  /** 实时点评总开关（关闭则暂停采集，仅保留历史）。 */
  enabled: boolean
  /** 是否处于收音进行中（停止收音则暂停采集）。 */
  listening: boolean
  meetingTitle?: string
  /** 当前思维导图顶层话题（作为 LLM 上下文，可选）。 */
  topTopics?: string[]
}

/** 从 entries 抽取 speech 文本并拼接为 rawText（数据来源唯一）。 */
function getRawText(entries: TranscriptEntry[]): string {
  return entries
    .filter((e) => e.type === 'speech' && e.text)
    .map((e) => e.text)
    .join('\n')
}

/**
 * 会中 LLM 轻量点评采集 Hook。
 * 维护本地 llm 源 commentaries，暴露 collecting/lastAt/count/error 与 topicBoost。
 */
export function useLiveCommentary({
  entries,
  enabled,
  listening,
  meetingTitle,
  topTopics,
}: Options): LiveCommentaryState {
  const [commentaries, setCommentaries] = useState<Commentary[]>([])
  const [collecting, setCollecting] = useState(false)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 用 ref 跟踪最新值，避免定时器/回调闭包读到陈旧数据
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const listeningRef = useRef(listening)
  listeningRef.current = listening
  const titleRef = useRef(meetingTitle)
  titleRef.current = meetingTitle
  const topicsRef = useRef(topTopics)
  topicsRef.current = topTopics
  const commsRef = useRef(commentaries)
  commsRef.current = commentaries
  const lastAtRef = useRef<number | null>(null)
  lastAtRef.current = lastAt
  const collectingRef = useRef(false)

  const tick = useCallback(async (trigger: 'timer' | 'topic') => {
    // 并发保护：同窗口只跑一个请求
    if (collectingRef.current) return
    const now = Date.now()
    // 最小间隔门控 60s：避免与话题补采互相刷屏
    if (lastAtRef.current && now - lastAtRef.current < COMMENTARY_MIN_GAP_MS) return
    // 开关 / 收音状态门控
    if (!enabledRef.current || !listeningRef.current) return
    const rawText = getRawText(entriesRef.current)
    if (!rawText.trim()) return

    collectingRef.current = true
    setCollecting(true)
    setError(null)
    const anchorTs = new Date().toISOString()
    const anchorTime = new Date(anchorTs).getTime()
    // 时间轴联动锚点：取锚定时刻之前最近一段 speech 条目 id（后端落库，卡片「定位」用）
    const anchorEntryIds = entriesRef.current
      .filter((e) => e.type === 'speech' && new Date(e.ts).getTime() <= anchorTime)
      .slice(-12)
      .map((e) => e.id)
    const recent = commsRef.current
      .filter((c) => c.source === 'llm')
      .slice(-RECENT_COMMENTARY_DEDUP_WINDOW)
      .map((c) => ({ type: c.type, text: c.text }))
    try {
      const res = await liveCommentary({
        rawText,
        ctx: {
          meetingTitle: titleRef.current,
          trigger,
          anchorTs,
          anchorEntryIds,
          recentCommentary: recent,
          topTopics: topicsRef.current,
        },
      })
      if (res.ok && res.commentary) {
        // 前置到最新（面板最新在上）；id 去重防重复追加
        setCommentaries((prev) =>
          prev.some((c) => c.id === res.commentary!.id)
            ? prev
            : [{ ...res.commentary!, isNew: true } as Commentary, ...prev],
        )
        setLastAt(Date.now())
      } else if (res.ok && res.commentary === null) {
        // 本窗口无可点评：静默跳过（非降级）
        setLastAt(Date.now())
      } else {
        // 降级：保留上次，不白屏
        setError(res.error ?? '点评暂不可用')
      }
    } catch {
      setError('点评请求失败，已保留历史')
    } finally {
      collectingRef.current = false
      setCollecting(false)
    }
  }, [])

  // 主定时采集（150s），受 enabled/listening 门控在 tick 内再判断
  useEffect(() => {
    const timer = setInterval(() => {
      void tick('timer')
    }, COMMENTARY_TIMER_MS)
    return () => clearInterval(timer)
  }, [tick])

  // 话题切换补采（≥60s 冷却 + 门控在 tick 内判断）
  const topicBoost = useCallback(() => {
    void tick('topic')
  }, [tick])

  return {
    commentaries,
    collecting,
    lastAt,
    count: commentaries.length,
    error,
    topicBoost,
  }
}

// 局部扩展：前端用 isNew 标记新到卡片（不影响后端契约 Commentary 结构）。
// 该字段仅用于「新」高亮，组件消费后即不再依赖。
declare module '../types' {
  interface Commentary {
    isNew?: boolean
  }
}
