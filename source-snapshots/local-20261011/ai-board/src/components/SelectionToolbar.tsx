// src/components/SelectionToolbar.tsx —— 划词工具条（高亮 / 评论 / 引用）
interface Props {
  x: number
  y: number
  onHighlight: () => void
  onComment: () => void
  onQuote: () => void
  onClose: () => void
}

export default function SelectionToolbar({ x, y, onHighlight, onComment, onQuote, onClose }: Props) {
  return (
    <div className="sel-toolbar" style={{ left: x, top: y }} onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className="sel-btn" onClick={onHighlight}>
        高亮
      </button>
      <button type="button" className="sel-btn" onClick={onComment}>
        评论
      </button>
      <button type="button" className="sel-btn" onClick={onQuote}>
        引用
      </button>
      <button type="button" className="sel-btn close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  )
}
