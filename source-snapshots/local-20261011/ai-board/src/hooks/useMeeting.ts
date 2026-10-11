// src/hooks/useMeeting.ts —— 会议态：标题 / 简报 编辑（落库）、资料列表
import { useCallback, useEffect, useState } from 'react'
import type { Meeting } from '../types'
import { updateMeeting } from '../lib/api'

export function useMeeting(initial: Meeting) {
  const [title, setTitleState] = useState(initial.title)
  const [brief, setBriefState] = useState(initial.brief)
  const [meeting, setMeeting] = useState<Meeting>(initial)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMeeting(initial)
    setTitleState(initial.title)
    setBriefState(initial.brief)
  }, [initial])

  const setTitle = useCallback(
    (t: string) => {
      setTitleState(t)
      setSaving(true)
      updateMeeting(meeting.id, { title: t })
        .then((m) => setMeeting(m))
        .finally(() => setSaving(false))
    },
    [meeting.id],
  )

  const setBrief = useCallback(
    (b: string) => {
      setBriefState(b)
      setSaving(true)
      updateMeeting(meeting.id, { brief: b })
        .then((m) => setMeeting(m))
        .finally(() => setSaving(false))
    },
    [meeting.id],
  )

  return { title, brief, setTitle, setBrief, materials: meeting.materials, saving }
}
