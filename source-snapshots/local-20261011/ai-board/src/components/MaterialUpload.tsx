// src/components/MaterialUpload.tsx —— 会议资料上传入口（.txt/.md/.pdf/.docx）
import { useRef } from 'react'
import { isMaterialOversized, isMaterialLarge, MAX_MATERIAL_SIZE_BYTES, formatBytes } from '../lib/limits'

interface Props {
  materials: File[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
}

const ACCEPT = '.txt,.md,.pdf,.docx'

export default function MaterialUpload({ materials, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onAdd(files)
          e.target.value = ''
        }}
      />
      <button className="btn ghost" type="button" onClick={() => inputRef.current?.click()}>
        📎 选择资料文件
      </button>
      <span className="hint" style={{ marginLeft: 10 }}>
        支持 .txt / .md / .pdf / .docx（单份 ≤ {formatBytes(MAX_MATERIAL_SIZE_BYTES)}）
      </span>

      {materials.length > 0 && (
        <div className="mat-list">
          {materials.map((f, i) => {
            const oversized = isMaterialOversized(f)
            const large = !oversized && isMaterialLarge(f)
            return (
              <div
                className={`mat-item${oversized ? ' oversize' : large ? ' warn' : ''}`}
                key={`${f.name}_${i}`}
              >
                <span>📄</span>
                <span className="mi-name">{f.name}</span>
                {oversized && (
                  <span className="mi-flag err">超 {formatBytes(MAX_MATERIAL_SIZE_BYTES)} 上限</span>
                )}
                {large && <span className="mi-flag warn">较大 · 解析偏慢</span>}
                <span className="mi-meta">{formatBytes(f.size)}</span>
                <button
                  className="btn ghost"
                  style={{ padding: '4px 10px', marginLeft: 8 }}
                  type="button"
                  onClick={() => onRemove(i)}
                >
                  移除
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
