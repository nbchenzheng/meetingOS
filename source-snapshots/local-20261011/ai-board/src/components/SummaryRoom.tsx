// src/components/SummaryRoom.tsx —— 总结阶段容器
//
// 挂载 SummaryPanel（六要素展示）+ EmailConfirmDialog（两步确认发信）；
// 驱动 useSummary 状态机，并在顶部状态条展示 S 态。
// 挂载时重新拉取会议（含后端累积的 transcript），保证总结基于真实转录。
import { useEffect, useState } from 'react'
import type { Meeting } from '../types'
import type { SummaryState } from '../hooks/useSummary'
import { getMeeting } from '../lib/api'
import { useSummary } from '../hooks/useSummary'
import SummaryPanel from './SummaryPanel'
import EmailConfirmDialog from './EmailConfirmDialog'

interface Props {
  meeting: Meeting
  onBack: () => void
}

const STATE_TEXT: Record<SummaryState, string> = {
  S0: '已生成会议总结',
  S1: '总结生成中…',
  S2: '待确认发送邮件',
  S3: '邮件发送中…',
  S4: '邮件已发送',
  S5: '已取消发送',
  S6: '出现错误',
}

export default function SummaryRoom({ meeting, onBack }: Props) {
  // 拉取带 transcript 的最新会议（前端 entries 不回流到 App.meeting）
  const [liveMeeting, setLiveMeeting] = useState<Meeting>(meeting)
  useEffect(() => {
    let alive = true
    getMeeting(meeting.id)
      .then((m) => {
        if (alive) setLiveMeeting(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [meeting.id])

  const s = useSummary({ meeting: liveMeeting })

  const bannerClass = (() => {
    switch (s.state) {
      case 'S1':
      case 'S3':
        return 'summary-banner info'
      case 'S4':
        return 'summary-banner ok'
      case 'S5':
        return 'summary-banner warn'
      case 'S6':
        return s.degraded ? 'summary-banner warn' : 'summary-banner error'
      default:
        return 'summary-banner'
    }
  })()

  return (
    <div className="app-shell summary-room">
      <div className="topbar">
        <button className="btn ghost" type="button" onClick={onBack} style={{ padding: '8px 14px' }}>
          ← 会议
        </button>
        <div className="summary-room-title">{s.summary?.subject ?? meeting.title}</div>
      </div>

      <div className={bannerClass}>
        <span className="sb-dot" />
        <span className="sb-text">{STATE_TEXT[s.state]}</span>
        {s.error && <span className="sb-error">{s.error}</span>}
      </div>

      <div className="summary-body">
        <SummaryPanel
          summary={s.summary}
          generating={s.state === 'S1'}
          cached={s.cached}
          onCopy={s.copy}
          onDownload={s.download}
          onRegenerate={s.generate}
        />
        <EmailConfirmDialog
          state={s.state}
          preview={s.preview}
          error={s.error}
          degraded={s.degraded}
          onSend={s.send}
          onConfirm={s.confirm}
          onCancel={s.cancel}
        />
      </div>
    </div>
  )
}
