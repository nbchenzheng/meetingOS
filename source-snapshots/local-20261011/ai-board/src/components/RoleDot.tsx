// src/components/RoleDot.tsx —— 角色配色圆点（真人灰标+首字母 / 大咖AI 渐变）
interface Props {
  isBigShot: boolean
  color?: string
  initial: string
  label?: string
}

export default function RoleDot({ isBigShot, color, initial, label }: Props) {
  if (isBigShot) {
    return (
      <span className="role-dot bigshot" title={label ?? '大咖AI'} aria-hidden>
        {initial}
      </span>
    )
  }
  return (
    <span
      className="role-dot human"
      style={{ background: color ?? 'var(--text-3)' }}
      title={label ?? '发言人'}
      aria-hidden
    >
      {initial}
    </span>
  )
}
