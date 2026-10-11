# AI 私董会 · 会议室双标签重构 — 增量设计 + 任务拆解

> 受众：前端工程师（Carol）。本文只给设计结论与任务清单，**不含实现代码**。
> 范围：纯前端布局重组，移除 BoardRoom 中段 `.board-split` 三栏并列，改为「顶部标签栏 tab-bar + 单一内容区 tab-panel」双标签结构。无新增后端/接口，无新增依赖，复用现有组件。

---

## 1. 实现方案 + 框架选型

### 1.1 技术选型
- **无新框架、无新依赖。** 栈保持 React 19 + Vite + TypeScript（strict）。
- **状态管理**：仅用 BoardRoom 组件内 `useState`（`activeTab`）。所有业务数据仍由既有 hooks 在 BoardRoom 顶层持有（`useBoard` / `useTranscriptEnhance` / `useLiveCommentary`），切换标签只是改 `display/visibility`，**不卸载组件、不丢数据**。
- **可见性切换方案（满足 P0-8 的关键）**：两个 tab-panel **始终保持挂载（同渲染）**，用 `visibility + opacity + position:absolute` 切换可见性（而非 `display:none` 或条件渲染）。
  - 不选 `display:none`：部分浏览器在 `display:none` 切回时会重置内部滚动位置；而 `visibility:hidden` 元素仍保留在渲染树，`scrollTop` 与 React 本地态均不丢。
  - 不选「条件渲染 `{activeTab==='x' && <Panel/>}`」：会卸载 CommentaryPanel，导致其本地 UI 态（`pinned/ignored/seen/newIds`）与滚动位置被重置，违反 P0-8。
- **复用策略**：发言区直接复用 `TranscriptPanel`（`view="raw"`）；智能纪要的「整理版」块复用 `TranscriptPanel`（`view="refined"`），「思维导图」块复用 `MindMap`，「实时点评」块复用 `CommentaryPanel`。**不重写这三个组件的任何逻辑**，CSS 包裹零改动（决策见 §1.2）。

### 1.2 滚动模型决策（回答待确认问题 2）
**选定方案 (B)：智能纪要 tab-panel 为布局容器（自身不滚动），三区块各自独立内部滚动。**

理由：
1. **直接消除 P0-8 风险**：方案 (B) 下 `CommentaryPanel` 完全不改 —— 它保留既有的 `.commentary-scroll`（`flex:1; overflow-y:auto`）与全部本地 UI 态。组件不被卸载，React 态与滚动位置天然保留。
2. **实现复杂度最低、风险最小**：方案 (A) 需给 `CommentaryPanel` 增加「内容自适应高度、不内部滚动」的分支（新增 prop 或 CSS class 覆盖），并要处理「整页滚动位置在 `display:none` 切回时被重置」的问题（需 JS 保存/恢复）。方案 (B) 只需给「整理版」「思维导图」两块套一层有界高的玻璃卡片并复用其既有内部滚动容器（`.transcript` / `.mindmap` 本就 `overflow-y:auto`），**零侵入现有组件**。
3. **与现有代码风格一致**：当前三栏本就是「每栏自带内部滚动 + 独立状态条」的卡片形态，方案 (B) 等价于把这三栏从「横向并列」改为「竖向堆叠」，心智模型完全延续。

具体高度规则：
- 桌面：`.smart-stack`（flex column，`flex:1 1 auto; min-height:0`）内三块均分高度 `flex:1 1 0; min-height:0`，各自内部滚动。
- 移动端（≤720px）：三块仍独立内部滚动，给最小可滚动高度（见 §8 已决策 #5），tab-panel 不整页滚动，杜绝裁剪。

---

## 2. 文件清单及相对路径

| 文件 | 路径 | 变更 | 说明 |
|------|------|------|------|
| BoardRoom.tsx | `src/components/BoardRoom.tsx` | **修改** | 引入 `activeTab` state；移除 `.board-split` 三栏 JSX；新增 tab-bar（role=tablist）+ 两 tab-panel（同挂载、visibility 切换）；发言区复用 `TranscriptPanel`(`view="raw", refinedText=null`)；智能纪要三区块封装；改造 `handleAnchor` 联动切 tab；移除 `view`/`setView`/`effectiveView` 与「原稿/整理版」view-switch UI |
| index.css | `src/index.css` | **修改** | 移除/替换 `.board-split`/`.transcript-col`/`.mindmap-col`/`.commentary-col`/`.view-switch` 相关规则；新增 `.tab-bar`/`.tab-btn`/`.tab-body`/`.tab-panel`/`.speech-panel`/`.smart-stack`/`.smart-block`；保留并复用 `.enhance-statusbar`/`.enh-status`/`.enh-error`；新增 ≤720px 与过渡动画规则 |
| TranscriptPanel.tsx | `src/components/TranscriptPanel.tsx` | **不变（复用）** | 同时服务「发言区」(`view="raw"`) 与「整理版」块(`view="refined"`)，逻辑零改动 |
| MindMap.tsx | `src/components/MindMap.tsx` | **不变（复用）** | 智能纪要「思维导图」块直接挂载 |
| CommentaryPanel.tsx | `src/components/CommentaryPanel.tsx` | **不变（复用）** | 智能纪要「实时点评」块直接挂载，本地 UI 态与滚动位置因「同挂载」天然保留 |
| useBoard.ts / useTranscriptEnhance.ts / useLiveCommentary.ts | `src/hooks/*` | **不变** | BoardRoom 已在顶层持有全部数据，切 tab 不触发任何 hook 重建，数据不丢 |

> 变更文件仅 **2 个**（BoardRoom.tsx + index.css），严格符合「≤6 个文件」「复用现有组件、不重写逻辑」约束。

---

## 3. 数据结构 / 接口

### 3.1 新增类型（定义在 BoardRoom.tsx 内，局部类型即可）
```ts
// 标签键：发言区 / 智能纪要
type TabKey = 'speech' | 'summary'
```

### 3.2 BoardRoom 状态变更
| 状态 | 变更 | 说明 |
|------|------|------|
| `activeTab` | **新增** `useState<TabKey>('speech')` | 默认进发言区（P0-8）；两 tab-panel 据此切换可见性 |
| `view` / `setView` / `effectiveView` | **移除** | 原稿/整理版切换入口整体下掉（P0-2/P0-4）；发言区恒为 raw |
| `anchorEntryIds` / `anchorTs` / `handleAnchor` | **保留并改造** | `handleAnchor` 签名不变 `(c: Commentary) => void`，内部新增 `setActiveTab('speech')`（P0-10） |

### 3.3 组件 props 对接表（仅声明，不实现）
| 位置 | 组件 | props（相比现状） |
|------|------|-------------------|
| 发言区 tab-panel | `TranscriptPanel` | `view="raw"`（写死）、`refinedText={null}`（写死）、`entries`/`interim`/`anchorEntryIds`/`anchorTs` 不变；**移除** view-switch 相关渲染 |
| 智能纪要 · 整理版块 | `TranscriptPanel` | `view="refined"`、`refinedText={refinedText}`、`entries={[]}`、`interim=""`；外层套 `.smart-block` + 状态条 |
| 智能纪要 · 思维导图块 | `MindMap` | `root={mindmap}`（不变）；外层套 `.smart-block` + 状态条 |
| 智能纪要 · 实时点评块 | `CommentaryPanel` | `meetingId`/`commentaries={mergedCommentaries}`/`commentaryEnabled`/`collecting={live.collecting}`/`error={live.error}`/`onToggle={setCommentaryEnabled}`/`onAnchor={handleAnchor}`（全部不变）；直接挂载，外层无需额外卡片（组件自身已是玻璃卡片） |

### 3.4 类图（Mermaid）
详见 `docs/two-tab-class-diagram.mermaid`，要点：
- `BoardRoom` 持有 `activeTab` 与 `handleAnchor`，**同时**渲染两个 `TranscriptPanel`（发言区 raw / 整理版 refined）、一个 `MindMap`、一个 `CommentaryPanel`。
- `CommentaryPanel` 通过 `onAnchor → handleAnchor` 回连 `BoardRoom`；其本地态 `pinned/ignored/seen/newIds` 标注为私有，因「同挂载」跨标签保留。

---

## 4. 调用 / 渲染流程时序图（Mermaid）

详见 `docs/two-tab-sequence-diagram.mermaid`，包含 4 个时序：
1. **标签切换**：用户点击/键盘选中 tab → `setActiveTab` → 两 panel 同挂载、仅切 `visibility/opacity`（数据/本地态不丢）。
2. **发言区渲染**：`BoardRoom` 渲染 `TranscriptPanel(view="raw", refinedText=null, …)` → `buildParagraphs` 合并 speech+opinion 按 ts 升序 → 输出段落流 + interim「正在识别…」提示；`anchorEntryIds` 变化时触发高亮滚动副作用。
3. **智能纪要三区块渲染**：`BoardRoom` 渲染 `.smart-stack` → 整理版块（`TranscriptPanel` refined + 状态条）、思维导图块（`MindMap` + 状态条）、实时点评块（`CommentaryPanel` onAnchor=handleAnchor），三者各自独立内部滚动。
4. **跨标签定位（P0-10）**：用户在智能纪要点击「@关联·定位」→ `CommentaryPanel` 调 `onAnchor(c)` → `handleAnchor` 设 `activeTab='speech'` + `anchorEntryIds/anchorTs` → 发言区变为可见 → `TranscriptPanel` 锚点副作用 `scrollIntoView` + `.anchor-hl` 高亮。

---

## 5. 任务列表（有序、含依赖、按实现顺序）

> 共 5 个任务（符合任务数上限；若需更细粒度，可将 T4 拆「响应式 / 过渡」、T5 独立「可访问性」，但本方案合并以保持粒度合理）。每个任务均落在 BoardRoom.tsx 与/或 index.css（增量变更仅此 2 文件，故「单任务至少 3 文件」的硬下限在本增量场景下自然放宽）。

| Task | 名称 | 源文件 | 依赖 | 优先级 | 覆盖需求 |
|------|------|--------|------|--------|----------|
| **T1** | 双标签骨架 + 发言区 | `BoardRoom.tsx`, `index.css` | — | P0 | P0-1 / P0-2 / P0-3 / P0-8 / P0-9 |
| **T2** | 智能纪要三区块封装（滚动模型 B） | `BoardRoom.tsx`, `index.css` | T1 | P0 | P0-4 / P0-5 / P0-6 / P0-7 / P1-3 |
| **T3** | handleAnchor 跨标签联动 | `BoardRoom.tsx` | T2 | P0 | P0-10 |
| **T4** | 响应式与过渡动画 | `index.css` | T1, T2 | P1 | P1-2 / P1-4 |
| **T5** | 可访问性（role=tab / aria / 键盘） | `BoardRoom.tsx`, `index.css` | T1, T4 | P1 | P1-1 |

### 各任务要点
- **T1（双标签骨架 + 发言区）**
  - BoardRoom：新增 `activeTab`；删除 `.board-split` 三栏 JSX 与 `view`/`effectiveView`/`view-switch`；新增 `<div role="tablist" className="tab-bar">` 两个 `<button role="tab">`；新增 `.tab-body` 内含两个 `.tab-panel`（均渲染，靠 visibility 切换）；发言区渲染 `<TranscriptPanel view="raw" refinedText={null} …/>`。
  - index.css：新增 `.tab-bar`/`.tab-btn`/`.tab-body`/`.tab-panel`/`.speech-panel`；删除 `.board-split`/`.transcript-col`/`.mindmap-col`/`.commentary-col`/`.view-switch`。
  - 不变项校验：topbar / controls / BigShotBar / NewBigShotModal 结构原样保留（P0-9）。
- **T2（智能纪要三区块）**
  - BoardRoom：渲染 `.smart-stack` → ① 整理版块 = `.smart-block`(状态条 + `<TranscriptPanel view="refined" refinedText={refinedText} entries={[]} interim=""/>`)；② 思维导图块 = `.smart-block`(状态条 + `<MindMap root={mindmap}/>`)；③ 实时点评块 = `<CommentaryPanel … onAnchor={handleAnchor}/>`（直接挂载）。
  - 状态条文案复用既有 `fmtTime` + `.enhance-statusbar`/`.enh-status`/`.enh-error`（整理版用 `refining/lastRefineAt/refineError`；思维导图用 `mindmapping/lastMindmapAt/mindmapError`）。
  - **空态文案逐字对齐（P0-5，产品已钉死，不新造措辞）**：
    - 整理版块空态须为 **「AI 整理版生成中…」**。注意：复用 `TranscriptPanel(view="refined")` 时其既有空态为「（整理版生成中…）」，与 PRD 不一致 —— **T2 内必须对齐**：在 `TranscriptPanel` 的 refined 空态字符串改为「AI 整理版生成中…」（仅改该一处文案，逻辑不变），或在整理版块外层覆盖展示。两者取其一，目标文案逐字一致。
    - 思维导图块空态沿用 `MindMap` 自带「暂无思维导图，会议进行数分钟后将自动生成」（不改）。
    - 实时点评块空态沿用 `CommentaryPanel` 现有「会议进行中，实时点评将自动出现在这里…」（不改）。
  - 滚动模型 B：三块 `flex:1 1 0; min-height:0`，各自内部滚动（复用 `.transcript`/`.mindmap`/`.commentary-scroll` 既有 `overflow-y:auto`）。
- **T3（handleAnchor 联动）**
  - `handleAnchor` 内于设置 `anchorEntryIds/anchorTs` 之后新增 `setActiveTab('speech')`；沿用既有 2600ms 定时清除。因两 panel 同挂载，设 `activeTab='speech'` 与设锚点在同一批渲染提交，发言区变为可见后 `TranscriptPanel` 锚点副作用即可 `scrollIntoView` 高亮（必要时用 `requestAnimationFrame` 兜底确保可见后再滚）。
- **T4（响应式 + 过渡）**
  - ≤720px：`.tab-bar` 与 `.tab-panel` 自适应（**绝不出现三栏**）；三块维持独立内部滚动并给最小高度（见 §8.1 #5：160/200/220px）。
  - **移动端 tab-bar（P1-2，产品已定稿）**：`white-space:nowrap` + 两标签常驻（等宽或左对齐），**绝不隐藏任一标签**；极窄屏允许 `.tab-bar` 内部 `overflow-x:auto` 横向滚动，不允许换行隐藏。
  - **过渡动画（P1-4，产品已定稿）**：纯视觉、不触发数据重取；时长 **≤250ms、`ease-out`**。`.tab-panel` 切可见时 `opacity` 0→1（可加 ≤6px 微位移），`.tab-btn` 激活态 `background` 过渡。建议取 150–220ms。
- **T5（可访问性）**
  - `.tab-bar` → `role="tablist"`；按钮 → `role="tab"` + `aria-selected` + `aria-controls`；panel → `role="tabpanel"` + `aria-labelledby`。
  - **隐藏 panel 的焦点/读屏处理（产品已定稿）**：`visibility:hidden` 已使隐藏 panel 子树不可聚焦、不被读屏宣报；配合 `aria-hidden="true"` 即可满足「隐藏 tab 不进 Tab 序 / 不宣报」。仍建议在现代浏览器额外加 `inert` 以彻底防焦点（非激活 panel）。无需 `tabIndex={-1}` 手动管理。
  - 键盘：tablist `onKeyDown` 支持 `ArrowLeft/ArrowRight/Home/End` 移动选中并聚焦对应按钮；按钮 `:focus-visible` 明显描边。

---

## 6. 依赖包列表

**空。** 不新增任何 npm 包。沿用现有 `react` / `react-dom` / `vite` / `typescript` 等。

---

## 7. 共享约定

- **CSS 变量**：所有新样式复用 `:root` 既有变量 —— 卡片底色 `var(--glass)`/`var(--glass-strong)`、边框 `var(--border)`/`var(--border-soft)`、圆角 `var(--radius)`/`var(--radius-sm)`、阴影 `var(--shadow)`、强调色 `var(--accent)`/`var(--accent-2)`、文字 `var(--text)`/`var(--text-2)`/`var(--text-3)`。禁止硬编码颜色。
- **玻璃拟态视觉**：新卡片（`.tab-bar`/`.smart-block`）统一套 `background:var(--glass); border:1px solid var(--border); border-radius:var(--radius); backdrop-filter:blur(18px) saturate(140%); box-shadow:var(--shadow);`，与现有 `.mindmap-col`/`.commentary-panel` 一致。
- **状态条复用**：整理版/思维导图块顶部直接复用 `.enhance-statusbar` + `.enh-status` + `.enh-error`，文案与现有三栏状态条保持一致（整理中…/最近整理于 HH:MM/尚未整理；导图生成中…/更新于 HH:MM/暂无导图）。
- **类名命名**：新增类统一加语义前缀 —— 标签相关 `.tab-*`、智能纪要堆叠 `.smart-stack`、单区块卡片 `.smart-block`。不污染既有类名。
- **区块分割**：智能纪要三区块之间用 `.smart-stack` 的 `gap:14px` + 各自玻璃卡片实现清晰卡片分割（满足 P1-3）。
- **interim 提示**：发言区保留「正在识别…」文案，沿用 `TranscriptPanel` 既有 `.interim-hint` 样式（P0-3）。
- **锚点高亮**：跨标签定位高亮沿用既有 `.para.anchor-hl` + `@keyframes anchorFlash`（无需新增）。

---

## 8. 待明确事项

### 8.1 已决策（回答待确认问题 1–5）
1. **三区块顺序**：确认为 **整理版 → 思维导图 → 实时点评**（保持 PRD 默认）。
2. **滚动模型 + CommentaryPanel 本地态冲突**：选定 **方案 (B)** —— 智能纪要 tab-panel 自身不滚动，三区块各自独立内部滚动；`CommentaryPanel` 零改动，本地 UI 态与滚动位置因「两 panel 同挂载（visibility 切换）」天然保留。技术理由见 §1.2。
3. **跨标签定位（P0-10）**：`handleAnchor` 签名保持不变 `(c: Commentary) => void`，**内部在设置 `anchorEntryIds/anchorTs` 之后追加 `setActiveTab('speech')`**。配合「同挂载」机制，发言区在提交后变为可见，`TranscriptPanel` 锚点副作用随即 `scrollIntoView` + `.anchor-hl` 高亮。必要时用 `requestAnimationFrame` 确保在可见态后滚动。
4. **发言区是否保留「查看 AI 整理版 →」跳转按钮**：**确认完全移除**。发言区恒为 `TranscriptPanel(view="raw", refinedText=null)`，不再暴露任何通往整理版的入口；整理版仅能在「智能纪要」标签内查看（符合 PRD 默认）。
5. **移动端（≤720px）各区块 min-height**：确认数值 —— **整理版 160px / 思维导图 200px / 实时点评 220px**（点评沿用现有 `.commentary-col` 的 220px 基线）。三块独立内部滚动，tab-panel 不整页滚动，故任何视口高度下均不被裁剪。

### 8.2 原「仍建议确认项」—— 已据产品输入定稿（均不阻塞实现）
> 以下 4 项原在 §8.2 列为待确认，产品负责人已于本轮逐一给出输入，现全部定稿并同步回 T2/T4/T5 任务要点，不再阻塞实现。原 PRD 的 P2-2（持久化）也一并归入 PRD §5.2 次要项。

- **空态文案精确度（已定稿）**：逐字对齐 PRD，不新造措辞 —— 整理版块「AI 整理版生成中…」(P0-5)、思维导图块沿用 `MindMap` 自带「暂无思维导图，会议进行数分钟后将自动生成」、实时点评块沿用 `CommentaryPanel` 现有文案。整理版块因复用 `TranscriptPanel(view="refined")` 的既有空态为「（整理版生成中…）」，T2 内需对齐该一处字符串（逻辑不变）。详见 T2 要点。
- **过渡动画时长（已定稿）**：≤250ms、`ease-out`、纯视觉（不触发数据重取），对应 P1-4。详见 T4 要点。
- **移动端 tab-bar 换行（已定稿）**：`nowrap` + 两标签常驻（等宽或左对齐），极窄屏允许横向滚动，**绝不隐藏任一标签**，对应 P1-2。详见 T4 要点。
- **`inert` 兼容性（已定稿）**：`visibility:hidden` + `aria-hidden="true"` 已满足「隐藏 tab 不进 Tab 序 / 不宣报」；现代浏览器仍建议额外加 `inert` 彻底防焦点，无需 `tabIndex={-1}` 手动管理。详见 T5 要点。

### 8.3 一致性校验（对 PRD）
- 本设计已与产品更新后的 PRD（`prd_boardroom_two_tab.md` §5.1 已确认决策 / §5.2 仍待确认次要）逐条核对：5 项主决策一致；原 §8.2 四项与 P1-2/P1-4 均落实；无需求回退。后续若 PRD 再变更，由产品负责人同步、架构据此修订本文。
