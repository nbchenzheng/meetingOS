// src/hooks/useBoardSearch.ts —— 跨「发言区 + 结构化纪要 + 思维导图 + 点评」检索
import { useMemo } from 'react'
import type { Commentary, MindMapNode, SearchResult, StructuredMinutes, TranscriptEntry } from '../types'
import { type SpeakerInfo } from '../lib/speaker'

interface SearchOpts {
  entries: TranscriptEntry[]
  structuredRefined: StructuredMinutes | null
  mindmap: MindMapNode | null
  commentaries: Commentary[]
  resolveSpeaker: (e: TranscriptEntry) => SpeakerInfo
}

function snippet(text: string, idx: number, len = 30): string {
  const start = Math.max(0, idx - 8)
  const end = Math.min(text.length, start + len)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/**
 * 全局搜索：在四个来源中扁平化检索关键词，返回分组友好的 SearchResult[]。
 * 依赖 query 与各来源，结果随重命名（resolveSpeaker 闭包 roleLabels）实时刷新。
 */
export function useBoardSearch(query: string, opts: SearchOpts): SearchResult[] {
  return useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const results: SearchResult[] = []

    // 1) 发言区（逐条目）
    for (const e of opts.entries) {
      const t = e.text || ''
      const idx = t.indexOf(q)
      if (idx >= 0) {
        const sp = opts.resolveSpeaker(e)
        results.push({
          kind: 'entry',
          label: `${sp.isBigShot ? '大咖AI' : '发言区'} · ${sp.label}`,
          targetId: e.id,
          snippet: snippet(t, idx),
          ts: e.ts,
        })
      }
    }

    // 2) 结构化纪要
    if (opts.structuredRefined) {
      for (const ch of opts.structuredRefined.chapters) {
        for (const p of ch.paragraphs) {
          const idx = p.text.indexOf(q)
          if (idx >= 0) {
            results.push({
              kind: 'minutes-paragraph',
              label: `智能纪要 · ${ch.title}`,
              targetId: p.id,
              snippet: snippet(p.text, idx),
            })
          }
        }
      }
    }

    // 3) 思维导图
    if (opts.mindmap) {
      const walk = (node: MindMapNode) => {
        if (node.title.includes(q)) {
          results.push({
            kind: 'mindmap-node',
            label: `思维导图 · ${node.title}`,
            targetId: node.title,
            snippet: node.title,
          })
        }
        ;(node.children ?? []).forEach(walk)
      }
      walk(opts.mindmap)
    }

    // 4) 实时点评
    for (const c of opts.commentaries) {
      const idx = c.text.indexOf(q)
      if (idx >= 0) {
        results.push({
          kind: 'commentary',
          label: `实时反馈 · ${c.roleCn || (c.roleId ? c.roleId : '点评')}`,
          targetId: c.id,
          snippet: snippet(c.text, idx),
          ts: c.ts,
        })
      }
    }

    return results
  }, [query, opts.entries, opts.structuredRefined, opts.mindmap, opts.commentaries, opts.resolveSpeaker])
}
