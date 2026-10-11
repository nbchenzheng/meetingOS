# AI 私董会 · 飞书妙记借鉴点增量设计 + 任务拆解

> 受众：前端工程师（Carol）+ 后端工程师（Dave）。本文只给设计结论与任务清单，**不含实现代码**。
> 范围：在现有「双标签（发言区 + 智能纪要）」架构上增量落地 PRD 全量 **P0 + P1 + P2**（全局搜索 / 结构化纪要 / 角色可视化 / 来源标注 / 关键词 / 标签 / 纠错 / 导图下钻 / 划词 / 导出 / 占比条 / 移动端）。
> 基线：复用 `TranscriptPanel` / `MindMap` / `CommentaryPanel`，**不重写既有组件逻辑**，仅在其外层包新交互（组件扩展采用「可选 prop、默认关闭 = 行为不变」策略，详见 §8-A）。
> 约束：纯文字流，无音视频；无通讯录体系；保留特殊角色「大咖AI」；明确排除音字同步/视频分享/@真实同事/声纹/视频导出/翻译。

---

## 1. 实现方案 + 框架选型

### 1.1 技术选型（前端 / 后端改动点）

- **无新框架、无新依赖**。栈保持 React 19 + Vite + TypeScript（strict: noUnusedLocals / noUnusedParameters / verbatimModuleSyntax）。后端保持 Node ESM 原生 http + ws，端口 3001。
- **前端改动点**：全部落在「双标签容器 `BoardRoom` 之上包一层增强交互」+ 一组**新增**轻量组件/hook。既有三个核心组件逻辑零改动（见 §1.3 扩展策略）。
- **后端改动点**：仅改 `transcript-service.mjs` 的 `refine` 提示词与输入输出，以及 `api-server.mjs` 的 `/api/transcript/refine` 路由入参；可选增强 `mindmap` 提示词（给叶子节点回带 `entryIds`）。**导出（P1-⑧）、搜索（P0-①）、标签/重命名/纠错/划词/占比（均前端会话态）均不需要后端改动**。

### 1.2 双标签结构如何承载新功能

现有结构（`BoardRoom`）：topbar → tab-bar（发言区 / 智能纪要）→ tab-body（两 panel 同挂载、visibility 切换）→ controls；智能纪要内 `.smart-stack` 竖向堆叠【整理版块 / 思维导图块 / 实时点评块】。

| 新功能 | 落在哪 | 承载方式 |
|---|---|---|
| **全局搜索框**（P0-①） | **topbar 中部** | 新增 `SearchBar`，与「导出」按钮并列；`⌘K` 唤起；结果面板为覆盖式下拉（非模态） |
| **结构化纪要**（P0-②） | 智能纪要·**整理版块内部升级** | 该块由「纯文本 `<div>{refinedText}</div>`」替换为新组件 `StructuredMinutes`（消费后端结构化 JSON），分区渲染章节/结论高亮/✅行动项；顶部叠加关键词区 |
| **角色配色圆点 + 重命名**（P1-①） | **发言区每条之前** + 每条 hover `▾` | 通过 `TranscriptPanel` 的可选 `decorations` prop 渲染圆点；重命名 `RenamePopover` 浮层，仅会话态 |
| **来源标注 + 跳回**（P1-②） | 结构化纪要每段/行动项旁 | `StructuredMinutes` 渲染「源自 发言区 03:12 张总」按钮 → 复用 `handleAnchor` 式跳回 |
| **关键词高亮**（P1-③） | 智能纪要·整理版块**顶部关键词区** | 点击词 → 在发言区/纪要中高亮全部命中 + 上/下跳转（复用搜索高亮组件） |
| **发言区打标签 + 筛选**（P1-④） | 发言区**顶部筛选 Tab** | 新增 `TagFilterBar`（全部/结论/待办/疑问/重点）；标记经 `decorations` 在条目前画彩色标签条 |
| **行内纠错**（P1-⑤） | 发言区每条 hover `✎` | `decorations.hoverActions` 触发 `InlineEditor` 覆盖层；保存写会话态覆盖文本 |
| **导图节点下钻**（P1-⑥） | 智能纪要·思维导图块**外层** | 新增 `MindMapDrill`（DOM 事件委托，不改 `MindMap`），点击节点 → 浮层列出来源 entry + 大咖观点 → 跳回 |
| **划词工具条**（P1-⑦） | 发言区 / 结构化纪要**选区上方** | 新增 `SelectionToolbar`（高亮/评论/引用）；「高亮」会话内常驻，「评论」经可选 prop 入点评流 |
| **导出**（P1-⑧） | **topbar 右侧** | 新增 `ExportMenu`；纯前端生成 MD/TXT（含角色 + 相对时间戳），Blob 下载 |
| **文字摘录卡片**（P2-①） | 发言区**多选后浮层** | 每条可选中（checkbox via `decorations`）；浮出 `ExcerptCard` 复制/导出 |
| **发言占比条**（P2-②） | **topbar 右侧**（导出前） | 新增 `SpeechQuotaBar`，按角色着色；点击某段 → 筛选/跳转该角色发言 |
| **移动端响应式**（P2-③） | 全局 CSS ≤720px | CSS 优先；搜索/占比/筛选收进顶部抽屉或横向滚动，不破坏桌面端 |

### 1.3 关键架构决策（回答 PRD §5 待确认问题）

1. **结构化纪要后端 JSON Schema**：采用「章节 → 段落(结论/普通) + 行动项」嵌套（见 §3.1）。行动项 `owner`/`due` 由 AI 推断填空（可空），`sourceEntryId`/`sourceTs` 回带原文锚点。
2. **关键词抽取**：**后端在 `refine` 同一次 LLM 调用内产出**（推荐，质量高、零额外调用），格式 `{word, count?}[]`。不单独开接口。
3. **来源锚点回带**：**后端在整理时回带原文 `entryId`（首选，精准）**；前端文本子串兜底（当 `sourceEntryId` 缺失时）。该决策同时服务 P0-② / P1-② / P1-⑥。
4. **思维导图节点↔原文映射**：`mindmap` 提示词增强，叶子节点**尽力**回带 `entryIds`（可空）；前端优先用 `entryIds`，缺失则按节点 `title` 在转录文本中做关键词匹配（现有机制）。
5. **发言占比条数据**：**前端按 `entries` 计算**（每条 speech 取相对会议起点的时长近似为「相邻条目间隔」累加，大咖 opinion 计入对应角色），无需后端聚合。
6. **持久化边界**：行内编辑、划词高亮、标签、重命名、摘录、占比筛选 **全部会话内存（local state）**，不落库；刷新/重开会议即重置（符合 PRD「纯前端会话态」）。
7. **大咖AI 固定视觉**：占比条/配色/圆点中始终置顶、用专属渐变（`--bigshot-gradient`）；计入「角色」统计口径（`isBigShot` 标记）。
8. **移动端断点**：沿用既有 **720px 单一断点**；各组件统一断点，不分别断点。

---

## 2. 文件清单（修改 / 新增 / 不变）

> 预估 **新增 16 个文件 + 修改 7 个文件 = 23 个**，属 >10 文件的中大型增量。

### 2.1 修改（7）

| 文件 | 路径 | 变更要点 |
|---|---|---|
| types.ts | `src/types.ts` | 新增 `StructuredMinutes` / `MinutesChapter` / `MinutesParagraph` / `ActionItem` / `Keyword` / `TagKey` / `RoleLabelMap` / `SearchResult` 等类型；`RefineResponse` 增加 `structured?`；`MindMapNode` 增加 `entryIds?`；`Role` 增加可选 `isBigShot?`；`CommentaryPanel` 增加可选 `extraCommentaries?`；《接口契约》见 §3.5 |
| lib/api.ts | `src/lib/api.ts` | `refineTranscript` 入参由 `rawText:string` 改为 `entries: RefineEntryInput[]`；响应解析新增 `structured`；`RefineEntryInput` 类型新增 |
| useTranscriptEnhance.ts | `src/hooks/useTranscriptEnhance.ts` | `runRefine` 由 `getRawText(entries)` 改为传入结构化 `entries`（携带 id/ts/roleId/speaker/color/text）；`refinedText` 仍保留为 `plainText` 兜底，`structuredRefined` / `keywords` 作为新返回字段 |
| BoardRoom.tsx | `src/components/BoardRoom.tsx` | 引入 `useBoardEnhancements` 状态层；topbar 增 `SearchBar`/`SpeechQuotaBar`/`ExportMenu`；发言区 panel 外裹 `TagFilterBar` + 转发 `decorations`；智能纪要整理版块由 `{refinedText}` 改为 `<StructuredMinutes>`；新增 `jumpToEntry`/`jumpToRole`/`jumpToMinutes`/`jumpToMindmap` 统一跳转；`handleAnchor` 复用 |
| TranscriptPanel.tsx | `src/components/TranscriptPanel.tsx` | **仅加法**：当传入可选 `decorations(entry)` 时，渲染圆点/标签条/编辑标记/选择框/hover 工具条；`textOverride`/`editedIds` 覆盖文本与标记。**不传这些 prop 时输出与原版逐字节一致（逻辑零改动）** |
| transcript-service.mjs | `server/transcript-service.mjs` | `buildRefineMessages` 改造为「结构化纪要 + 关键词 + 来源锚点」提示词；`refine` 入参改为 `entries[]`，内部重建 rawText 并请求 LLM 返回受限 JSON；新增 `parseRefinedJson` / `normalizeRefined`；`buildMindmapMessages` 增加「叶子节点尽力回带 entryIds」约束 |
| api-server.mjs | `server/api-server.mjs` | `/api/transcript/refine` 路由入参由 `body.rawText` 改为 `body.entries`；响应体新增 `structured`（解析后的 `StructuredMinutes`），保留 `refinedText` 作为 `plainText` 兜底；`/api/transcript/mindmap` 透传 `entryIds`（已在 `normalizeMindmap` 中归一化） |

### 2.2 新增 · 前端组件（13）

| 文件 | 路径 | 说明 |
|---|---|---|
| SearchBar.tsx | `src/components/SearchBar.tsx` | topbar 中部搜索输入 + `⌘K` 唤起 + 结果面板（`SearchResults` 内联或拆分） |
| StructuredMinutes.tsx | `src/components/StructuredMinutes.tsx` | 消费 `StructuredMinutes` JSON；分区渲染章节/结论高亮/✅行动项/来源标注按钮；支持 `highlightTerm` 与 `scrollTargetId` |
| RoleDot.tsx | `src/components/RoleDot.tsx` | 配色圆点（真人灰标+首字母 / 大咖AI 渐变），被 `TranscriptPanel.decorations` 复用 |
| RenamePopover.tsx | `src/components/RenamePopover.tsx` | 会话级重命名浮层（仅改 `roleLabels`，不改后端） |
| TagFilterBar.tsx | `src/components/TagFilterBar.tsx` | 发言区顶部筛选 Tab（全部/结论/待办/疑问/重点） |
| TagMenu.tsx | `src/components/TagMenu.tsx` | 单条 hover 弹出的标签菜单（写 `entryTags`） |
| InlineEditor.tsx | `src/components/InlineEditor.tsx` | 行内纠错覆盖层（写 `entryEdits`，保留原 ts） |
| SelectionToolbar.tsx | `src/components/SelectionToolbar.tsx` | 划词工具条（高亮/评论/引用） |
| ExcerptCard.tsx | `src/components/ExcerptCard.tsx` | 文字摘录卡片（复制 MD / 导出） |
| SpeechQuotaBar.tsx | `src/components/SpeechQuotaBar.tsx` | 发言占比条（前端算，点击筛选/跳转角色） |
| ExportMenu.tsx | `src/components/ExportMenu.tsx` | 导出 MD/TXT（纯前端 Blob 下载） |
| MindMapDrill.tsx | `src/components/MindMapDrill.tsx` | 导图节点下钻浮层（DOM 委托不改 `MindMap`） |
| MobileTopDrawer.tsx | `src/components/MobileTopDrawer.tsx` | ≤720px 时收纳搜索/占比/筛选的抽屉（可选，视实现取舍） |

### 2.3 新增 · 前端 hook（4）

| 文件 | 路径 | 说明 |
|---|---|---|
| useBoardEnhancements.ts | `src/hooks/useBoardEnhancements.ts` | **状态层**：集中持有跨面板 state（搜索/角色标签/条目标签/编辑/高亮/摘录/筛选/用户点评/跳转目标）与动作；接收 `entries`/`roles`/`structuredRefined`/`keywords` |
| useBoardSearch.ts | `src/hooks/useBoardSearch.ts` | 跨「发言区 + 结构化纪要 + 导图 + 点评」检索，返回分组结果 + 上/下跳转索引 |
| useKeywordHighlight.ts | `src/hooks/useKeywordHighlight.ts` | 对发言区 `.para` 做 DOM 装饰高亮（`<mark class="kw-hl">`）+ 上/下命中导航（不改 `TranscriptPanel`） |
| useMindMapDrill.ts | `src/hooks/useMindMapDrill.ts` | 思维导图 `.mm-row` 的 DOM 事件委托，识别点击节点并弹出 `MindMapDrill`（不改 `MindMap`） |

### 2.4 新增 · 样式（1，追加到既有单文件）

| 文件 | 路径 | 说明 |
|---|---|---|
| index.css | `src/index.css` | **追加**新区块（不删既有）：`.search-bar`/`.search-results`/`.role-dot`/`.rename-pop`/`.tag-bar`/`.tag-pill`/`.edit-pen`/`.sel-toolbar`/`.excerpt-card`/`.quota-bar`/`.kw-hl`/`.mm-drill`/`.export-menu` 等；复用既有 `--glass`/`--border`/`--radius`/`--shadow`/`--accent` 与 `.enhance-statusbar`/`.anchor-hl` 视觉；扩展 ≤720px 规则 |

### 2.5 不变（复用，逻辑零改动）

`MindMap.tsx`、`CommentaryPanel.tsx`、`useBoard.ts`、`useLiveCommentary.ts`、`meeting-service.mjs`、`asr-service.mjs`、`summary-service.mjs`、`role-service.mjs`、`commentary-service.mjs`、`board-service.mjs`、`data-store.mjs`、`llm-router.mjs`、`ws-hub.mjs`、`quota.mjs`、`mail-cli.mjs`（导出仍走既有 `/api/meetings/:id/export`，前端另加纯前端导出按钮，二者并存）。

---

## 3. 数据结构 / 接口

### 3.1 后端结构化纪要 JSON Schema 草案

`refine` 调用 DeepSeek 返回**受限 JSON**（与 mindmap/summary 同稳健解析策略），结构如下：

```jsonc
{
  "chapters": [
    {
      "id": "ch_1",
      "title": "一、Q3 预算讨论",
      "paragraphs": [
        {
          "id": "p_1",
          "text": "张总提出预算需下调，并建议分阶段执行。",
          "type": "conclusion",                 // "conclusion" | "normal"
          "sourceEntryId": "e1a2b3",            // 关联原始 speech entry id（锚点回带，首选）
          "sourceTs": "2025-07-11T03:12:00.000Z"
        },
        {
          "id": "p_2",
          "text": "大咖AI 建议分两批执行，先小步验证。",
          "type": "normal",
          "sourceEntryId": "e9z8y7",
          "sourceTs": "2025-07-11T03:30:00.000Z",
          "aiSupplement": true                  // 可选：AI 推断补充内容，前端标「AI补充」角标
        }
      ],
      "actionItems": [
        {
          "id": "a_1",
          "text": "张总周五前提交预算表",
          "owner": "张总",                      // 由 AI 推断，可空
          "due": "周五",                        // 由 AI 推断，可空
          "sourceEntryId": "e1a2b3",
          "sourceTs": "2025-07-11T03:12:00.000Z"
        }
      ]
    }
  ],
  "keywords": [ { "word": "预算", "count": 6 }, { "word": "降本", "count": 3 } ],
  "plainText": "一、Q3 预算讨论\n张总提出预算需下调…（人类可读回退全文）"
}
```

**归一化约束（后端 `normalizeRefined`）**：章节 ≤6；每章段落 ≤12；行动项 ≤10；标题 ≤24 字（超截断加「…」）；`sourceEntryId` 必须是入参 `entries` 中真实存在的 id（否则置空，走前端兜底）；`plainText` 由章节文本拼接生成，保证降级时仍可显示。

### 3.2 关键词输出格式

推荐 `{ word: string; count?: number }[]`（带词频，支撑「上/下跳转」与频率展示）。兼容纯 `string[]`（当不需要频次时）。来源：在 `refine` 同一次 LLM 调用内随结构化纪要一起返回，避免额外调用。

### 3.3 来源锚点方案（明确推荐）

- **首选（后端回带）**：`refine` 把原始 `entries`（含 `id`/`ts`/`speaker`）一并给 LLM，要求每段/每行动项标注其来源 `sourceEntryId`（即对应 speech entry 的 id）。后端 `normalizeRefined` 校验 `sourceEntryId ∈ 入参 ids`，非法则清空。
- **兜底（前端文本匹配）**：当 `sourceEntryId` 缺失时，`StructuredMinutes` 渲染来源按钮时用 `text` 子串在前端 `entries` 中做匹配，命中取最近一条；仍无则隐藏来源按钮（不影响阅读）。
- **跳回机制**：来源按钮 → `onJumpToEntry(entryId)` → `BoardRoom` 设置 `anchorEntryIds=[entryId]` + `setActiveTab('speech')`，复用既有 `TranscriptPanel` 的 `anchorEntryIds`/`anchorTs` 锚点高亮副作用（`.para.anchor-hl`）。
- 展示文案 `源自 发言区 03:12 张总`：`03:12` 用**相对会议起点**的偏移（`(entry.ts - meeting.createdAt)` 格式化为 `+MM:SS`，与导出一致）；`张总` 取 `roleLabels[roleId] ?? role.cn ?? entry.speaker`。

### 3.4 前端新增 state / props / 类型

**类型（types.ts 新增）**
```ts
export type TagKey = 'conclusion' | 'todo' | 'question' | 'highlight'
export interface RefineEntryInput {
  id: string; ts: string; type: 'speech' | 'opinion'
  text: string; roleId?: string; speaker?: string; color?: string
}
export interface MinutesParagraph {
  id: string; text: string; type: 'conclusion' | 'normal'
  sourceEntryId?: string; sourceTs?: string; aiSupplement?: boolean
}
export interface ActionItem {
  id: string; text: string; owner?: string | null; due?: string | null
  sourceEntryId?: string; sourceTs?: string
}
export interface MinutesChapter {
  id: string; title: string
  paragraphs: MinutesParagraph[]; actionItems: ActionItem[]
}
export interface Keyword { word: string; count?: number }
export interface StructuredMinutes {
  chapters: MinutesChapter[]; keywords: Keyword[]; plainText: string
}
export interface SearchResult {
  kind: 'entry' | 'minutes-paragraph' | 'mindmap-node' | 'commentary'
  label: string; targetId: string; snippet: string; ts?: string
}
// MindMapNode 增加：entryIds?: string[]
// Role 增加：isBigShot?: boolean
// RefineResponse 增加：structured?: StructuredMinutes | null
// CommentaryPanel props 增加：extraCommentaries?: Commentary[]
```

**BoardRoom / useBoardEnhancements 提升的跨面板 state**
| state | 类型 | 说明 |
|---|---|---|
| `query` / `searchResults` / `activeSearchIdx` | string / SearchResult[] / number | 全局搜索（P0-①） |
| `roleLabels` | `Record<string, string>` | 会话级重命名（P1-①），默认 `role.cn` |
| `entryTags` | `Record<string, TagKey[]>` | 条目标签（P1-④） |
| `entryEdits` | `Record<string, string>` | 行内纠错覆盖文本（P1-⑤），保留原 ts |
| `highlights` | `{ id: string; text: string; color: string }[]` | 划词高亮（P1-⑦），会话常驻 |
| `selectedEntryIds` | `Set<string>` | 摘录多选（P2-①） |
| `activeTagFilter` | `'all' | TagKey` | 标签筛选（P1-④） |
| `activeRoleFilter` | `string | null` | 占比条角色筛选（P2-②） |
| `userCommentaries` | `Commentary[]` | 划词「评论/引用」入点评流（P1-⑦），经 `extraCommentaries` 给 `CommentaryPanel` |
| `structuredRefined` / `keywords` | 来自 `enhance` | 结构化纪要 + 关键词 |
| `minutesScrollTarget` / `mindmapScrollTarget` | string | 搜索/关键词跳转目标（结构化纪要/导图） |
| （既有）`anchorEntryIds` / `anchorTs` / `activeTab` | — | 复用并扩展为统一 `jumpTo*` |

**组件内本地态（不提升）**：各新组件的展开/开关（SearchBar 下拉开合、RenamePopover 开合、TagMenu 开合、InlineEditor 开合、SelectionToolbar 位置、ExcerptCard 开合、ExportMenu 开合、MindMapDrill 开合、MobileTopDrawer 开合）。

**TranscriptPanel 新增可选 prop（默认不传 = 行为不变）**
```ts
interface TranscriptDecoration {
  dot?: { color: string; isBigShot?: boolean; initial?: string }
  renameLabel?: string
  tags?: TagKey[]
  edited?: boolean
  overrideText?: string
  selected?: boolean
  hoverActions?: ('rename' | 'tag' | 'edit' | 'select')[]
}
// 新增 props（全部可选）：
// decorations?: (entry: TranscriptEntry) => TranscriptDecoration | null
// onRename?: (id: string) => void
// onTag?: (id: string, tag: TagKey) => void
// onEdit?: (id: string, text: string) => void
// onToggleSelect?: (id: string) => void
```

### 3.5 接口契约变更

- **POST `/api/transcript/refine`**（改造）
  - 入参：`{ entries: RefineEntryInput[] }`（原 `rawText` 废弃，后端内部由 entries 重建 rawText）。
  - 响应（始终 200，以 `ok` 判定）：`{ ok, refinedText: string(=plainText 兜底), structured: StructuredMinutes | null, keywords?: Keyword[], model?, tookMs?, error?, degraded? }`。
- **POST `/api/transcript/mindmap`**（增强）：响应 `root` 的 `MindMapNode` 节点可含 `entryIds?: string[]`（叶子优先），前端 `MindMap` 不变，由 `useMindMapDrill` 读取。
- **前端 `refineTranscript(entries)`**（`lib/api.ts`）：入参改为 `RefineEntryInput[]`，解析 `structured`。
- 导出（`P1-⑧`）走**纯前端**生成，不复用/不改后端 `/api/meetings/:id/export`（二者并存，前端按钮优先满足「角色 + 相对时间戳」需求）。

---

## 4. 调用 / 渲染流程时序图（Mermaid）

完整 Mermaid 见 `docs/feishu_compete_sequence-diagram.mermaid`，包含 6 个时序：
1. **全局搜索跳转高亮**（P0-①）：输入 → `useBoardSearch` 跨四源检索 → 结果面板分组 → 点击 → `jumpTo*` 按 kind 分流（entry 复用 anchor / minutes 置 `minutesScrollTarget` / mindmap 置 `mindmapScrollTarget` / commentary 走 `handleAnchor`）。
2. **结构化纪要渲染**（P0-②）：`enhance` 拿到 `structuredRefined` → `BoardRoom` 渲染 `<StructuredMinutes>` → 章节/结论高亮/✅行动项/来源按钮/关键词区。
3. **标签筛选聚合**（P1-④）：`TagFilterBar` 选标签 → `setActiveTagFilter` → `BoardRoom` 过滤 `entries` 后传给 `TranscriptPanel`（仅渲染命中条成清单）。
4. **划词工具条**（P1-⑦）：选区 `mouseup` → `SelectionToolbar` 定位 → 高亮（写 `highlights`）/ 评论（写 `userCommentaries` → `extraCommentaries`）/ 引用（进摘录草稿）。
5. **导图节点下钻跳转**（P1-⑥）：`useMindMapDrill` DOM 委托捕获节点点击 → `MindMapDrill` 浮层列出来源 entry + 大咖观点 → 点击 → `jumpToEntry`。
6. **发言占比条计算与筛选**（P2-②）：`SpeechQuotaBar` 由 `entries` 前端算各角色时长占比 → 点击角色段 → `setActiveRoleFilter` + `jumpToRole`（过滤并滚动到该角色首条）。

---

## 5. 任务列表（有序、含依赖、按实现顺序；区分前端/后端）

> 后端仅 2 个任务（B1/B2），前端 13 个（F1–F13）。前端任务按依赖拓扑排序；标「依赖」者为前置。

| Task | 名称 | 端 | 源文件（主要） | 依赖 | 优先级 | 覆盖需求 |
|---|---|---|---|---|---|---|
| **B1** | refine 提示词改造 → 结构化纪要 JSON + 关键词 + 来源锚点 | 后端 | `transcript-service.mjs`, `api-server.mjs`, `types.ts`(契约), `lib/api.ts` | — | P0 | P0-② / P1-② / P1-③ |
| **B2** | mindmap 提示词增强 → 叶子节点回带 entryIds | 后端 | `transcript-service.mjs`, `api-server.mjs`, `types.ts` | — | P1 | P1-⑥ |
| **F0** | 契约与状态层骨架（types 扩展 + api 改造 + useTranscriptEnhance + useBoardEnhancements + TranscriptPanel 可选 decorations prop） | 前端 | `types.ts`, `lib/api.ts`, `useTranscriptEnhance.ts`, `useBoardEnhancements.ts`, `TranscriptPanel.tsx`, `BoardRoom.tsx` | B1(契约) | P0 | 基础设施，供 F1–F13 复用 |
| **F1** | 全局搜索框 + 结果面板 + 跳转高亮 | 前端 | `SearchBar.tsx`, `useBoardSearch.ts`, `BoardRoom.tsx` | F0, F2 | P0 | P0-① |
| **F2** | 结构化纪要渲染（消费 B1） | 前端 | `StructuredMinutes.tsx`, `BoardRoom.tsx` | B1, F0 | P0 | P0-② |
| **F3** | 角色配色圆点 + 会话级重命名 | 前端 | `RoleDot.tsx`, `RenamePopover.tsx`, `BoardRoom.tsx` | F0 | P1 | P1-① |
| **F4** | 来源标注 + 双向跳（消费 B1） | 前端 | `StructuredMinutes.tsx`, `BoardRoom.tsx` | B1, F2, F3 | P1 | P1-② |
| **F5** | 关键词高亮（消费 B1） | 前端 | `useKeywordHighlight.ts`, `StructuredMinutes.tsx`, `BoardRoom.tsx` | B1, F2 | P1 | P1-③ |
| **F6** | 发言区打标签 + 顶部筛选 Tab 聚合 | 前端 | `TagFilterBar.tsx`, `TagMenu.tsx`, `BoardRoom.tsx` | F0, F3 | P1 | P1-④ |
| **F7** | 行内纠错 | 前端 | `InlineEditor.tsx`, `BoardRoom.tsx` | F0, F3 | P1 | P1-⑤ |
| **F8** | 导图节点下钻（消费 B2） | 前端 | `MindMapDrill.tsx`, `useMindMapDrill.ts`, `BoardRoom.tsx` | B2, F0 | P1 | P1-⑥ |
| **F9** | 划词工具条 | 前端 | `SelectionToolbar.tsx`, `BoardRoom.tsx` | F0, F3, F6 | P1 | P1-⑦ |
| **F10** | 导出 Markdown/TXT | 前端 | `ExportMenu.tsx`, `BoardRoom.tsx` | F0, F2, F3 | P1 | P1-⑧ |
| **F11** | 文字摘录卡片 | 前端 | `ExcerptCard.tsx`, `BoardRoom.tsx` | F0, F9, F3 | P2 | P2-① |
| **F12** | 发言占比条（前端算） | 前端 | `SpeechQuotaBar.tsx`, `BoardRoom.tsx` | F0, F3 | P2 | P2-② |
| **F13** | 移动端响应式适配 | 前端 | `index.css`, `MobileTopDrawer.tsx`(可选), `BoardRoom.tsx` | F1–F12 | P2 | P2-③ |

### 各任务要点
- **B1**：改造 `buildRefineMessages` → 指令 LLM 输出 §3.1 受限 JSON（章节/结论/行动项/来源锚点/关键词）；`refine(entries, signal)` 内部重建 rawText 作为上下文，解析 `parseRefinedJson` + `normalizeRefined` 兜底；`api-server` 路由读 `body.entries`、回 `{ok, refinedText:plainText, structured, keywords}`。失败仍 200 + `degraded` + 保留原稿。
- **B2**：`buildMindmapMessages` 增加「叶子节点尽力回带 `entryIds`（对应转录 entry id）」约束；`normalizeMindmap` 透传 `entryIds`（数组上限 8）。
- **F0**：把所有跨面板 state（§3.4）收口到 `useBoardEnhancements`；`useTranscriptEnhance` 透传 `structuredRefined`/`keywords`；`TranscriptPanel` 加§3.4 可选 `decorations` 等 prop（默认不传行为不变）；`BoardRoom` 接入状态层并预留 `jumpToEntry/Role/Minutes/Mindmap`。
- **F1**：`SearchBar` 置于 topbar 中部，`⌘K` 聚焦，防抖 200ms；`useBoardSearch` 扁平化四源（entries/structuredRefined/mindmap/commentaries）输出 `SearchResult[]` 分组；点击按 `kind` 分流跳转；命中项常驻高亮至下次操作或 3s 淡出（复用 `.anchor-hl` 思路）。
- **F2**：`StructuredMinutes` 分区渲染：章节折叠标题 → 段落（结论句 `.conclusion-hl` 高亮）→ ✅行动项子区块（owner/due + 来源按钮）；顶部关键词区渲染 `keywords`。空态沿用「AI 整理版生成中…」。
- **F3**：`RoleDot` 真人灰标+首字母、大咖AI 渐变（`--bigshot-gradient`）；`decorations` 给每条 speech/opinion 返回 `dot`；`RenamePopover` 写 `roleLabels`，全域（发言区/纪要来源/导图/点评）经 `roleLabels` 映射同步显示。
- **F4**：`StructuredMinutes` 段落/行动项渲染「源自 发言区 +MM:SS 角色」按钮 → `onJumpToEntry(entryId)`；缺失 `sourceEntryId` 走文本兜底；跳回复用 `anchorEntryIds` + `setActiveTab('speech')`。AI 补充内容标「AI补充」角标。
- **F5**：点击关键词 → `setHighlightTerm` + 首跳；`useKeywordHighlight` 对发言区 `.para .text` 做 DOM `<mark class="kw-hl">` 包裹 + 上/下导航；`StructuredMinutes` 经 `highlightTerm` prop 内部高亮；导图走 `useMindMapDrill` 文本匹配。
- **F6**：`TagFilterBar` 横排 Tab（全部/结论/待办/疑问/重点）；标记经 `decorations.tags` 在条目前画彩色标签条（`--tag-conclusion` 等）；点 Tab → `activeTagFilter` 过滤 `entries` 成清单。
- **F7**：`decorations.hoverActions` 含 `edit` → hover 出 `✎` → `InlineEditor` 覆盖层（保留原 ts）→ 保存写 `entryEdits[id]`；`decorations.edited/overrideText` 渲染「已编辑」灰字，不改时间戳。
- **F8**：`useMindMapDrill` 对 `.mm-row` 做事件委托（不改 `MindMap`），捕获点击节点 → `MindMapDrill` 浮层列出 `entryIds` 来源 entry（按角色区分真人/大咖AI 配色）+ 该议题大咖观点 → 点来源 `jumpToEntry`；`entryIds` 缺失则按 `title` 匹配。
- **F9**：`SelectionToolbar` 监听发言区/结构化纪要 `mouseup` 选区 → 浮动「高亮/评论/引用」；「高亮」写 `highlights`（会话常驻）；「评论」写 `userCommentaries` 经 `CommentaryPanel.extraCommentaries`（新增可选 prop）入点评流；「引用」进摘录草稿。
- **F10**：`ExportMenu`（topbar 右侧）生成 MD/TXT：含角色（`roleLabels`/`role.cn`）+ 相对时间戳（`+MM:SS`）；内容可选「发言区」与/或「结构化纪要」。纯前端 Blob 下载，无后端改动。
- **F11**：`decorations.selectable` 给每条加选择框 → `selectedEntryIds`；选中 ≥1 浮出 `ExcerptCard` 展示选中句 + 角色 + 相对时间 → 复制 MD / 导出（复用 F10 导出逻辑）。
- **F12**：`SpeechQuotaBar`（topbar 右侧，导出前）前端算各角色时长占比（speech 条目相邻间隔累加；opinion 计入对应角色；大咖AI 置顶参与）；点击角色段 → `setActiveRoleFilter` + `jumpToRole` 过滤并滚动到该角色首条。
- **F13**：CSS ≤720px 扩展：搜索/占比/筛选收进顶部抽屉或横向滚动；核心检索/阅读/导出可用；不破坏桌面端。可辅以 `MobileTopDrawer`。

---

## 6. 依赖包

**空。** 不新增任何 npm 包。沿用现有 `react` / `react-dom` / `vite` / `typescript` 及构建链。后端无新依赖（仍原生 http+ws）。纯前端导出用浏览器原生 `Blob`/`URL.createObjectURL`，无需库。

---

## 7. 共享约定

- **CSS 变量**：所有新样式复用 `:root` 既有变量 —— 卡片底色 `var(--glass)`/`var(--glass-strong)`、边框 `var(--border)`/`var(--border-soft)`、圆角 `var(--radius)`/`--radius-sm`、阴影 `var(--shadow)`、强调色 `var(--accent)`/`--accent-2`、文字 `var(--text)`/`--text-2`/`--text-3)`。新增少量语义变量：`--bigshot-gradient`（大咖AI 专属渐变）、`--tag-conclusion`(绿)/`--tag-todo`(蓝)/`--tag-question`(黄)/`--tag-highlight`(红)、`--kw-hl`（关键词高亮底色）。**禁止硬编码颜色**。
- **玻璃拟态视觉**：新卡片/浮层（`.search-results`/`.role-dot` 容器/`.tag-bar`/`.sel-toolbar`/`.excerpt-card`/`.quota-bar`/`.export-menu`/`.mm-drill`）统一套 `background:var(--glass); border:1px solid var(--border); border-radius:var(--radius); backdrop-filter:blur(18px) saturate(140%); box-shadow:var(--shadow);`，与现有 `.smart-block`/`.commentary-panel` 一致。
- **复用既有视觉**：整理版/导图/点评状态条复用 `.enhance-statusbar`+`.enh-status`+`.enh-error`；跨标签/搜索/关键词高亮复用 `.para.anchor-hl` + `@keyframes anchorFlash` 思路（新增 `.kw-hl` 仅作常驻高亮变体）；`.smart-stack`/`.smart-block` 分区结构不变。
- **类名命名**：新增类统一语义前缀 —— 搜索 `.search-*`、角色 `.role-*`、标签 `.tag-*`、纠错 `.edit-*`、划词 `.sel-*`、摘录 `.excerpt-*`、占比 `.quota-*`、导出 `.export-*`、导图下钻 `.mm-drill*`。不污染既有类名。
- **状态提升约定**：跨面板共享状态（搜索/角色标签/条目标签/编辑/高亮/摘录/筛选/用户点评/跳转目标/结构化纪要/关键词）一律提升到 `BoardRoom`（经由 `useBoardEnhancements`）；组件内部 UI 开合态（下拉/浮层/抽屉）留在各自新组件内。
- **跳转统一入口**：所有「跳回发言区并高亮」统一走 `BoardRoom.jumpToEntry(entryId)`（内部 = 设 `anchorEntryIds` + `setActiveTab('speech')`），与既有 `handleAnchor` 共用同一锚点副作用，避免多套高亮逻辑。
- **降级一致性**：后端/前端任何失败均沿用既有「200 + `ok:false` + `degraded` + 保留原稿/历史」约定，绝不白屏。

---

## 8. 待明确事项

### 8.1 已决策（架构师拍板，见 §1.3）
1. 结构化纪要 Schema：章节 → 段落(结论/普通) + 行动项，含 `sourceEntryId`/`sourceTs`/可选 `aiSupplement`（§3.1）。
2. 关键词：后端在 `refine` 同一次调用内产出，`{word, count?}[]`。
3. 来源锚点：**后端回带 `entryId` 首选 + 前端文本兜底**。
4. 导图节点↔原文：**后端 `entryIds` 尽力回带 + 前端 `title` 文本匹配兜底**。
5. 占比条：**前端按 `entries` 计算**，无需后端聚合。
6. 持久化：**全部会话内存**，刷新/重开即重置。
7. 大咖AI：**固定视觉 + 计入角色统计 + 置顶**。
8. 移动端：**沿用 720px 单一断点**。

### 8.2 仍建议确认（A–E）
- **A. TranscriptPanel 扩展方式（唯一对「零改动」的实质偏离）**：本设计采用「可选 prop、默认不传 = 输出与原版逐字节一致」的加法式扩展（§3.4），以承载逐条圆点/标签条/编辑/选择/hover 工具条。若主理人坚持**绝对零改动**（连可选 prop 都不加），则需改为「DOM 后渲染装饰层」方案（更脆弱、滚动同步复杂）。**建议确认采用前者**。
- **B. `refinedText` 兜底保留**：建议 B1 在返回 `structured` 的同时仍回 `refinedText=plainText`（供状态条文案与极端降级）。是否保留请确认。
- **C. `mindmap` `entryIds` 风险**：LLM 可能过度回带或回带非法 id，`normalizeMindmap` 已做「仅保留入参真实 id、数组上限 8」兜底；若评估风险高可降级为「仅前端 `title` 匹配」，B2 可砍。
- **D. 导出内容范围**：建议 F10 导出「结构化纪要 + 发言区（角色+相对时间）」；是否还需包含实时点评/大咖意见请确认。
- **E. 关键词 `count` 展示**：建议展示词频并用于「上/下跳转」计数；若不需要频次可退化为 `string[]`。

### 8.3 一致性校验（对 PRD）
本设计与 PRD（`ai-board-incremental-prd.md`）P0(2) / P1(8) / P2(3) 共 13 项需求逐条对应：P0-①→F1、P0-②→B1+F2、P1-①→F3、P1-②→B1+F4、P1-③→B1+F5、P1-④→F6、P1-⑤→F7、P1-⑥→B2+F8、P1-⑦→F9、P1-⑧→F10、P2-①→F11、P2-②→F12、P2-③→F13。后端改动收敛为 B1/B2 两项，其余纯前端会话态，符合「优先不引入新依赖、复用双标签架构」总约束。
