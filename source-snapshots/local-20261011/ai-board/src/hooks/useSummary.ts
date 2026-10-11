// src/hooks/useSummary.ts —— 会议总结 + 邮件发送 状态机（S0–S6）
//
// 状态流转：
//   S0 空闲（已生成总结，可展示）  ← 生成成功
//   S1 生成中                       ← 调用 generate()
//   S2 待确认（已请求发送，弹确认框）← 调用 send() 成功取得 preview
//   S3 发送中                       ← 调用 confirm()
//   S4 发送成功                     ← confirm() 成功
//   S5 已取消                       ← 调用 cancel()
//   S6 错误/降级                    ← 任意阶段失败（含降级），前端显示提示而非白屏
//
// ctk 安全：前端仅持有 confirmationRef，绝不直接接触 ctk（ctk 由后端 ctkStore 持有）。
// 真实发信已在后端 summary-service 接入：sendSummary 返回 confirmationRef + preview，
// confirmSendSummary 真发；失败走 S6 降级并显示可读错误，绝不白屏。
import { useCallback, useRef, useState } from 'react'
import type {
  Meeting,
  SendPreview,
  SummaryEntry,
  SummaryLevel,
  SummaryResult,
  TranscriptEntry,
} from '../types'
import { confirmSendSummary, generateSummary, sendSummary } from '../lib/api'
import { validateEmail } from '../lib/email'

/** 总结状态机状态。 */
export type SummaryState = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'

export interface UseSummaryResult {
  state: SummaryState
  summary: SummaryResult | null
  confirmationRef: string | null
  preview: SendPreview | null
  error: string | null
  degraded: boolean
  cached: boolean
  generate: () => Promise<void>
  send: (email: string) => Promise<void>
  confirm: () => Promise<void>
  cancel: () => void
  reset: () => void
  copy: () => void
  download: () => void
}

interface Options {
  meeting: Meeting
  level?: SummaryLevel
}

// —— 工具：把转录条目精简为总结请求条目 ——
export function toSummaryEntries(entries: TranscriptEntry[]): SummaryEntry[] {
  return entries
    .filter((e) => e && e.text && e.text.trim())
    .map((e) => ({
      id: e.id,
      type: e.type,
      text: e.text,
      speaker: e.speaker,
      roleId: e.roleId,
      ts: e.ts,
    }))
}

// —— 工具：总结转 Markdown（复制 / 下载 / 大小预估共用）——
export function summaryToMarkdown(s: SummaryResult): string {
  const lines: string[] = []
  lines.push(`# 【AI大咖会议私董会】${s.subject} · 会议总结`)
  lines.push('')
  lines.push(`- 会议时间：${s.occurredAt || '—'}`)
  lines.push(`- 总结级别：${s.level}`)
  lines.push('')
  for (const el of s.elements) {
    lines.push(`## ${el.title}`)
    lines.push('')
    lines.push(el.content || '（无内容）')
    lines.push('')
  }
  if (s.bigShots.length) {
    lines.push('## 各预设大咖核心观点')
    lines.push('')
    for (const b of s.bigShots) {
      const view = b.viewpoint || '（本次会议未见其明确观点）'
      lines.push(`- **${b.cn}**（${b.title}）：${view}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// —— 工具：邮件主题（与后端规则一致）——
export function buildSummarySubject(s: SummaryResult): string {
  return `【AI大咖会议私董会】${s.subject} · 会议总结`
}

export function useSummary({ meeting, level = 'detailed' }: Options): UseSummaryResult {
  const [state, setState] = useState<SummaryState>('S0')
  const [summary, setSummary] = useState<SummaryResult | null>(null)
  const [confirmationRef, setConfirmationRef] = useState<string | null>(null)
  const [preview, setPreview] = useState<SendPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [cached, setCached] = useState(false)

  // 跟随最新 meeting（SummaryRoom 会在挂载时重新拉取带 transcript 的会议）
  const meetingRef = useRef(meeting)
  meetingRef.current = meeting
  const levelRef = useRef(level)
  levelRef.current = level
  const stateRef = useRef(state)
  stateRef.current = state

  // —— 生成总结 ——
  const generate = useCallback(async () => {
    if (stateRef.current === 'S1') return // 防止重复点击
    setError(null)
    setDegraded(false)
    setCached(false)
    setState('S1')
    const m = meetingRef.current
    const entries = toSummaryEntries(m.transcript)
    try {
      const res = await generateSummary({ meetingId: m.id, entries, level: levelRef.current })
      if (res.ok && res.result) {
        setSummary(res.result)
        setCached(Boolean(res.cached))
        setState('S0')
      } else {
        setDegraded(Boolean(res.degraded))
        setError(res.error ?? '总结生成失败')
        setState('S6')
      }
    } catch (e) {
      setDegraded(true)
      setError(e instanceof Error ? e.message : '总结生成失败')
      setState('S6')
    }
  }, [])

  // —— 发送（step1）：请求 ref，进入待确认 ——
  const send = useCallback(async (email: string) => {
    if (!summary) return
    if (!validateEmail(email)) {
      setError('邮箱格式不正确')
      setDegraded(false)
      setState('S6')
      return
    }
    setError(null)
    setDegraded(false)
    setState('S2')
    try {
      const res = await sendSummary({ meetingId: meetingRef.current.id, email, level: levelRef.current })
      if (res.ok && res.confirmationRef && res.preview) {
        // 真实后端：持有 ref + 预览，停留在 S2 等待确认
        setConfirmationRef(res.confirmationRef)
        setPreview(res.preview)
        setState('S2')
      } else {
        setDegraded(Boolean(res.degraded))
        setError(res.error ?? '邮件发送请求失败')
        setState('S6')
      }
    } catch (e) {
      setDegraded(true)
      setError(e instanceof Error ? e.message : '邮件发送请求失败')
      setState('S6')
    }
  }, [summary])

  // —— 确认发送（step2）——
  const confirm = useCallback(async () => {
    if (!confirmationRef) {
      setError('确认信息缺失，请重新发送')
      setState('S6')
      return
    }
    setState('S3')
    try {
      const res = await confirmSendSummary({ confirmationRef })
      setConfirmationRef(null)
      setPreview(null)
      if (res.ok) {
        setState('S4')
      } else {
        setDegraded(Boolean(res.degraded))
        setError(res.error ?? '邮件发送失败')
        setState('S6')
      }
    } catch (e) {
      setConfirmationRef(null)
      setPreview(null)
      setDegraded(true)
      setError(e instanceof Error ? e.message : '邮件发送失败')
      setState('S6')
    }
  }, [confirmationRef])

  // —— 取消发送 ——
  const cancel = useCallback(() => {
    setConfirmationRef(null)
    setPreview(null)
    setError(null)
    setState('S5')
  }, [])

  // —— 重置错误态，回到可展示态 ——
  const reset = useCallback(() => {
    setError(null)
    setDegraded(false)
    setConfirmationRef(null)
    setPreview(null)
    setState(summary ? 'S0' : 'S0')
  }, [summary])

  // —— 复制全文到剪贴板 ——
  const copy = useCallback(() => {
    if (!summary) return
    const md = summaryToMarkdown(summary)
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md).catch(() => {})
    }
  }, [summary])

  // —— 下载 Markdown 文件 ——
  const download = useCallback(() => {
    if (!summary) return
    const md = summaryToMarkdown(summary)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `会议总结_${summary.subject || 'meeting'}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [summary])

  return {
    state,
    summary,
    confirmationRef,
    preview,
    error,
    degraded,
    cached,
    generate,
    send,
    confirm,
    cancel,
    reset,
    copy,
    download,
  }
}
