// src/components/MeetingPrep.tsx —— 会议准备页（P1）：自定义标题 / 选参会大咖 / 资料上传
import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../types'
import MaterialUpload from './MaterialUpload'
import { isMaterialOversized, MAX_MATERIAL_SIZE_BYTES, formatBytes } from '../lib/limits'

interface Props {
  roles: Role[]
  onEnter: (input: { title: string; brief: string; roleIds: string[]; materials: File[] }) => void
  /** 是否正在创建会议 / 解析附件（由父级驱动，用于展示加载态与禁用按钮） */
  entering: boolean
  /** 解析失败等可读错误（由父级回填），用于醒目标示而非静默卡死 */
  enterError: string | null
}

function Avatar({ role }: { role: Role }) {
  const [err, setErr] = useState(false)
  if (role.avatar && !err) {
    return <img className="mini" src={role.avatar} alt={role.cn} onError={() => setErr(true)} />
  }
  return <div className="mini-fb" style={{ background: role.color }}>{role.initial}</div>
}

export default function MeetingPrep({ roles, onEnter, entering, enterError }: Props) {
  const [title, setTitle] = useState('AI 大咖私董会')
  const [brief, setBrief] = useState('')
  // 默认不预选任何大咖：进入会议前由用户逐个点击加入
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [materials, setMaterials] = useState<File[]>([])
  const [localError, setLocalError] = useState<string | null>(null)

  const ordered = useMemo(() => [...roles].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)), [roles])

  // 资料列表变化（增删）时清除上一次的尺寸拦截提示，避免陈旧文案停留
  useEffect(() => {
    setLocalError(null)
  }, [materials])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const enter = () => {
    if (entering) return
    // 体积硬拦截：超过上限的附件直接阻止进入会议，给出明确提示与拆分建议，
    // 避免出现「点了没反应 / 卡死」的静默体验（如 18MB PDF 触发后端重解析）。
    const oversized = materials.filter((m) => isMaterialOversized(m))
    if (oversized.length > 0) {
      const f = oversized[0]
      setLocalError(
        `附件「${f.name}」过大（${formatBytes(f.size)}），单份资料上限 ${formatBytes(MAX_MATERIAL_SIZE_BYTES)}。建议压缩或拆分为多份后重试。`,
      )
      return
    }
    setLocalError(null)
    const roleIds = ordered.filter((r) => selected.has(r.id)).map((r) => r.id)
    onEnter({ title: title.trim() || '未命名私董会', brief: brief.trim(), roleIds, materials })
  }

  const shownError = localError ?? enterError

  return (
    <div className="prep">
      <h1>AI 大咖会议私董会</h1>
      <p className="lead">把会议室变成虚拟董事会：自定义议题、上传资料、邀请大咖，进入会议后实时转写并收集董事式意见。</p>

      <div className="panel">
        <h3>① 会议标题</h3>
        <div className="field">
          <input
            className="input"
            value={title}
            placeholder="如：星河智能 · A轮战略私董会"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <h3>② 项目简报（可选，将作为大咖发言的背景）</h3>
        <div className="field">
          <textarea
            className="textarea"
            value={brief}
            placeholder="描述项目背景、当前议题、希望大咖聚焦的问题…"
            onChange={(e) => setBrief(e.target.value)}
          />
        </div>
      </div>

      <div className="panel">
        <h3>
          ③ 参会大咖 <span className="count" style={{ marginLeft: 8 }}>{selected.size} / {ordered.length}</span>
        </h3>
        <div className="role-grid">
          {ordered.map((r) => (
            <div
              key={r.id}
              className={`role-chip${selected.has(r.id) ? ' sel' : ''}`}
              style={{ ['--cardc' as any]: r.color }}
              onClick={() => toggle(r.id)}
            >
              <Avatar role={r} />
              <div style={{ textAlign: 'left', overflow: 'hidden' }}>
                <div className="rc-name">{r.cn}</div>
                <div className="rc-title">{r.title}</div>
              </div>
              {selected.has(r.id) && <span className="check">✓</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>④ 会议资料上传</h3>
        <MaterialUpload
          materials={materials}
          onAdd={(files) => setMaterials((m) => [...m, ...files])}
          onRemove={(i) => setMaterials((m) => m.filter((_, idx) => idx !== i))}
        />
      </div>

      <div className="controls" style={{ marginTop: 8 }}>
        <button className="btn primary" type="button" onClick={enter} disabled={selected.size === 0 || entering}>
          {entering ? (
            <>
              <span className="spinner" aria-hidden="true" />
              正在解析附件…
            </>
          ) : (
            '进入会议 →'
          )}
        </button>
        {selected.size === 0 && <span className="hint">请至少选择一位大咖</span>}
      </div>

      {shownError && (
        <div className="alert error" role="alert">
          <span className="alert-ico" aria-hidden="true">⚠️</span>
          <span>{shownError}</span>
        </div>
      )}
    </div>
  )
}
