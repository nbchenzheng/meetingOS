// src/components/CommentaryCard.tsx —— 单条点评卡（llm / bigshot 双样式）
// 复用 BigShotCard 的视觉语言（头像 / 主题色 / 姓名），llm 源以「AI 实时点评」标识。
import { useState } from 'react'
import type { Commentary, CommentaryType } from '../types'

interface Props {
  commentary: Commentary
  /** 新到标记（面板按 seen 集合判定，短暂高亮）。 */
  isNew?: boolean
  /** 本地收藏态（面板维护 Set，覆盖后端 pinned）。 */
  bookmarked?: boolean
  /** 本地忽略态（面板维护 Set）。 */
  ignored?: boolean
  /** 点击收藏 ⭐。 */
  onBookmark?: (id: string) => void
  /** 点击忽略 ✕。 */
  onIgnore?: (id: string) => void
  /** 点击「定位」（@关联转录时间轴，C-P1-2 / C-P1-3）。 */
  onAnchor?: (c: Commentary) => void
}

// 四类型标签与配色（与设计 §8.4 一致）
const TYPE_META: Record<CommentaryType, { label: string; color: string }> = {
  highlight: { label: '高亮', color: '#3b82f6' },
  risk: { label: '风险', color: '#ef4444' },
  clarify: { label: '澄清', color: '#f59e0b' },
  suggestion: { label: '建议', color: '#34d399' },
}

/** 时间戳格式化为 HH:MM。 */
function fmtTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export default function CommentaryCard({
  commentary: c,
  isNew,
  bookmarked,
  ignored,
  onBookmark,
  onIgnore,
  onAnchor,
}: Props) {
  const [imgErr, setImgErr] = useState(false)
  const meta = TYPE_META[c.type] ?? TYPE_META.highlight
  const isBigShot = c.source === 'bigshot'
  // 大咖卡：头像（avatar 或首字母）+ 主题色；llm 卡：AI 标识 + 强调色
  const accent = isBigShot ? c.color || '#3b82f6' : '#3b82f6'
  const showAnchor = Boolean(c.anchorEntryIds && c.anchorEntryIds.length)

  return (
    <div
      className={[
        'commentary-card',
        `source-${c.source}`,
        isNew ? 'is-new' : '',
        ignored ? 'is-ignored' : '',
        bookmarked ? 'is-bookmarked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--cardc' as any]: accent }}
    >
      <div className="cm-head">
        {isBigShot ? (
          <div className="cm-avatar">
            {c.roleId && !imgErr ? (
              <img className="cm-avatar-img" src={`/avatars/${c.roleId}.png`} alt={c.roleCn} onError={() => setImgErr(true)} />
            ) : (
              <div className="cm-avatar-fb">{(c.roleCn || '?').slice(0, 1)}</div>
            )}
          </div>
        ) : (
          <div className="cm-ai">AI</div>
        )}
        <div className="cm-id">
          <div className="cm-name">{isBigShot ? c.roleCn || c.roleId || '大咖' : 'AI 实时点评'}</div>
          <div className="cm-sub">
            <span className="cm-type" style={{ color: meta.color, borderColor: meta.color }}>
              {meta.label}
            </span>
            <span className="cm-time">{fmtTime(c.ts)}</span>
            {typeof c.importance === 'number' && (
              <span className={`cm-imp imp-${c.importance}`} title={`重要度 ${c.importance}`}>
                {'★'.repeat(c.importance)}
              </span>
            )}
          </div>
        </div>
        {isNew && <span className="cm-new">新</span>}
      </div>

      <div className="cm-text">{c.text}</div>

      <div className="cm-foot">
        <div className="cm-actions">
          {showAnchor && (
            <button type="button" className="cm-link" onClick={() => onAnchor?.(c)}>
              @关联 · 定位
            </button>
          )}
        </div>
        <div className="cm-toggles">
          <button
            type="button"
            className={`cm-btn${bookmarked ? ' on' : ''}`}
            title="收藏"
            onClick={() => onBookmark?.(c.id)}
          >
            ⭐
          </button>
          <button
            type="button"
            className={`cm-btn${ignored ? ' on' : ''}`}
            title="忽略"
            onClick={() => onIgnore?.(c.id)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
