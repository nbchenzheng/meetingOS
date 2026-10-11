// src/components/EmailConfirmDialog.tsx —— 邮箱输入 + 两步确认弹窗 + 错误/降级提示
//
// 两步确认：先输入邮箱点「发送」(send) → 后端返回 confirmationRef + preview →
// 弹确认框展示收件人与内容摘要 → 用户「确认」(confirm) / 「取消」(cancel)。
// ctk 安全：前端仅经 useSummary 持有 confirmationRef，绝不直接接触 ctk。
// 降级：T2 未实现时 sendSummary 返回 NOT_IMPLEMENTED，确认阶段进入 S6 并可读提示，不白屏。
import { useState } from 'react'
import type { SendPreview } from '../types'
import type { SummaryState } from '../hooks/useSummary'
import { formatBytes } from '../lib/limits'
import { validateEmail } from '../lib/email'

interface Props {
  state: SummaryState
  preview: SendPreview | null
  error: string | null
  degraded: boolean
  onSend: (email: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export default function EmailConfirmDialog({ state, preview, error, degraded, onSend, onConfirm, onCancel }: Props) {
  const [email, setEmail] = useState('')
  const valid = validateEmail(email)
  const sending = state === 'S3'
  const success = state === 'S4'
  const showConfirm = state === 'S2' && preview != null

  return (
    <div className="email-wrap">
      <label className="email-label" htmlFor="email-input">
        发送会议总结到邮箱
      </label>
      <div className="email-row">
        <input
          id="email-input"
          className="input email-input"
          type="email"
          placeholder="boss@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={sending}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!valid || sending}
          onClick={() => onSend(email)}
        >
          {sending ? '处理中…' : '发送'}
        </button>
      </div>

      {/* 错误/降级提示：degraded 用 warn 色（功能降级但可用），其余错误用 error 色 */}
      {degraded && error && <div className="alert warn email-note">{error}</div>}
      {!degraded && error && state === 'S6' && <div className="alert error email-note">{error}</div>}
      {success && <div className="email-ok">✓ 邮件已发送（演示）</div>}

      {/* 两步确认弹窗：展示收件人与内容摘要，确认/取消 */}
      {showConfirm && (
        <div className="overlay show">
          <div className="modal email-confirm">
            <h3>确认发送会议总结</h3>
            <p className="tip">请确认收件人与内容摘要，确认后将发送邮件。</p>
            <div className="email-preview">
              <div>
                <b>收件人：</b>
                {preview!.email}
              </div>
              <div>
                <b>主题：</b>
                {preview!.subject}
              </div>
              <div>
                <b>要素数：</b>
                {preview!.elementCount}
              </div>
              <div>
                <b>附件：</b>
                {preview!.hasAttachment ? '逐字稿附件' : '无'}
              </div>
              <div>
                <b>预估大小：</b>
                {formatBytes(preview!.sizeHintBytes)}
              </div>
            </div>
            {degraded && error && <div className="alert warn email-note">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={onCancel} disabled={sending}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={onConfirm} disabled={sending}>
                {sending ? '发送中…' : '确认发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
