// src/components/SummaryPanel.tsx —— 六要素可折叠展示 + 大咖观点表 + 复制/下载
import { useState } from 'react'
import type { SummaryElement, SummaryResult } from '../types'

interface Props {
  summary: SummaryResult | null
  /** 是否生成中（S1）。 */
  generating: boolean
  /** 结果是否来自缓存。 */
  cached: boolean
  onCopy: () => void
  onDownload: () => void
  onRegenerate: () => void
}

// 单个要素的折叠卡片：默认遵循 LLM 返回的 collapsed（v1 默认 false=展开）
function ElementView({ el }: { el: SummaryElement }) {
  const [open, setOpen] = useState(!el.collapsed)
  return (
    <div className={`sum-el${open ? '' : ' collapsed'}`}>
      <button className="sum-el-head" type="button" onClick={() => setOpen((o) => !o)}>
        <span className={`sum-caret${open ? ' open' : ''}`}>▸</span>
        <span className="sum-el-title">{el.title}</span>
      </button>
      {open && <div className="sum-el-body">{el.content || '（无内容）'}</div>}
    </div>
  )
}

function formatTime(ts: string): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString('zh-CN', { hour12: false })
}

export default function SummaryPanel({ summary, generating, cached, onCopy, onDownload, onRegenerate }: Props) {
  return (
    <div className="summary-panel">
      <div className="summary-panel-head">
        <div className="summary-panel-title">
          <span className="sp-name">{summary?.subject ?? '会议总结'}</span>
          {summary && <span className="sp-time">会议时间：{formatTime(summary.occurredAt)}</span>}
          {cached && <span className="badge">缓存</span>}
        </div>
        <div className="summary-actions">
          {!summary && (
            <button type="button" className="btn primary" onClick={onRegenerate} disabled={generating}>
              {generating ? '生成中…' : '获取总结报告'}
            </button>
          )}
          {summary && (
            <>
              <button type="button" className="btn" onClick={onRegenerate} disabled={generating}>
                {generating ? '生成中…' : '重新生成'}
              </button>
              <button type="button" className="btn" onClick={onCopy} disabled={generating}>
                复制
              </button>
              <button type="button" className="btn" onClick={onDownload} disabled={generating}>
                下载
              </button>
            </>
          )}
        </div>
      </div>

      {!summary ? (
        <div className="summary-empty">
          {generating ? '正在生成会议总结…' : '点击「获取总结报告」生成六要素会议总结。'}
        </div>
      ) : (
        <div className="summary-scroll">
          <div className="sum-els">
            {summary.elements.map((el) => (
              <ElementView key={el.key} el={el} />
            ))}
          </div>
          {summary.bigShots.length > 0 && (
            <div className="sum-bigshots">
              <div className="sum-section-title">各预设大咖核心观点</div>
              <table className="sum-bs-table">
                <thead>
                  <tr>
                    <th>大咖</th>
                    <th>头衔</th>
                    <th>核心观点</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bigShots.map((b) => (
                    <tr key={b.roleId || b.cn}>
                      <td className="bs-name">{b.cn}</td>
                      <td className="bs-title">{b.title}</td>
                      <td className="bs-view">{b.viewpoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
