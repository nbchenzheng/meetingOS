// src/components/BriefPill.tsx —— 顶部可折叠「会议标题 / 项目简报」胶囊
import { useEffect, useState } from 'react'

interface Props {
  title: string
  brief: string
  onTitle: (t: string) => void
  onBrief: (b: string) => void
}

export default function BriefPill({ title, brief, onTitle, onBrief }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.classList.toggle('brief-open', open)
    return () => document.body.classList.remove('brief-open')
  }, [open])

  return (
    <>
      <div className="session-pill" onClick={() => setOpen((o) => !o)} title="点击展开/收起项目简报">
        <span className="title">{title || '未命名私董会'}</span>
        <span className="live">LIVE</span>
        <span className="chev">▾</span>
      </div>
      <div className="brief">
        <div className="brief-inner">
          <b>会议标题：</b>
          <input
            className="input"
            style={{ marginTop: 6 }}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="会议标题"
          />
          <b style={{ display: 'block', marginTop: 12 }}>项目简报：</b>
          <textarea
            className="textarea"
            value={brief}
            onChange={(e) => onBrief(e.target.value)}
            placeholder="项目背景、当前议题、希望大咖聚焦的问题…"
          />
        </div>
      </div>
    </>
  )
}
