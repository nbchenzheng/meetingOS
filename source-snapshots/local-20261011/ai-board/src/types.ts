// src/types.ts —— 前后端共享类型契约（Role / TranscriptEntry / Opinion / MeetingDoc）

export type RoleProvider = 'deepseek' | 'linkharbor' | 'local'

export interface Role {
  id: string
  en?: string
  cn: string
  title: string
  color: string
  initial: string
  avatar?: string
  avatarOk?: boolean
  persona?: string
  focus?: string[]
  model: string // deepseek-v4-pro | claude-opus-4-8 | gpt-5.5 | local
  provider: RoleProvider
  preset?: boolean
  custom?: boolean
  order?: number
  dossier?: string
  /** 是否是「大咖AI」拟人化顾问（增量：占比条/配色/圆点固定视觉）。 */
  isBigShot?: boolean
}

export type TranscriptType = 'speech' | 'opinion'

export interface TranscriptEntry {
  id: string
  sessionId?: string
  text: string
  type: TranscriptType
  roleId?: string
  speaker?: string
  color?: string
  final?: boolean
  ts: string
}

export interface MeetingDoc {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'txt' | 'md'
  parsedText: string
  sizeBytes: number
  addedAt: string
}

export interface UploadParseResult {
  ok: boolean
  id: string
  name: string
  type: string
  parsedText: string
  sizeBytes: number
  error?: string
}

export type OpinionSeverity = 'info' | 'warn' | 'risk'
export type OpinionTrigger = 'manual' | 'auto'

export interface Opinion {
  id: string
  roleId: string
  text: string
  severity: OpinionSeverity
  trigger: OpinionTrigger
  ts: string
}

export interface Meeting {
  id: string
  title: string
  brief: string
  roleIds: string[]
  materials: MeetingDoc[]
  transcript: TranscriptEntry[]
  opinions: Opinion[]
  createdAt: string
  /** 会中实时点评（大咖主动点评落库；llm 源由前端本地维护，不回流后端）。 */
  commentaries?: Commentary[]
  /** 实时反馈面板开关（仅静音 LLM 采集 + 大咖主动，不影响手动💬与 maybeAuto）。默认 true。 */
  commentaryEnabled?: boolean
  /** 最近一次思维导图顶层分支标题集合（话题切换检测主信号）。 */
  mindmapTopBranches?: string[]
}

// ===== 转录增强（实时整理 + 思维导图）共享类型 =====

/** 思维导图节点：递归结构，与后端 normalizeMindmap 输出一致。 */
export interface MindMapNode {
  title: string
  children?: MindMapNode[]
  /** 增量（B2）：叶子节点尽力回带的来源转录条目 id（已后端归一化，仅真实 id，≤8）。 */
  entryIds?: string[]
}

// ===== 增量（飞书妙记借鉴点）：结构化纪要 / 关键词 / 标签 / 搜索 =====

/** 发言区条目标签（P1-④）。 */
export type TagKey = 'conclusion' | 'todo' | 'question' | 'highlight'

/** 整理接口入参：逐条转录条目（携带 id/ts/角色，供后端回带来源锚点）。 */
export interface RefineEntryInput {
  id: string
  ts: string
  type: 'speech' | 'opinion'
  text: string
  roleId?: string
  speaker?: string
  color?: string
}

/** 结构化纪要：单段落（结论/普通）。 */
export interface MinutesParagraph {
  id: string
  text: string
  type: 'conclusion' | 'normal'
  sourceEntryId?: string
  sourceTs?: string
  aiSupplement?: boolean
}

/** 结构化纪要：行动项（含负责人/截止/来源锚点）。 */
export interface ActionItem {
  id: string
  text: string
  owner?: string | null
  due?: string | null
  sourceEntryId?: string
  sourceTs?: string
}

/** 结构化纪要：章节。 */
export interface MinutesChapter {
  id: string
  title: string
  paragraphs: MinutesParagraph[]
  actionItems: ActionItem[]
}

/** 关键词（带词频，用于高亮上/下跳转计数）。 */
export interface Keyword {
  word: string
  count?: number
}

/** 结构化纪要整体结构（后端 B1 产出，前端 F2 分区渲染）。 */
export interface StructuredMinutes {
  chapters: MinutesChapter[]
  keywords: Keyword[]
  plainText: string
}

/** 全局搜索结果（覆盖发言区 / 结构化纪要 / 思维导图 / 点评）。 */
export interface SearchResult {
  kind: 'entry' | 'minutes-paragraph' | 'mindmap-node' | 'commentary'
  label: string
  targetId: string
  snippet: string
  ts?: string
}

/** TranscriptPanel 增量：单条可选装饰（默认不传 = 行为不变）。 */
export interface TranscriptDecoration {
  dot?: { color: string; isBigShot?: boolean; initial?: string; label?: string }
  renameLabel?: string
  tags?: TagKey[]
  edited?: boolean
  overrideText?: string
  selected?: boolean
  selectable?: boolean
  hoverActions?: Array<'rename' | 'tag' | 'edit' | 'select'>
}

/** 划词用户高亮（会话态常驻，按 targetId 匹配发言区/纪要段落）。 */
export interface UserHighlight {
  id: string
  targetId: string
  text: string
}

/** POST /api/transcript/refine 响应（始终 HTTP 200，以 ok 字段判定成败）。 */
export interface RefineResponse {
  ok: boolean
  refinedText: string // 成功=plainText 兜底全文；失败=原稿拼接
  model?: string // 成功时：'deepseek-v4-pro'
  tookMs?: number // 成功时：耗时
  error?: string // 失败时：可读中文原因（绝不暴露密钥/堆栈）
  degraded?: boolean // true=降级（保留原稿，前端状态条显「整理暂不可用」）
  /** 成功时：结构化纪要 JSON（章节/结论/行动项/来源锚点）。 */
  structured?: StructuredMinutes | null
  /** 成功时：关键词列表。 */
  keywords?: Keyword[]
}

/** POST /api/transcript/mindmap 响应（始终 HTTP 200，以 ok 字段判定成败）。 */
export interface MindmapResponse {
  ok: boolean
  root: MindMapNode | null // 成功=根节点；失败=null
  tookMs?: number
  error?: string // 可读中文原因
  degraded?: boolean
}

// ===== 会议总结 + 邮件发送（增量功能 T1-T5）共享类型 =====

/** 总结级别：v1 固定 detailed，预留 brief（P1）。 */
export type SummaryLevel = 'brief' | 'detailed'

/** 六要素固定 key（顺序：meta→topics→conclusions→actions→views→thread）。 */
export type SummaryElementKey = 'meta' | 'topics' | 'conclusions' | 'actions' | 'views' | 'thread'

/** 单个总结要素（可折叠）。 */
export interface SummaryElement {
  key: SummaryElementKey
  title: string
  content: string
  collapsed: boolean
}

/** 要素5 的结构化展开：预设大咖观点。 */
export interface SummaryBigShotView {
  roleId: string
  cn: string
  title: string
  viewpoint: string
}

/** 六要素结构化总结结果。 */
export interface SummaryResult {
  level: SummaryLevel
  subject: string
  occurredAt: string
  elements: SummaryElement[]
  bigShots: SummaryBigShotView[]
}

/** 会议元信息（后端取自给前端，前端也可据此构造入口）。 */
export interface MeetingMeta {
  meetingId: string
  title: string
  createdAt: string
  bigShots: { id: string; cn: string; title: string }[]
}

/** 总结生成请求条目（转录条目的精简子集）。 */
export interface SummaryEntry {
  id: string
  type: TranscriptType
  text: string
  speaker?: string
  roleId?: string
  ts: string
}

/** POST /api/summary/generate 请求。 */
export interface GenerateSummaryRequest {
  meetingId: string
  entries: SummaryEntry[]
  level: SummaryLevel
}

/** POST /api/summary/generate 响应（始终 HTTP 200，以 ok 判定成败）。 */
export interface GenerateSummaryResponse {
  ok: boolean
  model?: string
  tookMs?: number
  cached?: boolean
  result?: SummaryResult
  error?: string
  degraded?: boolean
}

/** 发信预览（step1 返回，用于两步确认弹窗）。 */
export interface SendPreview {
  email: string
  subject: string
  elementCount: number
  hasAttachment: boolean
  sizeHintBytes: number
}

/**
 * 邮件发送错误码（前后端共用唯一真理，对齐设计文档枚举）。
 */
export type SummarySendErrorCode =
  | 'RECIPIENT_INVALID'
  | 'QUOTA_EXCEEDED'
  | 'CTK_MISSING'
  | 'CLI_NOT_FOUND'
  | 'CLI_AUTH_EXPIRED'
  | 'NETWORK_ERROR'
  | 'CONFIRMATION_EXPIRED'
  | 'SUMMARY_EMPTY'
  | 'MEETING_NOT_FOUND'
  | 'UNKNOWN'

/** POST /api/summary/send 请求（step1）。 */
export interface SendRequest {
  meetingId: string
  email: string
  level: SummaryLevel
}

/** POST /api/summary/send/confirm 请求（step2）。 */
export interface SendConfirmRequest {
  confirmationRef: string
}

/** POST /api/summary/send | send/confirm 响应（始终 HTTP 200）。 */
export interface SendResponse {
  ok: boolean
  confirmationRef?: string
  preview?: SendPreview
  code?: SummarySendErrorCode
  error?: string
  degraded?: boolean
}

// ===== 会中实时反馈 / 点评（增量 T1-T5）=====

/** 点评来源：llm=前端定时/话题补驱动的轻量点评；bigshot=后端大咖主动点评。 */
export type CommentarySource = 'llm' | 'bigshot'

/** 点评类型（四枚举，前端展示标签与配色）。 */
export type CommentaryType = 'highlight' | 'risk' | 'clarify' | 'suggestion'

/** 点评触发源：timer=定时；topic=话题切换补采；auto=大咖主动点评触发。 */
export type CommentaryTrigger = 'timer' | 'topic' | 'auto'

/** 单条点评卡片（统一契约，前后端共用；llm / bigshot 共用此结构）。 */
export interface Commentary {
  id: string
  source: CommentarySource
  roleId?: string
  roleCn?: string
  color?: string
  type: CommentaryType
  text: string
  ts: string
  anchorTs: string
  anchorEntryIds?: string[]
  trigger: CommentaryTrigger
  pinned?: boolean
  ignored?: boolean
  importance?: 1 | 2 | 3
}

/** 实时点评上下文（前端定时补采时构造，传入 LLM）。 */
export interface CommentaryCtx {
  meetingTitle?: string
  trigger: CommentaryTrigger
  anchorTs?: string
  /** 时间轴联动锚点：锚定时刻之前最近一段 speech 条目 id（后端落库，卡片「定位」用）。 */
  anchorEntryIds?: string[]
  recentCommentary?: { type: CommentaryType; text: string }[]
  topTopics?: string[]
}

/** POST /api/transcript/commentary 请求（rawText=最近 speech 文本，ctx=上下文）。 */
export interface CommentaryRequest {
  rawText: string
  ctx: CommentaryCtx
}

/** POST /api/transcript/commentary 响应（始终 HTTP 200，以 ok 判定成败）。 */
export interface CommentaryResponse {
  ok: boolean
  commentary: Commentary | null // 成功=点评；null=本窗口无可点评（前端静默跳过，非降级）
  model?: string
  tookMs?: number
  error?: string // 失败时：可读中文原因（不绝白屏）
  degraded?: boolean
}

/** GET /api/meetings/:id/commentaries 响应。 */
export interface CommentaryListResponse {
  ok: boolean
  commentaries: Commentary[]
  commentaryEnabled: boolean
}

/** PATCH /api/meetings/:id 设置实时点评开关（body 仅需 commentaryEnabled）。 */
export interface SetCommentaryEnabledRequest {
  commentaryEnabled: boolean
}
