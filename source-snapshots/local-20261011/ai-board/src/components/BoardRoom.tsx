// src/components/BoardRoom.tsx —— 双标签容器（发言区 / 智能纪要）+ 增量增强层
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Commentary, Meeting, MindMapNode, Role, SearchResult } from '../types'
import { useMeeting } from '../hooks/useMeeting'
import { useBoard } from '../hooks/useBoard'
import { useTranscriptEnhance } from '../hooks/useTranscriptEnhance'
import { useLiveCommentary } from '../hooks/useLiveCommentary'
import { useBoardEnhancements } from '../hooks/useBoardEnhancements'
import { useMindMapDrill } from '../hooks/useMindMapDrill'
import { useKeywordHighlight } from '../hooks/useKeywordHighlight'
import { addRole } from '../lib/api'
import { HUMAN_KEY } from '../lib/speaker'
import { uid } from '../lib/uid'
import BriefPill from './BriefPill'
import MicControls from './MicControls'
import TranscriptPanel from './TranscriptPanel'
import MindMap from './MindMap'
import BigShotBar from './BigShotBar'
import NewBigShotModal from './NewBigShotModal'
import CommentaryPanel from './CommentaryPanel'
import SearchBar from './SearchBar'
import StructuredMinutes from './StructuredMinutes'
import TagFilterBar from './TagFilterBar'
import SpeechQuotaBar from './SpeechQuotaBar'
import ExportMenu from './ExportMenu'
import SelectionToolbar from './SelectionToolbar'
import ExcerptCard from './ExcerptCard'
import MindMapDrill from './MindMapDrill'

interface Props {
  meeting: Meeting
  roles: Role[]
  onBack: () => void
  onAddCustomRole: (role: Role) => void
  /** 结束会议：进入总结态（结束即停收音）。 */
  onEnd: () => void
}

/** 时间戳格式化为 HH:MM（状态条展示）。 */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

interface SelState {
  x: number
  y: number
  text: string
  scope: 'entry' | 'minutes'
  targetId: string
}

export default function BoardRoom({ meeting, roles, onBack, onAddCustomRole, onEnd }: Props) {
  const { title, brief, setTitle, setBrief } = useMeeting(meeting)
  const {
    roles: liveRoles,
    entries,
    speaking,
    interim,
    listening,
    volumeRef,
    auto,
    setAuto,
    asrMode,
    setAsrMode,
    toggleListen,
    requestSpeak,
    error,
    commentaries,
    commentaryEnabled,
    setCommentaryEnabled,
  } = useBoard(meeting, roles)

  // 转录增强：仅在「收音进行中」启动定时器（实时转录才产生新内容）；卸载/停止时自动清理
  const enhance = useTranscriptEnhance({ entries, active: listening, meetingId: meeting.id, meetingTitle: title })
  const {
    refinedText,
    mindmap,
    structuredRefined,
    keywords,
    refining,
    mindmapping,
    lastRefineAt,
    lastMindmapAt,
    refineError,
    mindmapError,
  } = enhance

  const enh = useBoardEnhancements({
    entries,
    roles,
    structuredRefined,
    mindmap,
    commentaries,
  })

  // 会中实时点评（前端 LLM 轻量点评驱动）：定时 150s + 话题补采
  const mindmapTopBranches = useMemo(
    () => (mindmap?.children ?? []).map((c) => (c?.title ?? '')).filter(Boolean),
    [mindmap],
  )
  const live = useLiveCommentary({
    meetingId: meeting.id,
    entries,
    enabled: commentaryEnabled,
    listening,
    meetingTitle: title,
    topTopics: mindmapTopBranches,
  })

  // 话题切换补采：监听思维导图顶层分支变化，变化时触发一次话题补采（60s 冷却在 tick 内判定）
  const prevBranchKeyRef = useRef('')
  const topicBoostRef = useRef(live.topicBoost)
  topicBoostRef.current = live.topicBoost
  useEffect(() => {
    const key = [...mindmapTopBranches].sort().join('|')
    if (prevBranchKeyRef.current && prevBranchKeyRef.current !== key) topicBoostRef.current()
    prevBranchKeyRef.current = key
  }, [mindmapTopBranches])

  // 合并后端 big-shot 主动点评（WS 推送）与前端 llm 轻量点评 + 划词用户点评，最新在上
  const allCommentaries = useMemo<Commentary[]>(
    () =>
      [...commentaries, ...live.commentaries, ...enh.userCommentaries]
        .slice()
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [commentaries, live.commentaries, enh.userCommentaries],
  )

  // 时间轴联动：点卡片「定位」滚动并高亮对应转录段落（T5 / C-P1-2 / C-P1-3）
  const [anchorEntryIds, setAnchorEntryIds] = useState<string[] | null>(null)
  const [anchorTs, setAnchorTs] = useState<string | null>(null)
  const anchorTimerRef = useRef<number | null>(null)
  const hlTermTimerRef = useRef<number | null>(null)

  const flashAnchor = (ids: string[] | null) => {
    setAnchorEntryIds(ids)
    setAnchorTs(ids ? String(Date.now()) : null)
    if (ids && ids.length) setActiveTab('speech')
    if (anchorTimerRef.current) window.clearTimeout(anchorTimerRef.current)
    if (ids && ids.length) {
      anchorTimerRef.current = window.setTimeout(() => {
        setAnchorEntryIds(null)
        setAnchorTs(null)
      }, 2600)
    }
  }
  const handleAnchor = (c: Commentary) => flashAnchor(c.anchorEntryIds && c.anchorEntryIds.length ? c.anchorEntryIds : null)
  const jumpToEntry = (id: string) => flashAnchor([id])
  useEffect(
    () => () => {
      if (anchorTimerRef.current) window.clearTimeout(anchorTimerRef.current)
      if (hlTermTimerRef.current) window.clearTimeout(hlTermTimerRef.current)
    },
    [],
  )

  // 双标签：默认「发言区」；两 panel 始终同挂载（切 tab 不丢 CommentaryPanel 本地态）
  const [activeTab, setActiveTab] = useState<'speech' | 'smart'>('speech')
  const [modalOpen, setModalOpen] = useState(false)

  // 思维导图下钻（DOM 委托，不改 MindMap）+ 关键词高亮（DOM 装饰）
  const mindmapRef = useRef<HTMLDivElement>(null)
  const [drillNode, setDrillNode] = useState<MindMapNode | null>(null)
  useMindMapDrill(mindmapRef, mindmap, setDrillNode)
  useKeywordHighlight(mindmapRef, enh.highlightTerm)

  // 导图节点搜索跳回
  useEffect(() => {
    const target = enh.mindmapScrollTarget
    if (!target) return
    const root = mindmapRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.mm-title'))
    const el = rows.find((r) => (r.textContent ?? '').trim() === target)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const para = el.closest('.mm-node') as HTMLElement | null
    if (para) {
      para.classList.add('anchor-hl')
      const t = setTimeout(() => para.classList.remove('anchor-hl'), 2200)
      return () => clearTimeout(t)
    }
  }, [enh.mindmapScrollTarget])

  // 划词工具条
  const [selState, setSelState] = useState<SelState | null>(null)
  const speechRef = useRef<HTMLDivElement>(null)
  const minutesRef = useRef<HTMLDivElement>(null)

  const handleMouseUp = (scope: 'entry' | 'minutes') => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelState(null)
      return
    }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    let node: Node | null = range.startContainer
    let targetId = ''
    while (node && node !== document.body) {
      const el = node as HTMLElement
      if (el.dataset && el.dataset.entryIds) {
        targetId = el.dataset.entryIds.split(' ')[0]
        break
      }
      if (el.dataset && el.dataset.minId) {
        targetId = el.dataset.minId
        break
      }
      node = el.parentElement
    }
    setSelState({ x: rect.left + rect.width / 2, y: rect.top - 10, text, scope, targetId })
  }

  const clearSelectionDom = () => {
    const sel = window.getSelection()
    if (sel) sel.removeAllRanges()
    setSelState(null)
  }

  const makeCommentary = (text: string, type: Commentary['type']): Commentary => {
    const now = new Date().toISOString()
    return {
      id: uid('c'),
      source: 'llm',
      roleId: '',
      roleCn: '我（划词）',
      color: 'var(--accent)',
      type,
      text,
      ts: now,
      anchorTs: now,
      anchorEntryIds: selState?.targetId ? [selState.targetId] : [],
      trigger: 'auto',
      pinned: false,
      ignored: false,
      importance: 2,
    }
  }

  const onSelHighlight = () => {
    if (!selState) return
    enh.addHighlight({ id: uid('h'), targetId: selState.targetId, text: selState.text })
    clearSelectionDom()
  }
  const onSelComment = () => {
    if (!selState) return
    enh.addUserCommentary(makeCommentary(selState.text, 'suggestion'))
    clearSelectionDom()
  }
  const onSelQuote = () => {
    if (!selState) return
    enh.addUserCommentary(makeCommentary(`> ${selState.text}`, 'highlight'))
    clearSelectionDom()
  }

  // 搜索结果选择 → 按 kind 分流跳转 + 高亮（3s 淡出）
  const onSelectSearch = (r: SearchResult, idx: number) => {
    enh.setActiveSearchIdx(idx)
    const q = enh.query
    if (q) {
      enh.setHighlightTerm(q)
      if (hlTermTimerRef.current) window.clearTimeout(hlTermTimerRef.current)
      hlTermTimerRef.current = window.setTimeout(() => enh.setHighlightTerm(''), 3000)
    }
    switch (r.kind) {
      case 'entry':
        jumpToEntry(r.targetId)
        break
      case 'minutes-paragraph':
        setActiveTab('smart')
        enh.setMinutesScrollTarget(r.targetId)
        break
      case 'mindmap-node':
        setActiveTab('smart')
        enh.setMindmapScrollTarget(r.targetId)
        break
      case 'commentary': {
        const c = allCommentaries.find((x) => x.id === r.targetId)
        if (c && c.anchorEntryIds && c.anchorEntryIds.length) jumpToEntry(c.anchorEntryIds[0])
        else setActiveTab('smart')
        break
      }
    }
  }

  // 关键词点击：设置高亮词（持久，直至下次搜索跳转清除）
  const onKeywordClick = (word: string) => enh.setHighlightTerm(word)

  // 角色重命名：由 entryId 反查 key（opinion→roleId / speech→HUMAN_KEY）
  const handleRename = (entryId: string, label: string) => {
    const e = entries.find((x) => x.id === entryId)
    const key = e && e.type === 'opinion' ? e.roleId ?? '' : HUMAN_KEY
    enh.setRoleLabel(key, label)
  }

  // 占比条角色筛选 + 跳转首条
  const handleRoleFilter = (key: string | null) => {
    enh.setActiveRoleFilter(key)
    if (!key) return
    const first = entries.find((e) =>
      key === HUMAN_KEY ? e.type === 'speech' : e.type === 'opinion' && e.roleId === key,
    )
    if (first) {
      setActiveTab('speech')
      jumpToEntry(first.id)
    }
  }

  const handleCreate = async (data: Partial<Role>) => {
    try {
      const role = await addRole(meeting.id, data)
      onAddCustomRole(role)
    } catch {
      /* 创建失败不影响界面 */
    }
  }

  // 结束会议：若正在收音则先停收音，再进入总结态（设计 §八 #2）
  const handleEndMeeting = () => {
    if (listening) toggleListen()
    onEnd()
  }

  return (
    <div className="app-shell">
      <section className="stage">
        <div className="topbar">
          <button className="btn ghost" type="button" onClick={onBack} style={{ padding: '8px 14px' }}>
            ← 准备
          </button>
          <button className="btn ghost" type="button" onClick={handleEndMeeting} style={{ padding: '8px 14px' }}>
            结束会议
          </button>
          <MicControls
            listening={listening}
            volumeRef={volumeRef}
            onToggle={toggleListen}
            auto={auto}
            setAuto={setAuto}
            asrMode={asrMode}
            setAsrMode={setAsrMode}
            error={error}
          />
          <BriefPill title={title} brief={brief} onTitle={setTitle} onBrief={setBrief} />
          <SearchBar
            value={enh.query}
            onChange={enh.setQuery}
            results={enh.searchResults}
            activeIdx={enh.activeSearchIdx}
            onSelect={onSelectSearch}
            onPrev={() =>
              enh.setActiveSearchIdx(enh.searchResults.length ? (enh.activeSearchIdx - 1 + enh.searchResults.length) % enh.searchResults.length : 0)
            }
            onNext={() =>
              enh.setActiveSearchIdx(enh.searchResults.length ? (enh.activeSearchIdx + 1) % enh.searchResults.length : 0)
            }
            onClose={() => enh.setQuery('')}
          />
          <SpeechQuotaBar
            entries={entries}
            roles={roles}
            roleLabels={enh.roleLabels}
            activeRoleFilter={enh.activeRoleFilter}
            onSelect={handleRoleFilter}
          />
          <ExportMenu
            entries={entries}
            roles={roles}
            roleLabels={enh.roleLabels}
            structuredRefined={structuredRefined}
            meetCreatedAt={meeting.createdAt}
            meetingTitle={title}
          />
        </div>

        <div className="tab-bar" role="tablist" aria-label="会议室视图切换">
          <button
            type="button"
            role="tab"
            id="tab-speech"
            aria-selected={activeTab === 'speech'}
            aria-controls="panel-speech"
            className={`tab-btn${activeTab === 'speech' ? ' active' : ''}`}
            onClick={() => setActiveTab('speech')}
          >
            发言区
          </button>
          <button
            type="button"
            role="tab"
            id="tab-smart"
            aria-selected={activeTab === 'smart'}
            aria-controls="panel-smart"
            className={`tab-btn${activeTab === 'smart' ? ' active' : ''}`}
            onClick={() => setActiveTab('smart')}
          >
            智能纪要
          </button>
        </div>

        <div className="tab-body">
          {/* 发言区：合并时间线（speech + opinion 按 ts 升序），复用的 TranscriptPanel 恒为 raw 视图 */}
          <div
            className={`tab-panel${activeTab === 'speech' ? ' active' : ''}`}
            role="tabpanel"
            id="panel-speech"
            aria-labelledby="tab-speech"
            inert={activeTab !== 'speech'}
          >
            <TagFilterBar
              active={enh.activeTagFilter}
              counts={enh.tagCounts}
              onChange={enh.setActiveTagFilter}
            />
            <div className="speech-panel" ref={speechRef} onMouseUp={() => handleMouseUp('entry')}>
              <TranscriptPanel
                entries={enh.filteredEntries}
                interim={interim}
                view="raw"
                refinedText={null}
                anchorEntryIds={anchorEntryIds ?? undefined}
                anchorTs={anchorTs ?? undefined}
                decorations={enh.buildDecorations}
                onRename={handleRename}
                onTag={enh.toggleEntryTag}
                onEdit={enh.setEntryEdit}
                onToggleSelect={enh.toggleSelect}
                highlightTerm={enh.highlightTerm}
                userHighlights={enh.highlights}
              />
            </div>
          </div>

          {/* 智能纪要：AI整理版 / 思维导图 / 实时点评 三区块竖向堆叠，各自独立滚动 */}
          <div
            className={`tab-panel${activeTab === 'smart' ? ' active' : ''}`}
            role="tabpanel"
            id="panel-smart"
            aria-labelledby="tab-smart"
            inert={activeTab !== 'smart'}
          >
            <div className="smart-stack">
              {/* 区块① AI整理版（结构化纪要） */}
              <div className="smart-block">
                <div className="enhance-statusbar">
                  <span className="enh-status">
                    {refining
                      ? '整理中…'
                      : lastRefineAt
                        ? `最近整理于 ${fmtTime(lastRefineAt)}`
                        : '尚未整理'}
                  </span>
                  {refineError && <span className="enh-error">整理暂不可用</span>}
                </div>
                <div className="smart-body smart-body-refined" ref={minutesRef} onMouseUp={() => handleMouseUp('minutes')}>
                  <StructuredMinutes
                    data={structuredRefined}
                    fallbackText={refinedText}
                    highlightTerm={enh.highlightTerm}
                    scrollTargetId={enh.minutesScrollTarget}
                    meetCreatedAt={meeting.createdAt}
                    roleLabels={enh.roleLabels}
                    roles={roles}
                    entries={entries}
                    keywords={keywords}
                    refining={refining}
                    onJumpToEntry={jumpToEntry}
                    onKeywordClick={onKeywordClick}
                    userHighlights={enh.highlights}
                  />
                </div>
              </div>

              {/* 区块② 思维导图 */}
              <div className="smart-block">
                <div className="enhance-statusbar">
                  <span className="enh-status">
                    {mindmapping
                      ? '导图生成中…'
                      : lastMindmapAt
                        ? `更新于 ${fmtTime(lastMindmapAt)}`
                        : '暂无导图'}
                  </span>
                  {mindmapError && <span className="enh-error">导图暂不可用</span>}
                </div>
                <div className="smart-body smart-body-mindmap" ref={mindmapRef}>
                  <MindMap root={mindmap} />
                </div>
              </div>

              {/* 区块③ 实时点评（零改动复用 CommentaryPanel，自带标题/开关/计数/滚动） */}
              <div className="smart-block smart-block-commentary">
                <CommentaryPanel
                  meetingId={meeting.id}
                  commentaries={allCommentaries}
                  commentaryEnabled={commentaryEnabled}
                  collecting={live.collecting}
                  error={live.error}
                  onToggle={setCommentaryEnabled}
                  onAnchor={handleAnchor}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="controls">
          <span className="hint">
            {listening ? '实时转写进行中，可随时点击大咖「💬 发言」' : '点击「开始收音」用浏览器实时转写（Chrome/Edge）'}
          </span>
        </div>
      </section>

      <BigShotBar
        roles={liveRoles}
        speaking={speaking}
        onSpeak={requestSpeak}
        onNew={() => setModalOpen(true)}
      />

      <NewBigShotModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={handleCreate} />

      {/* 划词工具条 */}
      {selState && (
        <SelectionToolbar
          x={selState.x}
          y={selState.y}
          onHighlight={onSelHighlight}
          onComment={onSelComment}
          onQuote={onSelQuote}
          onClose={clearSelectionDom}
        />
      )}

      {/* 摘录卡片（多选 ≥1 时浮出） */}
      {enh.selectedEntryIds.size > 0 && (
        <ExcerptCard
          entries={entries.filter((e) => enh.selectedEntryIds.has(e.id))}
          roles={roles}
          roleLabels={enh.roleLabels}
          meetCreatedAt={meeting.createdAt}
          onCopy={() => enh.clearSelection()}
          onExport={() => enh.clearSelection()}
          onClose={() => enh.clearSelection()}
        />
      )}

      {/* 思维导图节点下钻浮层 */}
      {drillNode && (
        <MindMapDrill
          node={drillNode}
          entries={entries}
          roles={roles}
          roleLabels={enh.roleLabels}
          onJump={jumpToEntry}
          onClose={() => setDrillNode(null)}
        />
      )}
    </div>
  )
}
