// src/hooks/useKeywordHighlight.ts —— 对容器（思维导图）做 DOM 关键词高亮装饰（不改 MindMap）
import { useEffect } from 'react'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在容器内对所有 .mm-title 文本节点包裹 <mark class="kw-hl">。
 * 每次 term 变化先还原已有 mark 再重新装饰，避免重复嵌套。
 */
export function useKeywordHighlight(containerRef: React.RefObject<HTMLElement | null>, term: string) {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // 还原上一次高亮
    el.querySelectorAll('mark.kw-hl').forEach((m) => {
      const parent = m.parentNode
      if (parent) parent.replaceChild(document.createTextNode(m.textContent ?? ''), m)
    })
    el.normalize()

    const q = term.trim()
    if (!q) return

    const re = new RegExp(`(${escapeRegExp(q)})`, 'gi')
    const decorate = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ''
        if (!text || !re.test(text)) return
        re.lastIndex = 0
        const frag = document.createDocumentFragment()
        let last = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
          const mark = document.createElement('mark')
          mark.className = 'kw-hl'
          mark.textContent = m[0]
          frag.appendChild(mark)
          last = m.index + m[0].length
          if (m[0].length === 0) re.lastIndex++
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
        node.parentNode?.replaceChild(frag, node)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el2 = node as HTMLElement
        if (el2.tagName === 'MARK') return
        Array.from(el2.childNodes).forEach(decorate)
      }
    }

    el.querySelectorAll('.mm-title').forEach((t) => decorate(t))
  }, [containerRef, term])
}
