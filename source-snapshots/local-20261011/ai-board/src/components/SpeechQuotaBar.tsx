// src/components/SpeechQuotaBar.tsx —— 发言占比条（前端算，点击筛选/跳转角色）
import { useMemo } from 'react'
import type { Role, TranscriptEntry } from '../types'
import { HUMAN_KEY, resolveSpeaker } from '../lib/speaker'

interface Props {
  entries: TranscriptEntry[]
  roles: Role[]
  roleLabels: Record<string, string>
  activeRoleFilter: string | null
  onSelect: (key: string | null) => void
}

interface Seg {
  key: string
  label: string
  isBigShot: boolean
  color: string
  seconds: number
}

export default function SpeechQuotaBar({ entries, roles, roleLabels, activeRoleFilter, onSelect }: Props) {
  const segments = useMemo<Seg[]>(() => {
    const sorted = [...entries].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    const map = new Map<string, Seg>()
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]
      const key = e.type === 'opinion' ? e.roleId ?? '' : HUMAN_KEY
      if (!key) continue
      const sp = resolveSpeaker(e, roleLabels, roles)
      const dur =
        i < sorted.length - 1
          ? Math.max(0, Math.min(600, (new Date(sorted[i + 1].ts).getTime() - new Date(e.ts).getTime()) / 1000))
          : 0
      const cur = map.get(key) ?? { key, label: sp.label, isBigShot: sp.isBigShot, color: sp.color, seconds: 0 }
      cur.seconds += dur
      map.set(key, cur)
    }
    const arr = Array.from(map.values()).filter((s) => s.seconds > 0)
    arr.sort((a, b) => b.seconds - a.seconds)
    return arr
  }, [entries, roles, roleLabels])

  const total = segments.reduce((s, x) => s + x.seconds, 0) || 1
  if (segments.length === 0) return null

  return (
    <div className="quota-bar" title="发言占比（按角色）">
      <div className="quota-track">
        {segments.map((s) => (
          <div
            key={s.key}
            className={`quota-seg${activeRoleFilter === s.key ? ' active' : ''}`}
            style={{
              width: `${(s.seconds / total) * 100}%`,
              background: s.isBigShot ? 'var(--bigshot-gradient)' : s.color,
            }}
            title={`${s.label} ${Math.round((s.seconds / total) * 100)}%`}
            onClick={() => onSelect(activeRoleFilter === s.key ? null : s.key)}
          />
        ))}
      </div>
      <div className="quota-legend">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`quota-legend-item${activeRoleFilter === s.key ? ' active' : ''}`}
            onClick={() => onSelect(activeRoleFilter === s.key ? null : s.key)}
          >
            <span className="quota-dot" style={{ background: s.isBigShot ? 'var(--bigshot-gradient)' : s.color }} />
            <span className="quota-name">{s.label}</span>
            <span className="quota-pct">{Math.round((s.seconds / total) * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  )
}
