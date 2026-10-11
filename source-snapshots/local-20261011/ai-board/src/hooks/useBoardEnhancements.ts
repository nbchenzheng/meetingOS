// src/hooks/useBoardEnhancements.ts —— 增量功能统一状态层
// 集中持有跨面板状态（搜索 / 角色重命名 / 条目标签 / 行内纠错 / 划词高亮 / 摘录 / 角色筛选 / 用户点评 / 跳转目标），
// 并对外暴露动作与「逐条装饰」构造器。所有状态均为会话内存态，不落库。
import { useCallback, useMemo, useState } from 'react'
import type {
  Commentary,
  MindMapNode,
  Role,
  SearchResult,
  StructuredMinutes,
  TagKey,
  TranscriptDecoration,
  TranscriptEntry,
  UserHighlight,
} from '../types'
import { HUMAN_KEY, resolveSpeaker, type SpeakerInfo } from '../lib/speaker'
import { useBoardSearch } from './useBoardSearch'

export type TagFilter = 'all' | TagKey

interface Input {
  entries: TranscriptEntry[]
  roles: Role[]
  structuredRefined: StructuredMinutes | null
  mindmap: MindMapNode | null
  /** 已合并（含历史）的点评，供搜索覆盖。 */
  commentaries: Commentary[]
}

export interface EnhancementApi {
  // 搜索
  query: string
  setQuery: (q: string) => void
  searchResults: SearchResult[]
  activeSearchIdx: number
  setActiveSearchIdx: (i: number) => void
  // 角色重命名
  roleLabels: Record<string, string>
  setRoleLabel: (key: string, label: string) => void
  // 标签
  entryTags: Record<string, TagKey[]>
  toggleEntryTag: (id: string, tag: TagKey) => void
  activeTagFilter: TagFilter
  setActiveTagFilter: (t: TagFilter) => void
  tagCounts: Record<TagFilter, number>
  // 行内纠错
  entryEdits: Record<string, string>
  setEntryEdit: (id: string, text: string) => void
  // 划词高亮
  highlights: UserHighlight[]
  addHighlight: (h: UserHighlight) => void
  removeHighlight: (id: string) => void
  // 摘录多选
  selectedEntryIds: Set<string>
  toggleSelect: (id: string) => void
  clearSelection: () => void
  // 关键词高亮
  highlightTerm: string
  setHighlightTerm: (t: string) => void
  // 角色筛选（占比条）
  activeRoleFilter: string | null
  setActiveRoleFilter: (r: string | null) => void
  // 划词评论/引用
  userCommentaries: Commentary[]
  addUserCommentary: (c: Commentary) => void
  // 跳转目标
  minutesScrollTarget: string | null
  setMinutesScrollTarget: (id: string | null) => void
  mindmapScrollTarget: string | null
  setMindmapScrollTarget: (id: string | null) => void
  // 过滤后的条目（标签/角色筛选生效）
  filteredEntries: TranscriptEntry[]
  // 工具
  resolveSpeaker: (entry: TranscriptEntry) => SpeakerInfo
  buildDecorations: (entry: TranscriptEntry) => TranscriptDecoration | null
}

export function useBoardEnhancements({
  entries,
  roles,
  structuredRefined,
  mindmap,
  commentaries,
}: Input): EnhancementApi {
  // —— 搜索 ——
  const [query, setQueryRaw] = useState('')
  const [activeSearchIdx, setActiveSearchIdx] = useState(0)
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q)
    setActiveSearchIdx(0)
  }, [])

  // —— 角色重命名 ——
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
  const setRoleLabel = useCallback((key: string, label: string) => {
    setRoleLabels((prev) => ({ ...prev, [key]: label }))
  }, [])

  // —— 标签 ——
  const [entryTags, setEntryTags] = useState<Record<string, TagKey[]>>({})
  const [activeTagFilter, setActiveTagFilter] = useState<TagFilter>('all')
  const toggleEntryTag = useCallback((id: string, tag: TagKey) => {
    setEntryTags((prev) => {
      const cur = prev[id] ?? []
      const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]
      const copy = { ...prev }
      if (next.length) copy[id] = next
      else delete copy[id]
      return copy
    })
  }, [])

  // —— 行内纠错 ——
  const [entryEdits, setEntryEdits] = useState<Record<string, string>>({})
  const setEntryEdit = useCallback((id: string, text: string) => {
    setEntryEdits((prev) => ({ ...prev, [id]: text }))
  }, [])

  // —— 划词高亮 ——
  const [highlights, setHighlights] = useState<UserHighlight[]>([])
  const addHighlight = useCallback((h: UserHighlight) => {
    setHighlights((prev) => [...prev, h])
  }, [])
  const removeHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id))
  }, [])

  // —— 摘录多选 ——
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set())
  const toggleSelect = useCallback((id: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedEntryIds(new Set()), [])

  // —— 关键词高亮 ——
  const [highlightTerm, setHighlightTerm] = useState('')

  // —— 角色筛选 ——
  const [activeRoleFilter, setActiveRoleFilter] = useState<string | null>(null)

  // —— 划词评论/引用 ——
  const [userCommentaries, setUserCommentaries] = useState<Commentary[]>([])
  const addUserCommentary = useCallback((c: Commentary) => {
    setUserCommentaries((prev) => [c, ...prev])
  }, [])

  // —— 跳转目标 ——
  const [minutesScrollTarget, setMinutesScrollTarget] = useState<string | null>(null)
  const [mindmapScrollTarget, setMindmapScrollTarget] = useState<string | null>(null)

  // 说话人解析（随重命名实时变化）
  const resolveSpeakerMemo = useCallback(
    (entry: TranscriptEntry): SpeakerInfo => resolveSpeaker(entry, roleLabels, roles),
    [roleLabels, roles],
  )

  // 搜索结果（覆盖四源）
  const searchResults = useBoardSearch(query, {
    entries,
    structuredRefined,
    mindmap,
    commentaries,
    resolveSpeaker: resolveSpeakerMemo,
  })

  // 标签计数
  const tagCounts = useMemo<Record<TagFilter, number>>(() => {
    const counts: Record<TagFilter, number> = { all: entries.length, conclusion: 0, todo: 0, question: 0, highlight: 0 }
    for (const e of entries) {
      const tags = entryTags[e.id] ?? []
      for (const t of tags) counts[t] += 1
    }
    return counts
  }, [entries, entryTags])

  // 过滤后条目（标签 + 角色筛选，AND 叠加）
  const filteredEntries = useMemo<TranscriptEntry[]>(() => {
    let list = entries
    if (activeTagFilter !== 'all') {
      list = list.filter((e) => (entryTags[e.id] ?? []).includes(activeTagFilter))
    }
    if (activeRoleFilter) {
      if (activeRoleFilter === HUMAN_KEY) {
        list = list.filter((e) => e.type === 'speech')
      } else {
        list = list.filter((e) => e.type === 'opinion' && e.roleId === activeRoleFilter)
      }
    }
    return list
  }, [entries, activeTagFilter, activeRoleFilter, entryTags])

  // 逐条装饰构造器（默认不传 = 行为不变；此处始终传，渲染为逐条气泡）
  const buildDecorations = useCallback(
    (entry: TranscriptEntry): TranscriptDecoration | null => {
      const sp = resolveSpeakerMemo(entry)
      return {
        dot: { color: sp.color, isBigShot: sp.isBigShot, initial: sp.initial, label: sp.label },
        renameLabel: sp.label,
        tags: entryTags[entry.id] ?? [],
        edited: Boolean(entryEdits[entry.id]),
        overrideText: entryEdits[entry.id],
        selected: selectedEntryIds.has(entry.id),
        selectable: true,
        hoverActions: ['rename', 'tag', 'edit', 'select'],
      }
    },
    [resolveSpeakerMemo, entryTags, entryEdits, selectedEntryIds],
  )

  return {
    query,
    setQuery,
    searchResults,
    activeSearchIdx,
    setActiveSearchIdx,
    roleLabels,
    setRoleLabel,
    entryTags,
    toggleEntryTag,
    activeTagFilter,
    setActiveTagFilter,
    tagCounts,
    entryEdits,
    setEntryEdit,
    highlights,
    addHighlight,
    removeHighlight,
    selectedEntryIds,
    toggleSelect,
    clearSelection,
    highlightTerm,
    setHighlightTerm,
    activeRoleFilter,
    setActiveRoleFilter,
    userCommentaries,
    addUserCommentary,
    minutesScrollTarget,
    setMinutesScrollTarget,
    mindmapScrollTarget,
    setMindmapScrollTarget,
    filteredEntries,
    resolveSpeaker: resolveSpeakerMemo,
    buildDecorations,
  }
}
