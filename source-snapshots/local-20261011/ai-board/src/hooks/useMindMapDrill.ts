// src/hooks/useMindMapDrill.ts —— 思维导图节点 DOM 事件委托（不改 MindMap），叶子节点点击下钻
import { useEffect } from 'react'
import type { MindMapNode } from '../types'

function findNodeByTitle(root: MindMapNode | null, title: string): MindMapNode | null {
  if (!root) return null
  const stack: MindMapNode[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.title === title) return n
    for (const c of n.children ?? []) stack.push(c)
  }
  return null
}

/**
 * 在容器上对 .mm-row 做事件委托：仅叶子节点（无 children）点击触发 onNodeClick，
 * 避免与 MindMap 自身的父节点展开/折叠冲突。
 */
export function useMindMapDrill(
  containerRef: React.RefObject<HTMLElement | null>,
  root: MindMapNode | null,
  onNodeClick: (node: MindMapNode) => void,
) {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest('.mm-row') as HTMLElement | null
      if (!row) return
      const titleEl = row.querySelector('.mm-title')
      const title = (titleEl?.textContent ?? '').trim()
      if (!title) return
      const node = findNodeByTitle(root, title)
      if (node && (!node.children || node.children.length === 0)) onNodeClick(node)
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [containerRef, root, onNodeClick])
}
