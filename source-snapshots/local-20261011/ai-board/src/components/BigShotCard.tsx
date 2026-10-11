// src/components/BigShotCard.tsx —— 单张大咖卡（头像/姓名头衔/状态/💬发言）
import { useState } from 'react'
import type { Role } from '../types'

interface Props {
  role: Role
  speaking: boolean
  onSpeak: (roleId: string) => void
}

export default function BigShotCard({ role, speaking, onSpeak }: Props) {
  const [err, setErr] = useState(false)
  return (
    <div className={`card${speaking ? ' speaking' : ''}`} style={{ ['--cardc' as any]: role.color }}>
      <div className="avatar-ring">
        {role.avatar && !err ? (
          <img className="avatar" src={role.avatar} alt={role.cn} onError={() => setErr(true)} />
        ) : (
          <div className="avatar-fallback">{role.initial}</div>
        )}
      </div>
      <div className="name">{role.cn}</div>
      <div className="title">{role.title}</div>
      <div className="status">{speaking ? '正在发言' : '旁听中'}</div>
      <button
        className={`speak-btn${speaking ? ' active' : ''}`}
        type="button"
        onClick={() => onSpeak(role.id)}
        disabled={speaking}
      >
        💬 发言
      </button>
    </div>
  )
}
