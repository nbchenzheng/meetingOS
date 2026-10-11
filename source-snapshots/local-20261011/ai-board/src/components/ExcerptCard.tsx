// src/components/ExcerptCard.tsx —— 文字摘录卡片（复制 MD / 导出）
import type { Role, TranscriptEntry } from '../types'
import { resolveSpeaker } from '../lib/speaker'
import { fmtOffset } from '../lib/format'

interface Props {
  entries: TranscriptEntry[]
  roles: Role[]
  roleLabels: Record<string, string>
  meetCreatedAt?: string
  onCopy: () => void
  onExport: () => void
  onClose: () => void
}

function buildMd(entries: TranscriptEntry[], roles: Role[], roleLabels: Record<string, string>, base?: string): string {
  const sorted = [...entries].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return sorted
    .map((e) => {
      const sp = resolveSpeaker(e, roleLabels, roles)
      return `> +${fmtOffset(e.ts, base).replace(/^\+/, '')} ${sp.label}：${e.text}`
    })
    .join('\n')
}

export default function ExcerptCard({ entries, roles, roleLabels, meetCreatedAt, onCopy, onExport, onClose }: Props) {
  const sorted = [...entries].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return (
    <div className="excerpt-card">
      <div className="excerpt-head">
        <span className="excerpt-title">摘录卡片（{entries.length}）</span>
        <button type="button" className="excerpt-x" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="excerpt-body">
        {sorted.map((e) => {
          const sp = resolveSpeaker(e, roleLabels, roles)
          return (
            <div className="excerpt-row" key={e.id}>
              <span className="excerpt-time">+{fmtOffset(e.ts, meetCreatedAt).replace(/^\+/, '')}</span>
              <span className="excerpt-name">{sp.label}</span>
              <span className="excerpt-text">{e.text}</span>
            </div>
          )
        })}
      </div>
      <div className="excerpt-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const md = buildMd(entries, roles, roleLabels, meetCreatedAt)
            navigator.clipboard?.writeText(md).catch(() => {})
            onCopy()
          }}
        >
          复制 MD
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            const md = buildMd(entries, roles, roleLabels, meetCreatedAt)
            const blob = new Blob([md], { type: 'text/markdown' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = '摘录.md'
            a.click()
            URL.revokeObjectURL(url)
            onExport()
          }}
        >
          导出
        </button>
      </div>
    </div>
  )
}
