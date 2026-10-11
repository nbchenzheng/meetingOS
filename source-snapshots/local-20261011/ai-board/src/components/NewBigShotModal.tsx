// src/components/NewBigShotModal.tsx —— 新建大咖弹窗（名称/头衔/关注点/头像URL/主题色）
import { useState } from 'react'
import type { Role } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (role: Partial<Role>) => void
}

const PALETTE = ['#3b82f6', '#9333ea', '#dc2626', '#16a34a', '#ea580c', '#0284c7', '#e8703a', '#059669']

export default function NewBigShotModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [focus, setFocus] = useState('')
  const [avatar, setAvatar] = useState('')
  const [color, setColor] = useState(PALETTE[0])

  const reset = () => {
    setName('')
    setTitle('')
    setFocus('')
    setAvatar('')
    setColor(PALETTE[0])
  }

  const submit = () => {
    if (!name.trim()) return
    onCreate({
      cn: name.trim(),
      title: title.trim() || '特邀嘉宾',
      focus: focus
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      avatar: avatar.trim(),
      color,
      persona: `自定义大咖「${name.trim()}」：${title.trim() || '特邀嘉宾'}。关注 ${focus || '战略与执行'}。`,
    })
    reset()
    onClose()
  }

  return (
    <div className={`overlay${open ? ' show' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>新建大咖</h3>
        <p className="tip">填写信息后，新卡将追加到下方大咖条。</p>
        <div className="field">
          <label>姓名</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：张伟" />
        </div>
        <div className="field">
          <label>头衔</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：连续创业者" />
        </div>
        <div className="field">
          <label>关注点（用逗号分隔）</label>
          <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="如：增长, 组织, 融资" />
        </div>
        <div className="field">
          <label>头像 URL（可选，留空则用首字母占位）</label>
          <input className="input" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field">
          <label>主题色</label>
          <div className="swatches">
            {PALETTE.map((c) => (
              <div
                key={c}
                className={`swatch-pick${c === color ? ' sel' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="button" onClick={submit}>
            添加大咖
          </button>
        </div>
      </div>
    </div>
  )
}
