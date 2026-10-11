// src/components/StructuredMinutes.tsx —— 结构化纪要渲染（消费 B1：章节 / 结论高亮 / ✅行动项 / 来源标注 / 关键词）
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Keyword, Role, StructuredMinutes, TranscriptEntry, UserHighlight } from '../types'
import { resolveSpeaker } from '../lib/speaker'
import { highlightText, type HighlightRule } from '../lib/highlight'
import { fmtOffset } from '../lib/format'

interface Props {
  data: StructuredMinutes | null
  fallbackText?: string | null
  highlightTerm?: string
  scrollTargetId?: string | null
  meetCreatedAt?: string
  roleLabels: Record<string, string>
  roles: Role[]
  entries: TranscriptEntry[]
  keywords: Keyword[]
  refining?: boolean
  onJumpToEntry: (id: string) => void
  onKeywordClick: (word: string) => void
  userHighlights?: UserHighlight[]
}

interface SourceInfo {
  entryId: string
  label: string
  offset: string
}

export default function StructuredMinutes({
  data,
  fallbackText,
  highlightTerm,
  scrollTargetId,
  meetCreatedAt,
  roleLabels,
  roles,
  entries,
  keywords,
  refining,
  onJumpToEntry,
  onKeywordClick,
  userHighlights,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  const sourceFor = (p: { sourceEntryId?: string; text: string }): SourceInfo | null => {
    if (p.sourceEntryId && entryById.has(p.sourceEntryId)) {
      const e = entryById.get(p.sourceEntryId)!
      const sp = resolveSpeaker(e, roleLabels, roles)
      return { entryId: e.id, label: sp.label, offset: fmtOffset(e.ts, meetCreatedAt) }
    }
    // 文本兜底：找原文包含该段首句或该段包含原句的条目
    const needle = p.text.slice(0, 12)
    if (needle) {
      const hit = entries.find(
        (e) => e.text && (e.text.includes(needle) || needle.includes(e.text.slice(0, 12))),
      )
      if (hit) {
        const sp = resolveSpeaker(hit, roleLabels, roles)
        return { entryId: hit.id, label: sp.label, offset: fmtOffset(hit.ts, meetCreatedAt) }
      }
    }
    return null
  }

  const rulesFor = (targetId: string, text: string): HighlightRule[] => {
    const rules: HighlightRule[] = []
    if (highlightTerm) rules.push({ term: highlightTerm, cls: 'kw-hl' })
    for (const h of userHighlights ?? []) {
      if (h.targetId === targetId && h.text && text.includes(h.text)) rules.push({ term: h.text, cls: 'user-hl' })
    }
    return rules
  }

  // 跳转滚动 + 高亮闪烁
  useEffect(() => {
    if (!scrollTargetId) return
    const root = ref.current
    if (!root) return
    const el = root.querySelector<HTMLElement>(`[data-min-id="${CSS.escape(scrollTargetId)}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('anchor-hl')
    const t = setTimeout(() => el.classList.remove('anchor-hl'), 2200)
    return () => clearTimeout(t)
  }, [scrollTargetId])

  if (!data || data.chapters.length === 0) {
    return <div className="structured-minutes-empty">{fallbackText || 'AI 整理版生成中…'}</div>
  }

  const toggleChapter = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="structured-minutes" ref={ref}>
      {/* 关键词区（消费 B1 关键词） */}
      {keywords.length > 0 && (
        <div className="kw-area">
          <span className="kw-area-title">🔑 关键词</span>
          <div className="kw-chips">
            {keywords.map((k) => (
              <button
                key={k.word}
                type="button"
                className="kw-chip"
                onClick={() => onKeywordClick(k.word)}
                title={typeof k.count === 'number' ? `出现 ${k.count} 次` : '点击高亮全文'}
              >
                {k.word}
                {typeof k.count === 'number' ? <span className="kw-cnt">{k.count}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.chapters.map((ch) => {
        const isCollapsed = collapsed.has(ch.id)
        return (
          <section className="min-chapter" key={ch.id}>
            <button type="button" className="min-ch-title" onClick={() => toggleChapter(ch.id)}>
              <span className={`min-caret${isCollapsed ? '' : ' open'}`}>▸</span>
              {ch.title}
            </button>
            {!isCollapsed && (
              <div className="min-body">
                {ch.paragraphs.map((p) => {
                  const src = sourceFor(p)
                  const rules = rulesFor(p.id, p.text)
                  return (
                    <div className={`min-para${p.type === 'conclusion' ? ' conclusion-hl' : ''}`} data-min-id={p.id} key={p.id}>
                      <div className="min-text">{highlightText(p.text, rules)}</div>
                      {p.aiSupplement && <span className="ai-badge">AI补充</span>}
                      {src && (
                        <button type="button" className="src-btn" onClick={() => onJumpToEntry(src.entryId)}>
                          源自 发言区 {src.offset} {src.label}
                        </button>
                      )}
                    </div>
                  )
                })}

                {ch.actionItems.length > 0 && (
                  <div className="min-actions">
                    <div className="min-actions-title">✅ 行动项</div>
                    {ch.actionItems.map((a) => {
                      const src = sourceFor(a)
                      return (
                        <div className="min-action" data-min-id={a.id} key={a.id}>
                          <span className="min-action-check">☐</span>
                          <span className="min-action-text">{a.text}</span>
                          {(a.owner || a.due) && (
                            <span className="min-action-meta">
                              {a.owner ? `负责人 ${a.owner}` : ''}
                              {a.owner && a.due ? ' · ' : ''}
                              {a.due ? `截止 ${a.due}` : ''}
                            </span>
                          )}
                          {src && (
                            <button type="button" className="src-btn" onClick={() => onJumpToEntry(src.entryId)}>
                              源自 {src.offset} {src.label}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
      {refining && <div className="min-refining">整理中…</div>}
    </div>
  )
}
