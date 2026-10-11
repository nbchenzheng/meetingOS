// src/components/SearchBar.tsx —— 全局搜索框（topbar 中部）+ 结果面板 + ⌘K 聚焦
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SearchResult } from '../types'

interface Props {
  value: string
  onChange: (v: string) => void
  results: SearchResult[]
  activeIdx: number
  onSelect: (r: SearchResult, idx: number) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

const KIND_ICON: Record<SearchResult['kind'], string> = {
  entry: '💬',
  'minutes-paragraph': '📝',
  'mindmap-node': '🧠',
  commentary: '💡',
}

export default function SearchBar({ value, onChange, results, activeIdx, onSelect, onPrev, onNext, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onClose()
      inputRef.current?.blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      onNext()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onPrev()
    } else if (e.key === 'Enter') {
      const i = activeIdx < results.length ? activeIdx : 0
      if (results[i]) onSelect(results[i], i)
    }
  }

  return (
    <div className="search-bar">
      <span className="search-ico">🔍</span>
      <input
        ref={inputRef}
        className="search-input"
        value={value}
        placeholder="搜索发言 / 纪要 / 导图…  (⌘K)"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value && <span className="search-count">{results.length}</span>}
      {value && (
        <button className="search-x" type="button" onClick={() => onChange('')} aria-label="清空">
          ×
        </button>
      )}
      {value && results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.targetId}-${i}`}
              type="button"
              className={`search-result${i === activeIdx ? ' active' : ''}`}
              onMouseEnter={() => onSelect(r, i)}
              onClick={() => onSelect(r, i)}
            >
              <span className="sr-ico">{KIND_ICON[r.kind]}</span>
              <span className="sr-body">
                <span className="sr-label">{r.label}</span>
                <span className="sr-snip">{r.snippet}</span>
              </span>
            </button>
          ))}
          <div className="search-foot">↑/↓ 选择 · Enter 跳转 · Esc 关闭</div>
        </div>
      )}
      {value && results.length === 0 && (
        <div className="search-results">
          <div className="search-empty">无匹配结果</div>
        </div>
      )}
    </div>
  )
}
