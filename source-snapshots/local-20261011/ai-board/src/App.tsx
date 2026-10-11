import { useCallback, useEffect, useState } from 'react'
import type { Meeting, Role } from './types'
import { listRoles, createMeeting, uploadMaterial } from './lib/api'
import MeetingPrep from './components/MeetingPrep'
import BoardRoom from './components/BoardRoom'
import SummaryRoom from './components/SummaryRoom'

export default function App() {
  const [roles, setRoles] = useState<Role[]>([])
  const [phase, setPhase] = useState<'prep' | 'board' | 'summary'>('prep')
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  // 进入会议流程中的加载态与可读错误（避免「点了没反应 / 卡死」）
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<string | null>(null)

  useEffect(() => {
    listRoles()
      .then(setRoles)
      .catch(() => setRoles([]))
      .finally(() => setLoading(false))
  }, [])

  const handleEnter = useCallback(
    async (input: { title: string; brief: string; roleIds: string[]; materials: File[] }) => {
      setEntering(true)
      setEnterError(null)
      try {
        const created = await createMeeting({ title: input.title, brief: input.brief, roleIds: input.roleIds })
        // 顺序解析每个附件；任一附件失败都收集为可读错误，而不是静默吞掉
        const failures: string[] = []
        for (const file of input.materials) {
          try {
            await uploadMaterial(created.id, file)
          } catch (err) {
            failures.push(`「${file.name}」：${err instanceof Error ? err.message : '解析失败'}`)
          }
        }
        if (failures.length > 0) {
          // 资料解析失败：明确提示并停留在准备页，让用户在移除问题附件后重试
          setEnterError(`部分资料解析失败：${failures.join('；')}。会议已创建，可移除问题附件后重新进入。`)
          return
        }
        const full = await fetch(`/api/meetings/${created.id}`).then((r) => r.json())
        setMeeting(full.meeting ?? created)
        setPhase('board')
      } catch (err) {
        setEnterError(err instanceof Error ? err.message : '进入会议失败，请稍后重试')
      } finally {
        setEntering(false)
      }
    },
    [],
  )

  const handleAddCustomRole = useCallback((role: Role) => {
    setRoles((rs) => [...rs, role])
    setMeeting((m) => (m ? { ...m, roleIds: [...m.roleIds, role.id] } : m))
  }, [])

  const handleBack = useCallback(() => {
    setPhase('prep')
  }, [])

  // 结束会议 → 进入总结态
  const handleEnd = useCallback(() => {
    setPhase('summary')
  }, [])

  // 从总结态返回会议（继续讨论 / 重新结束）
  const handleBackToBoard = useCallback(() => {
    setPhase('board')
  }, [])

  if (loading) return <div className="loading">加载中…</div>
  if (phase === 'board' && meeting) {
    return (
      <BoardRoom
        meeting={meeting}
        roles={roles}
        onBack={handleBack}
        onAddCustomRole={handleAddCustomRole}
        onEnd={handleEnd}
      />
    )
  }
  if (phase === 'summary' && meeting) {
    return <SummaryRoom meeting={meeting} onBack={handleBackToBoard} />
  }
  return <MeetingPrep roles={roles} onEnter={handleEnter} entering={entering} enterError={enterError} />
}
