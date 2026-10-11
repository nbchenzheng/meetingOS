// src/lib/speaker.ts —— 角色/说话人解析（复用：发言区圆点 / 纪要来源 / 占比条 / 搜索）
import type { Role, TranscriptEntry } from '../types'

/** 真人（麦克风）发言的统一标识 key（重命名也以它为 key）。 */
export const HUMAN_KEY = '__human__'

export interface SpeakerInfo {
  label: string
  isBigShot: boolean
  initial: string
  color: string
}

/**
 * 解析单条发言的说话人信息。
 * - opinion（大咖AI）：用 roleLabels[roleId] ?? role.cn，固定 isBigShot=true；
 * - speech（真人麦克风）：用 roleLabels[HUMAN_KEY] ?? '麦克风'。
 */
export function resolveSpeaker(
  entry: TranscriptEntry,
  roleLabels: Record<string, string>,
  roles: Role[],
): SpeakerInfo {
  if (entry.type === 'opinion') {
    const roleId = entry.roleId ?? ''
    const role = roles.find((r) => r.id === roleId)
    const label = roleLabels[roleId] ?? role?.cn ?? entry.speaker ?? '大咖AI'
    const initial = label.charAt(0) || '星'
    return { label, isBigShot: true, initial, color: role?.color ?? '#3b82f6' }
  }
  const label = roleLabels[HUMAN_KEY] ?? '麦克风'
  const initial = label.charAt(0) || '麦'
  return { label, isBigShot: false, initial, color: 'var(--text-3)' }
}
