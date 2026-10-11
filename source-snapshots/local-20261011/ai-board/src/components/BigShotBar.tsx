// src/components/BigShotBar.tsx —— 下半区大咖条容器（含「+ 新建大咖」卡）
import type { Role } from '../types'
import BigShotCard from './BigShotCard'

interface Props {
  roles: Role[]
  speaking: Record<string, boolean>
  onSpeak: (roleId: string) => void
  onNew: () => void
}

export default function BigShotBar({ roles, speaking, onSpeak, onNew }: Props) {
  const ordered = [...roles].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  return (
    <section className="board">
      <div className="board-head">
        <h2>大咖意见反馈</h2>
        <span className="count">{ordered.length} 位</span>
        <span className="sub">点击「💬 发言」让大咖实时表态（自动发言开关在上方）</span>
      </div>
      <div className="cards">
        {ordered.map((r) => (
          <BigShotCard
            key={r.id}
            role={r}
            speaking={Boolean(speaking[r.id])}
            onSpeak={onSpeak}
          />
        ))}
        <div className="card new" onClick={onNew}>
          <div className="plus">+</div>
          <div className="nt">新建大咖</div>
        </div>
      </div>
    </section>
  )
}
