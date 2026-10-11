// server/test_summary.mjs —— 邮件功能纯逻辑单测（Node node:test）
// 覆盖：summarize 六要素兜底（normalizeElements 漏项恒返 6 项）、normalizeMindmap、
// normalizeCommentaryType、liveCommentary（含 randomUUID 真实缺陷复现 + 修复模拟）。
// 通过 mock llm-router（零网络）驱动 summarize / liveCommentary。
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// —— 用假 streamDeepSeek 替换真实 LLM（零网络、零密钥）——
let fakeLlmText = ''
mock.module('./llm-router.mjs', {
  namedExports: {
    streamDeepSeek: async function* () {
      yield fakeLlmText
    },
  },
})

const svc = await import('./transcript-service.mjs')

function setLlm(text) {
  fakeLlmText = text
}
function makeMeta(over = {}) {
  return {
    meetingId: 'm',
    title: 'AI 落地节奏',
    createdAt: '2026-07-09T14:00:00Z',
    bigShots: [{ id: 'sj', cn: '乔布斯', title: '极致' }],
    ...over,
  }
}

// ===================== normalizeMindmap（导出）=====================
test('normalizeMindmap: 空/非法节点返回 null', () => {
  assert.equal(svc.normalizeMindmap(null), null)
  assert.equal(svc.normalizeMindmap({}), null)
  assert.equal(svc.normalizeMindmap({ title: '   ' }), null)
  assert.equal(svc.normalizeMindmap('x'), null)
  assert.equal(svc.normalizeMindmap([]), null)
})

test('normalizeMindmap: 标题超 24 字截断并加 …', () => {
  const longTitle = '一二三四五六七八九十一二三四五六七八九十一二三四五六'
  const n = svc.normalizeMindmap({ title: longTitle, children: [] })
  assert.equal(n.title.length, 25) // 24 + '…'
  assert.ok(n.title.endsWith('…'))
})

test('normalizeMindmap: 每层 children 最多 8 个', () => {
  const kids = Array.from({ length: 12 }, (_, i) => ({ title: `c${i}` }))
  const n = svc.normalizeMindmap({ title: 'r', children: kids })
  assert.equal(n.children.length, 8)
})

test('normalizeMindmap: 深度超过 4 层丢弃更深 children', () => {
  const deep = {
    title: 'd0',
    children: [{ title: 'd1', children: [{ title: 'd2', children: [{ title: 'd3', children: [{ title: 'd4', children: [{ title: 'd5' }] }] }] }] }],
  }
  const n = svc.normalizeMindmap(deep)
  // d4 处于 depth 4 → 不再递归，d5 被丢弃
  const d4 = n.children[0].children[0].children[0].children[0]
  assert.equal(d4.children.length, 0)
})

// ===================== summarize 六要素兜底（normalizeElements）=====================
test('summarize: LLM 漏要素 → 恒返 6 项（缺失项补默认标题+空内容）', async () => {
  setLlm(JSON.stringify({
    subject: 'AI 落地节奏',
    occurredAt: '2026-07-09T14:00:00Z',
    elements: [
      { key: 'meta', title: '会议主题与时间', content: '关于节奏' },
      { key: 'topics', title: '核心议题', content: '落地' },
      { key: 'conclusions', title: '关键结论与决策', content: '先小步' },
    ],
    bigShots: [{ roleId: 'sj', cn: '乔布斯', title: '极致', viewpoint: '节奏优先' }],
  }))
  const r = await svc.summarize([], makeMeta(), null)
  assert.ok(r)
  assert.equal(r.elements.length, 6)
  assert.deepEqual(r.elements.map((e) => e.key), ['meta', 'topics', 'conclusions', 'actions', 'views', 'thread'])
  const actions = r.elements.find((e) => e.key === 'actions')
  assert.equal(actions.content, '')
  assert.equal(actions.title, '行动项 / 待办') // ELEMENT_DEFS 默认标题
  assert.equal(actions.collapsed, false)
})

test('summarize: elements 为空数组 → 仍返 6 项', async () => {
  setLlm(JSON.stringify({ subject: 'X', elements: [], bigShots: [] }))
  const r = await svc.summarize([], makeMeta(), null)
  assert.equal(r.elements.length, 6)
})

test('summarize: 缺 elements 字段 → 仍返 6 项', async () => {
  setLlm(JSON.stringify({ subject: 'X', bigShots: [] }))
  const r = await svc.summarize([], makeMeta(), null)
  assert.equal(r.elements.length, 6)
})

test('summarize: 含未知 key → 仅保留 6 个定义项', async () => {
  setLlm(JSON.stringify({ subject: 'X', elements: [{ key: 'meta', content: 'a' }, { key: 'foo', content: 'b' }], bigShots: [] }))
  const r = await svc.summarize([], makeMeta(), null)
  assert.equal(r.elements.length, 6)
  assert.ok(!r.elements.some((e) => e.key === 'foo'))
})

test('summarize: 标题占位「未命名私董会」→ 回退默认主题', async () => {
  setLlm(JSON.stringify({ subject: '未命名私董会', elements: [], bigShots: [] }))
  const r = await svc.summarize([], makeMeta({ title: '未命名私董会' }), null)
  assert.equal(r.subject, 'AI大咖会议私董会')
})

test('summarize: 缺标题 → 回退默认主题', async () => {
  setLlm(JSON.stringify({ subject: '', elements: [], bigShots: [] }))
  const r = await svc.summarize([], makeMeta({ title: '' }), null)
  assert.equal(r.subject, 'AI大咖会议私董会')
})

test('summarize: 大咖白名单兜底——LLM 漏某预设大咖仍保留条目', async () => {
  setLlm(JSON.stringify({ subject: 'X', elements: [], bigShots: [] })) // LLM 没返回任何 bigShot
  const r = await svc.summarize([], makeMeta({ bigShots: [{ id: 'sj', cn: '乔布斯', title: '极致' }, { id: 'mg', cn: '马斯克', title: '第一性' }] }), null)
  assert.equal(r.bigShots.length, 2)
  const mg = r.bigShots.find((b) => b.roleId === 'mg')
  assert.equal(mg.viewpoint, '本次会议未见其明确观点')
})

// ===================== normalizeCommentaryType（导出）=====================
test('normalizeCommentaryType: 非法/缺失 → 回退 highlight', () => {
  assert.equal(svc.normalizeCommentaryType('bogus'), 'highlight')
  assert.equal(svc.normalizeCommentaryType(undefined), 'highlight')
  assert.equal(svc.normalizeCommentaryType('risk'), 'risk')
})

// ===================== liveCommentary（导出）=====================
test('liveCommentary: rawText 为空 → 返回 null（不报错）', async () => {
  const r = await svc.liveCommentary('   ', {}, null)
  assert.equal(r, null)
})

// —— 缺陷已修复：transcript-service.mjs 顶部已 import { randomUUID } from 'node:crypto' ——
test('liveCommentary: 合法输入返回 Commentary 且 anchorEntryIds 透传（randomUUID 缺陷已修复）', async () => {
  setLlm(JSON.stringify({ type: 'suggestion', text: '建议先小步快跑验证假设' }))
  const r = await svc.liveCommentary('我们讨论落地节奏', { trigger: 'topic', anchorEntryIds: ['e1', 'e2'] }, null)
  assert.ok(r)
  assert.equal(r.source, 'llm')
  assert.equal(r.type, 'suggestion')
  assert.equal(r.text, '建议先小步快跑验证假设')
  assert.deepEqual(r.anchorEntryIds, ['e1', 'e2'])
  assert.equal(r.trigger, 'topic')
  // id 由 randomUUID().slice(0,8) 生成
  assert.match(r.id, /^[0-9a-f]{8}$/)
})

// —— 修复模拟：补齐 globalThis.randomUUID 后函数本身正确（证明唯一缺陷即缺 import）——
test('liveCommentary(修复模拟): 补齐 randomUUID 后返回 Commentary 且 anchorEntryIds 透传', async () => {
  const crypto = await import('node:crypto')
  const saved = globalThis.randomUUID
  globalThis.randomUUID = crypto.randomUUID
  try {
    setLlm(JSON.stringify({ type: 'risk', text: '注意节奏过快可能踩坑需要谨慎' }))
    const r = await svc.liveCommentary('风险点在于节奏', { trigger: 'timer', anchorEntryIds: ['e9'] }, null)
    assert.ok(r)
    assert.equal(r.source, 'llm')
    assert.equal(r.type, 'risk')
    assert.equal(r.text, '注意节奏过快可能踩坑需要谨慎')
    assert.deepEqual(r.anchorEntryIds, ['e9'])
    assert.equal(r.trigger, 'timer')
    // 正文截断到 80 字
    const longText = '字'.repeat(120)
    setLlm(JSON.stringify({ type: 'suggestion', text: longText }))
    const r2 = await svc.liveCommentary('x', { trigger: 'timer' }, null)
    assert.ok(r2.text.length <= 80)
  } finally {
    if (saved === undefined) delete globalThis.randomUUID
    else globalThis.randomUUID = saved
  }
})
