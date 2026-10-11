// src/components/RenamePopover.tsx —— 会话级重命名浮层（仅改前端 roleLabels）
import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onSave: (v: string) => void
  onClose: () => void
}

export default function RenamePopover({ value, onSave, onClose }: Props) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  const save = () => onSave(v.trim() || value)

  return (
    <div className="rename-pop" ref={ref}>
      <input
        className="input"
        autoFocus
        value={v}
        placeholder="重命名"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') onClose()
        }}
      />
      <button className="btn primary" type="button" onClick={save}>
        保存
      </button>
    </div>
  )
}
