// src/components/TagMenu.tsx —— 单条 hover 弹出的标签菜单（写 entryTags）
import type { TagKey } from '../types'

const TAGS: { key: TagKey; label: string; cls: string }[] = [
  { key: 'conclusion', label: '结论', cls: 'conclusion' },
  { key: 'todo', label: '待办', cls: 'todo' },
  { key: 'question', label: '疑问', cls: 'question' },
  { key: 'highlight', label: '重点', cls: 'highlight' },
]

interface Props {
  current: TagKey[]
  onToggle: (t: TagKey) => void
  onClose: () => void
}

export default function TagMenu({ current, onToggle, onClose }: Props) {
  return (
    <div className="tag-menu" onMouseLeave={onClose}>
      {TAGS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`tag-pill ${t.cls}${current.includes(t.key) ? ' on' : ''}`}
          onClick={() => onToggle(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
