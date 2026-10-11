// src/components/MindMapDrill.tsx —— 思维导图节点下钻浮层（来源 entry + 大咖观点 → 跳回发言区）
import { useMemo } from 'react'
import type { Role, TranscriptEntry } from '../types'
import { resolveSpeaker } from '../lib/speaker'
import { fmtOffset } from '../lib/format'

interface NodeLike {
  title: string
  entryIds?: string[]
}

interface Props {
  node: NodeLike
  entries: TranscriptEntry[]
  roles: Role[]
  roleLabels: Record<string, string>
  onJump: (entryId: string) => void
  onClose: () => void
}

export default function MindMapDrill({ node, entries, roles, roleLabels, onJump, onClose }: Props) {
  const sources = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e]))
    let list =
      node.entryIds && node.entryIds.length
        ? node.entryIds.map((id) => byId.get(id)).filter((e): e is TranscriptEntry => Boolean(e))
        : []
    if (list.length === 0) {
      // 文本兜底：原文包含节点标题的条目
      list = entries.filter((e) => e.text && e.text.includes(node.title)).slice(0, 6)
    }
    return list
  }, [node, entries])

  const bigShotViews = useMemo(
    () => entries.filter((e) => e.type === 'opinion' && e.text && e.text.includes(node.title)).slice(0, 3),
    [node, entries],
  )

  return (
    <div className="mm-drill-overlay" onMouseDown={onClose}>
      <div className="mm-drill" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mm-drill-head">
          <span className="mm-drill-title">🧠 {node.title}</span>
          <button type="button" className="mm-drill-x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="mm-drill-section">
          <div className="mm-drill-sub">发言来源</div>
          {sources.length === 0 ? (
            <div className="mm-drill-empty">暂无直接来源</div>
          ) : (
            sources.map((e) => {
              const sp = resolveSpeaker(e, roleLabels, roles)
              return (
                <button key={e.id} type="button" className="mm-drill-row" onClick={() => onJump(e.id)}>
                  <span className="mm-drill-dot" style={{ background: sp.isBigShot ? 'var(--bigshot-gradient)' : sp.color }} />
                  <span className="mm-drill-name">{sp.label}</span>
                  <span className="mm-drill-time">+{fmtOffset(e.ts).replace(/^\+/, '')}</span>
                  <span className="mm-drill-text">{e.text.slice(0, 40)}</span>
                </button>
              )
            })
          )}
        </div>

        {bigShotViews.length > 0 && (
          <div className="mm-drill-section">
            <div className="mm-drill-sub">大咖观点</div>
            {bigShotViews.map((e) => {
              const sp = resolveSpeaker(e, roleLabels, roles)
              return (
                <button key={e.id} type="button" className="mm-drill-row" onClick={() => onJump(e.id)}>
                  <span className="mm-drill-dot bigshot" />
                  <span className="mm-drill-name">{sp.label}</span>
                  <span className="mm-drill-text">{e.text.slice(0, 40)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
