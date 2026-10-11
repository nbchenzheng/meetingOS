// src/components/InlineEditor.tsx —— 行内纠错覆盖层（写 entryEdits，保留原 ts）
import { useEffect, useRef, useState } from 'react'

interface Props {
  initial: string
  onSave: (v: string) => void
  onCancel: () => void
}

export default function InlineEditor({ initial, onSave, onCancel }: Props) {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onCancel])

  return (
    <div className="edit-pop" ref={ref}>
      <textarea
        className="textarea"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(v)
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="edit-actions">
        <button className="btn ghost" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="btn primary" type="button" onClick={() => onSave(v)}>
          保存
        </button>
      </div>
    </div>
  )
}
