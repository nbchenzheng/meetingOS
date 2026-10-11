// src/components/TagFilterBar.tsx —— 发言区顶部筛选 Tab（全部 / 结论 / 待办 / 疑问 / 重点）
import type { TagFilter } from '../hooks/useBoardEnhancements'

const TABS: { key: TagFilter; label: string; cls: string }[] = [
  { key: 'all', label: '全部', cls: 'all' },
  { key: 'conclusion', label: '结论', cls: 'conclusion' },
  { key: 'todo', label: '待办', cls: 'todo' },
  { key: 'question', label: '疑问', cls: 'question' },
  { key: 'highlight', label: '重点', cls: 'highlight' },
]

interface Props {
  active: TagFilter
  counts: Record<TagFilter, number>
  onChange: (t: TagFilter) => void
}

export default function TagFilterBar({ active, counts, onChange }: Props) {
  return (
    <div className="tag-bar" role="tablist" aria-label="标签筛选">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`tag-tab ${t.cls}${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(active === t.key ? 'all' : t.key)}
        >
          {t.label}
          <span className="tag-count">{counts[t.key] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}
