// src/hooks/useTranscriptEnhance.ts —— 转录增强状态机
// 负责：挂载即启动 60s 整理 / 5min 思维导图定时器；卸载或 active=false 时清理定时器并中止在途请求；
// 每个 tick 先算 rawText，为空则跳过（边界 6）；失败降级保留上次数据、不白屏、不重试。
import { useEffect, useRef, useState } from 'react'
import type { Keyword, MindMapNode, RefineEntryInput, StructuredMinutes, TranscriptEntry } from '../types'
import { mindmapTranscript, refineTranscript } from '../lib/api'

/** 段落聚合阈值：相邻 speech 条目 ts 间隔 > 该值即另起一段（主理人拍板 2500ms）。 */
export const PAUSE_MS = 2500

export interface EnhanceState {
  rawText: string // 当前累积原始转录（= speech 条目 join('\n')）
  refinedText: string | null // 最近一次整理结果（null=尚未成功）
  mindmap: MindMapNode | null // 最近一次导图（null=尚未成功）
  structuredRefined: StructuredMinutes | null // 最近一次结构化纪要（B1）
  keywords: Keyword[] // 最近一次关键词（B1）
  refining: boolean // 整理请求进行中
  mindmapping: boolean // 导图请求进行中
  lastRefineAt: number | null // 上次成功整理时间戳（ms）
  lastMindmapAt: number | null // 上次成功导图时间戳（ms）
  refineError: string | null // 整理降级原因
  mindmapError: string | null // 导图降级原因
}

interface Options {
  entries: TranscriptEntry[]
  active?: boolean // 是否处于「会议进行中」（默认 true）
  meetingId?: string // 用于话题切换检测（mindmap 顶层分支 diff → 大咖主动点评）
  meetingTitle?: string // 用于思维导图根标题
  refineIntervalMs?: number // 整理周期，默认 60000
  mindmapIntervalMs?: number // 导图周期，默认 300000
}

/** 从 entries 抽取 speech 文本并拼接为 rawText（数据来源唯一，边界 7）。 */
export function getRawText(entries: TranscriptEntry[]): string {
  return entries
    .filter((e) => e.type === 'speech')
    .map((e) => e.text)
    .join('\n')
}

export function useTranscriptEnhance({
  entries,
  active = true,
  meetingTitle,
  meetingId,
  refineIntervalMs = 60000,
  mindmapIntervalMs = 300000,
}: Options): EnhanceState {
  const [rawText, setRawText] = useState('')
  const [refinedText, setRefinedText] = useState<string | null>(null)
  const [mindmap, setMindmap] = useState<MindMapNode | null>(null)
  const [structuredRefined, setStructuredRefined] = useState<StructuredMinutes | null>(null)
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [refining, setRefining] = useState(false)
  const [mindmapping, setMindmapping] = useState(false)
  const [lastRefineAt, setLastRefineAt] = useState<number | null>(null)
  const [lastMindmapAt, setLastMindmapAt] = useState<number | null>(null)
  const [refineError, setRefineError] = useState<string | null>(null)
  const [mindmapError, setMindmapError] = useState<string | null>(null)

  // 跟随最新 entries / meetingTitle / meetingId，避免 interval 闭包读到陈旧数据
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const meetingTitleRef = useRef(meetingTitle)
  meetingTitleRef.current = meetingTitle
  const meetingIdRef = useRef(meetingId)
  meetingIdRef.current = meetingId

  // entries 变化时同步刷新 rawText（供 UI 展示当前原稿）
  useEffect(() => {
    setRawText(getRawText(entries))
  }, [entries])

  // 主定时器效应：active 时启动；依赖变化或卸载时清理
  useEffect(() => {
    if (!active) return
    let alive = true // 防止卸载后 setState 警告（边界 6）
    let refineAc: AbortController | null = null
    let mindmapAc: AbortController | null = null

    const runRefine = async () => {
      const input: RefineEntryInput[] = entriesRef.current
        .filter((e) => (e.type === 'speech' || e.type === 'opinion') && e.text && e.text.trim())
        .map((e) => ({
          id: e.id,
          ts: e.ts,
          type: e.type,
          text: e.text,
          roleId: e.roleId,
          speaker: e.speaker,
          color: e.color,
        }))
      if (input.length === 0) return // 边界 6：无转录内容则跳过
      setRefining(true)
      setRefineError(null)
      refineAc = new AbortController()
      try {
        const res = await refineTranscript(input, refineAc.signal)
        if (!alive) return
        if (res.ok && res.structured) {
          setStructuredRefined(res.structured)
          setKeywords(res.keywords ?? [])
          setRefinedText(res.refinedText || res.structured.plainText)
          setLastRefineAt(Date.now())
          setRefineError(null)
        } else {
          // 降级：保留上次 structuredRefined，仅更新错误态，不白屏
          setRefineError(res.error ?? '整理暂不可用')
        }
      } catch {
        if (!alive) return
        setRefineError('整理暂不可用')
      } finally {
        if (alive) setRefining(false)
        refineAc = null
      }
    }

    const runMindmap = async () => {
      const text = getRawText(entriesRef.current)
      if (!text.trim()) return
      setMindmapping(true)
      setMindmapError(null)
      mindmapAc = new AbortController()
      const title = meetingTitleRef.current ?? ''
      const meetingId = meetingIdRef.current ?? ''
      const entryIds = entriesRef.current
        .filter((e) => (e.type === 'speech' || e.type === 'opinion') && e.text && e.text.trim())
        .map((e) => e.id)
      try {
        const res = await mindmapTranscript(text, title, meetingId, entryIds, mindmapAc.signal)
        if (!alive) return
        if (res.ok && res.root) {
          setMindmap(res.root)
          setLastMindmapAt(Date.now())
          setMindmapError(null)
        } else {
          setMindmapError(res.error ?? '导图暂不可用')
        }
      } catch {
        if (!alive) return
        setMindmapError('导图暂不可用')
      } finally {
        if (alive) setMindmapping(false)
        mindmapAc = null
      }
    }

    const refineTimer = setInterval(runRefine, refineIntervalMs)
    const mindmapTimer = setInterval(runMindmap, mindmapIntervalMs)

    return () => {
      alive = false
      clearInterval(refineTimer)
      clearInterval(mindmapTimer)
      refineAc?.abort()
      mindmapAc?.abort()
    }
  }, [active, refineIntervalMs, mindmapIntervalMs])

  return {
    rawText,
    refinedText,
    mindmap,
    structuredRefined,
    keywords,
    refining,
    mindmapping,
    lastRefineAt,
    lastMindmapAt,
    refineError,
    mindmapError,
  }
}
