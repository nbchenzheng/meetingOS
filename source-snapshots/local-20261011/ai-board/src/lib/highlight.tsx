// src/lib/highlight.tsx —— 文本高亮渲染工具（关键词 / 划词 / 搜索高亮复用）
import { Fragment, type ReactNode } from 'react'

export interface HighlightRule {
  term: string
  cls: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将文本按规则列表包裹为 <mark>。
 * - 多个词按长度降序合并为正则，避免短词先切导致长词被拆；
 * - 无有效规则时原样返回字符串。
 */
export function highlightText(text: string, rules: HighlightRule[]): ReactNode {
  const active = rules.filter((r) => r.term && r.term.trim())
  if (active.length === 0) return text
  const pattern = active
    .map((r) => escapeRegExp(r.term))
    .sort((a, b) => b.length - a.length)
    .join('|')
  if (!pattern) return text
  const re = new RegExp(`(${pattern})`, 'g')
  const clsByTerm = new Map<string, string>()
  for (const r of active) clsByTerm.set(r.term, r.cls)
  const parts = text.split(re)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const cls = clsByTerm.get(part) ?? 'kw-hl'
      return (
        <mark key={i} className={cls}>
          {part}
        </mark>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
