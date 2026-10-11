// src/components/ExportMenu.tsx —— 导出 Markdown / TXT（纯前端 Blob 下载，含角色 + 相对时间戳）
import { useEffect, useRef, useState } from 'react'
import type { Keyword, Role, StructuredMinutes, TranscriptEntry } from '../types'
import { resolveSpeaker } from '../lib/speaker'
import { fmtOffset } from '../lib/format'

interface Props {
  entries: TranscriptEntry[]
  roles: Role[]
  roleLabels: Record<string, string>
  structuredRefined: StructuredMinutes | null
  meetCreatedAt?: string
  meetingTitle: string
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function buildTranscript(entries: TranscriptEntry[], roles: Role[], roleLabels: Record<string, string>, base?: string): string {
  const sorted = [...entries].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return sorted
    .map((e) => {
      const sp = resolveSpeaker(e, roleLabels, roles)
      return `+${fmtOffset(e.ts, base).replace(/^\+/, '')} ${sp.label}：${e.text}`
    })
    .join('\n')
}

function buildMinutes(data: StructuredMinutes, keywords: Keyword[]): string {
  const lines: string[] = []
  for (const ch of data.chapters) {
    lines.push(`## ${ch.title}`)
    for (const p of ch.paragraphs) {
      const prefix = p.type === 'conclusion' ? '【结论】' : '- '
      lines.push(`${prefix}${p.text}`)
    }
    if (ch.actionItems.length) {
      lines.push('### ✅ 行动项')
      for (const a of ch.actionItems) {
        const meta = [a.owner ? `负责人 ${a.owner}` : '', a.due ? `截止 ${a.due}` : ''].filter(Boolean).join(' · ')
        lines.push(`- [ ] ${a.text}${meta ? `（${meta}）` : ''}`)
      }
    }
    lines.push('')
  }
  if (keywords.length) {
    lines.push(`关键词：${keywords.map((k) => k.word).join('、')}`)
  }
  return lines.join('\n')
}

export default function ExportMenu({ entries, roles, roleLabels, structuredRefined, meetCreatedAt, meetingTitle }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const safeName = (meetingTitle || '会议纪要').replace(/[\\/:*?"<>|]/g, '_')

  const doExport = (scope: 'minutes' | 'transcript', fmt: 'md' | 'txt') => {
    setOpen(false)
    if (scope === 'minutes' && structuredRefined) {
      const content = `# ${meetingTitle}\n\n${buildMinutes(structuredRefined, structuredRefined.keywords)}`
      download(`${safeName}-纪要.${fmt}`, content, fmt === 'md' ? 'text/markdown' : 'text/plain')
    } else {
      const content =
        fmt === 'md'
          ? `# ${meetingTitle}\n\n${buildTranscript(entries, roles, roleLabels, meetCreatedAt)}`
          : buildTranscript(entries, roles, roleLabels, meetCreatedAt)
      download(`${safeName}-发言.${fmt}`, content, fmt === 'md' ? 'text/markdown' : 'text/plain')
    }
  }

  return (
    <div className="export-menu" ref={ref}>
      <button className="btn ghost" type="button" onClick={() => setOpen((o) => !o)}>
        导出 ▾
      </button>
      {open && (
        <div className="export-pop">
          <button type="button" className="export-item" onClick={() => doExport('minutes', 'md')} disabled={!structuredRefined}>
            📝 导出 Markdown（纪要）
          </button>
          <button type="button" className="export-item" onClick={() => doExport('transcript', 'md')}>
            💬 导出 Markdown（发言区）
          </button>
          <button type="button" className="export-item" onClick={() => doExport('transcript', 'txt')}>
            📄 导出 TXT（发言区）
          </button>
        </div>
      )}
    </div>
  )
}
