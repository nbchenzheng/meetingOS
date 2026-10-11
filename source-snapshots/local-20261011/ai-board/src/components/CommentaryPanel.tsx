// src/components/CommentaryPanel.tsx —— 会中实时反馈面板（三栏第三栏）
// 头部：标题 + 开关（commentaryEnabled）+ 计数 + 采集态 + 降级提示；
// 主体：静音态 / 空态 / 点评流（最新在上、新标记、自动滚顶）+ 已收藏分组（P1）。
import { useEffect, useMemo, useState } from 'react'
import type { Commentary } from '../types'
import CommentaryCard from './CommentaryCard'

interface Props {
  meetingId: string
  /** 已合并且最新在上的点评流（llm 源 + big-shot 源）。 */
  commentaries: Commentary[]
  /** 实时点评总开关（false=静音面板，保留历史）。 */
  commentaryEnabled: boolean
  /** 前端 LLM 采集进行中（展示转圈）。 */
  collecting?: boolean
  /** LLM 采集降级原因（保留历史，不白屏）。 */
  error?: string | null
  /** 切换开关。 */
  onToggle: (enabled: boolean) => void
  /** 点击「@关联 · 定位」跳转录时间轴（C-P1-2 / C-P1-3）。 */
  onAnchor?: (c: Commentary) => void
}

// 小型开关（复用 .toggle 视觉）
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`toggle${on ? ' on' : ''}`} style={{ cursor: 'pointer' }}>
      <span className="track">
        <span className="knob" />
      </span>
      <span className="toggle-label">{on ? '点评中' : '已静音'}</span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: 'none' }}
      />
    </label>
  )
}

export default function CommentaryPanel({
  commentaries,
  commentaryEnabled,
  collecting,
  error,
  onToggle,
  onAnchor,
}: Props) {
  // 本地收藏 / 忽略态（P1；后端 big-shot 已持久化 pinned，llm 源以本地覆盖）
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  // 「新」标记：新到卡片高亮 ~2.5s 后消失（初始加载不抢标）
  const [seen, setSeen] = useState<Set<string>>(() => new Set(commentaries.map((c) => c.id)))
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const ids = commentaries.map((c) => c.id)
    const fresh = ids.filter((id) => !seen.has(id))
    if (fresh.length === 0) return
    setSeen((prev) => {
      const n = new Set(prev)
      fresh.forEach((id) => n.add(id))
      return n
    })
    setNewIds((prev) => {
      const n = new Set(prev)
      fresh.forEach((id) => n.add(id))
      return n
    })
    const t = setTimeout(() => {
      setNewIds((prev) => {
        const n = new Set(prev)
        fresh.forEach((id) => n.delete(id))
        return n
      })
    }, 2500)
    return () => clearTimeout(t)
  }, [commentaries, seen])

  const isBookmarked = (c: Commentary) => Boolean(c.pinned) || pinned.has(c.id)
  const isIgnored = (c: Commentary) => ignored.has(c.id)

  const visible = useMemo(
    () => commentaries.filter((c) => !isIgnored(c)),
    // eslint 依赖：ignored 变化需重算
    [commentaries, ignored],
  )
  const bookmarked = useMemo(() => visible.filter(isBookmarked), [visible, pinned, commentaries])
  const stream = useMemo(() => visible.filter((c) => !isBookmarked(c)), [visible, pinned, commentaries])

  const togglePin = (id: string) =>
    setPinned((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleIgnore = (id: string) =>
    setIgnored((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const renderCard = (c: Commentary, isNew: boolean) => (
    <CommentaryCard
      key={c.id}
      commentary={c}
      isNew={isNew}
      bookmarked={isBookmarked(c)}
      ignored={isIgnored(c)}
      onBookmark={togglePin}
      onIgnore={toggleIgnore}
      onAnchor={onAnchor}
    />
  )

  return (
    <div className="commentary-panel">
      <div className="cm-panel-head">
        <div className="cm-title">
          实时反馈 <span className="count">{visible.length}</span>
        </div>
        <div className="cm-head-right">
          {collecting && <span className="cm-spinner" title="点评采集中" />}
          <Toggle on={commentaryEnabled} onChange={onToggle} />
        </div>
      </div>

      {error && (
        <div className="alert warn">
          <span className="alert-ico">!</span>
          <span>{error}</span>
        </div>
      )}

      <div className="commentary-scroll">
        {!commentaryEnabled ? (
          <div className="cm-muted">
            已静音：暂停实时点评采集，历史仍保留。手动「💬 发言」与自动发言不受影响。
          </div>
        ) : visible.length === 0 ? (
          <div className="cm-empty">
            会议进行中，实时点评将自动出现在这里（点开关可静音）。
          </div>
        ) : (
          <>
            {bookmarked.length > 0 && (
              <section className="cm-group">
                <div className="cm-group-title">⭐ 收藏 ({bookmarked.length})</div>
                {bookmarked.map((c) => renderCard(c, false))}
              </section>
            )}
            <section className="cm-stream">{stream.map((c) => renderCard(c, newIds.has(c.id)))}</section>
          </>
        )}
      </div>
    </div>
  )
}
