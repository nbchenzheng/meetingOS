// src/components/TranscriptPanel.tsx —— 转录流（段落式 + 原稿/整理版切换 + @关联定位 + 增量可选装饰）
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TagKey, TranscriptDecoration, TranscriptEntry, UserHighlight } from '../types'
import { PAUSE_MS } from '../hooks/useTranscriptEnhance'
import { highlightText, type HighlightRule } from '../lib/highlight'
import RoleDot from './RoleDot'
import RenamePopover from './RenamePopover'
import TagMenu from './TagMenu'
import InlineEditor from './InlineEditor'

interface Props {
  entries: TranscriptEntry[]
  interim: string
  /** 'raw'=按停顿聚合的原稿段落；'refined'=LLM 润色版（单段落块）。 */
  view: 'raw' | 'refined'
  /** 整理版文本（view='refined' 时展示）；为 null 时回退到原稿。 */
  refinedText: string | null
  /** @关联 · 定位：需高亮滚动到的转录条目 id 列表（首个命中即定位）。 */
  anchorEntryIds?: string[]
  /** 定位时间锚（仅作为副作用依赖，避免重复触发）。 */
  anchorTs?: string
  // —— 增量（可选 prop，默认不传 = 行为不变）——
  /** 逐条装饰构造器：返回 dot / 重命名 / 标签 / 编辑 / 选择 / hover 动作。 */
  decorations?: (entry: TranscriptEntry) => TranscriptDecoration | null
  onRename?: (entryId: string, label: string) => void
  onTag?: (entryId: string, tag: TagKey) => void
  onEdit?: (entryId: string, text: string) => void
  onToggleSelect?: (entryId: string) => void
  /** 关键词 / 搜索高亮词（包裹 <mark>）。 */
  highlightTerm?: string
  /** 划词用户高亮（按 targetId = entry.id 匹配）。 */
  userHighlights?: UserHighlight[]
}

interface Paragraph {
  id: string
  text: string
  /** 段落内所有原始条目 id（用于 @关联 定位命中）。 */
  entryIds: string[]
  kind: 'speech' | 'opinion'
  ts: number
  speaker?: string
  color?: string
}

/** 将 speech 条目按相邻 ts 停顿（>PAUSE_MS）聚合成段落；opinion 单条成段（便于大咖点评 @关联定位）。 */
function buildParagraphs(entries: TranscriptEntry[]): Paragraph[] {
  const speech = entries
    .filter((e) => e.type === 'speech')
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  const paras: Paragraph[] = []
  let prevTs = 0
  for (const e of speech) {
    const t = new Date(e.ts).getTime()
    if (paras.length === 0 || t - prevTs > PAUSE_MS) {
      paras.push({ id: e.id, text: e.text, entryIds: [e.id], kind: 'speech', ts: t })
    } else {
      const last = paras[paras.length - 1]
      last.text = last.text + e.text
      last.entryIds.push(e.id)
    }
    prevTs = t
  }

  const opinions: Paragraph[] = entries
    .filter((e) => e.type === 'opinion')
    .map((e) => ({
      id: e.id,
      text: e.text,
      entryIds: [e.id],
      kind: 'opinion' as const,
      ts: new Date(e.ts).getTime(),
      speaker: e.speaker,
      color: e.color,
    }))

  return [...paras, ...opinions].sort((a, b) => a.ts - b.ts)
}

/** 单条发言气泡（增量装饰路径）。 */
function SpeechRow({
  entry,
  isLast,
  interim,
  deco,
  highlightTerm,
  userHighlights,
  onRename,
  onTag,
  onEdit,
  onToggleSelect,
}: {
  entry: TranscriptEntry
  isLast: boolean
  interim: string
  deco: TranscriptDecoration
  highlightTerm?: string
  userHighlights?: UserHighlight[]
  onRename?: (entryId: string, label: string) => void
  onTag?: (entryId: string, tag: TagKey) => void
  onEdit?: (entryId: string, text: string) => void
  onToggleSelect?: (entryId: string) => void
}) {
  const [openMenu, setOpenMenu] = useState<'rename' | 'tag' | 'edit' | null>(null)

  const rules: HighlightRule[] = []
  if (highlightTerm) rules.push({ term: highlightTerm, cls: 'kw-hl' })
  for (const h of userHighlights ?? []) {
    if (h.targetId === entry.id && entry.text.includes(h.text)) rules.push({ term: h.text, cls: 'user-hl' })
  }

  const text = deco.overrideText ?? entry.text
  const isOpinion = entry.type === 'opinion'

  return (
    <div
      className={`para${isLast ? ' latest' : ''}${isOpinion ? ' opinion' : ''}${deco.tags && deco.tags.length ? ' tagged' : ''}`}
      data-entry-ids={entry.id}
    >
      {deco.tags?.map((t) => (
        <span className={`tag-strip ${t}`} key={t} />
      ))}
      {deco.selectable && (
        <input
          type="checkbox"
          className="para-select"
          checked={Boolean(deco.selected)}
          onChange={() => onToggleSelect?.(entry.id)}
          aria-label="选择摘录"
        />
      )}
      {deco.dot && (
        <RoleDot isBigShot={Boolean(deco.dot.isBigShot)} color={deco.dot.color} initial={deco.dot.initial ?? ''} label={deco.dot.label} />
      )}

      <div className="para-main">
        <div className="para-speaker-row">
          {isOpinion ? (
            <span className="para-speaker" style={{ color: entry.color || 'var(--accent)' }}>
              💬 {deco.renameLabel}
            </span>
          ) : (
            <span className="para-speaker human">{deco.renameLabel}</span>
          )}
          {deco.hoverActions?.includes('rename') && (
            <button type="button" className="rename-btn" onClick={() => setOpenMenu('rename')} aria-label="重命名">
              ▾
            </button>
          )}
          <span className="para-actions">
            {deco.hoverActions?.includes('tag') && (
              <button type="button" className="tag-pen" onClick={() => setOpenMenu('tag')} aria-label="打标签">
                🏷
              </button>
            )}
            {deco.hoverActions?.includes('edit') && (
              <button type="button" className="edit-pen" onClick={() => setOpenMenu('edit')} aria-label="纠错">
                ✎
              </button>
            )}
          </span>
        </div>

        <div className="text">
          {highlightText(text, rules)}
          {deco.edited && <span className="edited-flag">已编辑</span>}
        </div>

        {isLast && entry.type === 'speech' && interim && (
          <div className="interim-hint">正在识别… {interim}</div>
        )}
      </div>

      {openMenu === 'rename' && (
        <RenamePopover
          value={deco.renameLabel ?? ''}
          onSave={(v) => {
            onRename?.(entry.id, v)
            setOpenMenu(null)
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'edit' && (
        <InlineEditor
          initial={deco.overrideText ?? entry.text}
          onSave={(v) => {
            onEdit?.(entry.id, v)
            setOpenMenu(null)
          }}
          onCancel={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'tag' && (
        <TagMenu
          current={deco.tags ?? []}
          onToggle={(t) => onTag?.(entry.id, t)}
          onClose={() => setOpenMenu(null)}
        />
      )}
    </div>
  )
}

export default function TranscriptPanel({
  entries,
  interim,
  view,
  refinedText,
  anchorEntryIds,
  anchorTs,
  decorations,
  onRename,
  onTag,
  onEdit,
  onToggleSelect,
  highlightTerm,
  userHighlights,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const showInterim = Boolean(interim && interim.trim())
  const paragraphs = useMemo(() => (decorations ? [] : buildParagraphs(entries)), [entries, decorations])
  const isEmpty = (decorations ? entries.length === 0 : paragraphs.length === 0) && !showInterim

  // 自动滚到底（新内容到达时）；定位副作用在下方独立 effect
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, interim, view, refinedText])

  // @关联 · 定位：滚动到对应段落并高亮（T5 / C-P1-2 / C-P1-3）
  useEffect(() => {
    if (!anchorEntryIds || anchorEntryIds.length === 0) return
    const root = ref.current
    if (!root) return
    const target = anchorEntryIds[0]
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.para'))
    let hit: HTMLElement | null = null
    for (const n of nodes) {
      const ids = (n.dataset.entryIds ?? '').split(' ').filter(Boolean)
      if (ids.includes(target)) {
        hit = n
        break
      }
    }
    if (!hit) return
    hit.scrollIntoView({ behavior: 'smooth', block: 'center' })
    hit.classList.add('anchor-hl')
    const t = setTimeout(() => hit && hit.classList.remove('anchor-hl'), 2200)
    return () => clearTimeout(t)
  }, [anchorEntryIds, anchorTs])

  // 增量装饰路径：逐条渲染（per-entry 气泡），默认不传 decorations 时走原聚合路径
  const sortedEntries = useMemo(
    () =>
      entries
        .slice()
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [entries],
  )

  return (
    <div className="transcript" ref={ref}>
      {isEmpty && (
        <div className="para">
          <div className="text" style={{ color: 'var(--text-3)' }}>
            （系统）虚拟私董会已就绪。点击「开始收音」用浏览器实时转写，或点击下方大咖「💬 发言」让其表态。
          </div>
        </div>
      )}

      {/* 整理版：LLM 润色后的全文作为单个段落块 */}
      {view === 'refined' && (
        <div className="para refined latest">
          <div className="text">{refinedText || '（整理版生成中…）'}</div>
        </div>
      )}

      {/* 原稿：聚合路径（无 decorations） */}
      {view === 'raw' &&
        !decorations &&
        paragraphs.map((p, i) => {
          const isLast = i === paragraphs.length - 1
          return (
            <div
              className={`para ${isLast ? 'latest' : ''} ${p.kind === 'opinion' ? 'opinion' : ''}`}
              key={p.id}
              data-entry-ids={p.entryIds.join(' ')}
            >
              {p.kind === 'opinion' && p.speaker && (
                <div className="para-speaker" style={{ color: p.color || 'var(--accent)' }}>
                  💬 {p.speaker}
                </div>
              )}
              <div className="text">
                {p.kind === 'opinion' && !p.speaker ? '💬 ' : ''}
                {p.text || '…'}
              </div>
              {isLast && p.kind === 'speech' && showInterim && (
                <div className="interim-hint">正在识别… {interim}</div>
              )}
            </div>
          )
        })}

      {/* 原稿：增量装饰路径（逐条气泡） */}
      {view === 'raw' &&
        decorations &&
        sortedEntries.map((e, i) => {
          const deco = decorations(e)
          if (!deco) return null
          return (
            <SpeechRow
              key={e.id}
              entry={e}
              isLast={i === sortedEntries.length - 1}
              interim={interim}
              deco={deco}
              highlightTerm={highlightTerm}
              userHighlights={userHighlights}
              onRename={onRename}
              onTag={onTag}
              onEdit={onEdit}
              onToggleSelect={onToggleSelect}
            />
          )
        })}

      {/* 仅有 interim、尚无任何段落时，单独展示识别中提示 */}
      {view === 'raw' && !decorations && paragraphs.length === 0 && showInterim && (
        <div className="para interim latest">
          <div className="interim-hint">正在识别… {interim}</div>
        </div>
      )}
      {view === 'raw' && decorations && entries.length === 0 && showInterim && (
        <div className="para interim latest">
          <div className="interim-hint">正在识别… {interim}</div>
        </div>
      )}
    </div>
  )
}
