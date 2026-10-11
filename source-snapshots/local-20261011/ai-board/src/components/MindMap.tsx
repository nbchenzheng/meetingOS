// src/components/MindMap.tsx —— 思维导图（自研轻量递归树 + 折叠，零新增依赖）
import { useState } from 'react'
import type { MindMapNode } from '../types'

function MindMapNodeView({ node, depth }: { node: MindMapNode; depth: number }) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  // 默认展开前两层（depth 0、1），深层默认折叠，避免一次性展开过宽
  const [open, setOpen] = useState(depth < 2)
  const safeDepth = Math.min(depth, 3) // data-depth 限制 0..3（设计 §7）

  return (
    <div className={`mm-node${open ? '' : ' collapsed'}`} data-depth={safeDepth}>
      <div
        className="mm-row"
        onClick={() => hasChildren && setOpen((o) => !o)}
        role={hasChildren ? 'button' : undefined}
      >
        {hasChildren ? (
          <span className={`mm-caret${open ? ' open' : ''}`}>▸</span>
        ) : (
          <span className="mm-caret empty" />
        )}
        <span className="mm-title">{node.title}</span>
      </div>
      {hasChildren && open && (
        <div className="mm-children">
          {node.children!.map((child, i) => (
            <MindMapNodeView key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function MindMap({ root }: { root: MindMapNode | null }) {
  if (!root) {
    return <div className="mindmap empty">（暂无思维导图，会议进行数分钟后将自动生成）</div>
  }
  return (
    <div className="mindmap">
      <MindMapNodeView node={root} depth={0} />
    </div>
  )
}
