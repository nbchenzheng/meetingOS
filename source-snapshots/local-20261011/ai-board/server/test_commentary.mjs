// server/test_commentary.mjs —— 会中实时点评纯逻辑单测（Node node:test）
// 覆盖（零额外 LLM，纯启发式）：
//  - 话题切换检测：mindmap 顶层分支 diff 主信号 → 触发大咖点评 + WS 推送 commentary（形状与前端契约一致）
//  - 相同分支不重复触发（变更检测）
//  - commentaryEnabled=false → 记录分支但不生成
//  - 频率上限 BIGSHOT_FREQ_CAP=20 → 达上限不再生成
//  - 去重：冷却后同大咖相似文本（bigram Dice>0.6）→ 跳过
// 通过 mock meeting/board/role/ws-hub（零网络）驱动 commentary-service。
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// —— 内存桩：meeting-service ——
const store = new Map()
const addCounts = new Map()
const meetingSvcMock = {
  getMeeting: (id) => store.get(id) || null,
  getCommentaries: (id) => store.get(id)?.commentaries || [],
  addCommentary: (id, c) => {
    const m = store.get(id)
    if (!m) return null
    m.commentaries.push(c)
    addCounts.set(id, (addCounts.get(id) || 0) + 1)
    return c
  },
  setMindmapTopBranches: (id, b) => {
    const m = store.get(id)
    if (m) m.mindmapTopBranches = b
  },
  transcriptText: () => 'transcript text',
  updateMeeting: () => {},
  createMeeting: () => ({}),
  addTranscript: () => null,
  addOpinion: () => null,
}

const FIXED_TEXT = '节奏比完美更重要，建议先小步快跑验证假设'
const boardSvcMock = {
  pickForCommentary: ({ roles }) => (roles && roles.length ? [roles[0].id] : []),
  speakForMeeting: async function* () {
    yield FIXED_TEXT
  },
}

const roleSvcMock = {
  getRole: (id) => ({ id, cn: '测试大咖', title: 'T', color: '#f00', model: 'local', focus: [], provider: 'local' }),
}

const wsBroadcasts = []
const wsHubMock = {
  register: () => {},
  unregister: () => {},
  broadcast: (sessionId, payload) => {
    wsBroadcasts.push({ sessionId, payload })
  },
  connectionCount: () => 0,
}

mock.module('./meeting-service.mjs', { namedExports: meetingSvcMock })
mock.module('./board-service.mjs', { namedExports: boardSvcMock })
mock.module('./role-service.mjs', { namedExports: roleSvcMock })
mock.module('./ws-hub.mjs', { namedExports: wsHubMock })

const cSvc = await import('./commentary-service.mjs')

// 微任务冲刷：onTopicSwitch 内部 fireBigShot 为异步（未 await），需等其落库/广播
function flush() {
  return new Promise((resolve) => {
    let n = 0
    const tick = () => {
      if (n++ > 50) return resolve()
      Promise.resolve().then(tick)
    }
    tick()
  })
}

function newMeeting(id, opts = {}) {
  const m = {
    id,
    title: 'M',
    brief: '',
    roleIds: opts.roleIds ?? ['r1'],
    materials: [],
    transcript: opts.transcripts ?? [{ id: 'e1', ts: '2026-07-09T14:00:00Z', text: 'x' }],
    opinions: [],
    createdAt: '2026-07-09T14:00:00Z',
    commentaryEnabled: opts.enabled ?? true,
    mindmapTopBranches: [],
    commentaries: opts.commentaries ?? [],
  }
  store.set(id, m)
  return m
}

const TYPES = ['highlight', 'risk', 'clarify', 'suggestion']

test('onTopicSwitch: 新分支 diff → 触发大咖点评并 WS 推送 commentary（形状与前端契约一致）', async () => {
  const id = 'cm1'
  newMeeting(id)
  wsBroadcasts.length = 0
  cSvc.onTopicSwitch(id, ['A', 'B', 'C'])
  await flush()
  assert.equal(wsBroadcasts.length, 1)
  const msg = wsBroadcasts[0].payload
  assert.equal(msg.type, 'commentary')
  const c = msg.commentary
  assert.equal(c.source, 'bigshot')
  assert.equal(c.roleId, 'r1')
  assert.equal(c.roleCn, '测试大咖')
  assert.equal(c.color, '#f00')
  assert.ok(TYPES.includes(c.type))
  assert.ok(c.text && c.text.length > 0)
  assert.ok(c.ts && c.anchorTs)
  assert.deepEqual(c.anchorEntryIds, ['e1'])
  assert.equal(c.trigger, 'auto')
  assert.equal(c.importance, 2)
  // 前端 Commentary 契约关键字段齐全
  for (const k of ['id', 'source', 'type', 'text', 'ts', 'anchorTs', 'anchorEntryIds', 'trigger']) {
    assert.ok(k in c, `commentary 缺少字段 ${k}`)
  }
})

test('onTopicSwitch: 相同分支不重复触发（变更检测）', async () => {
  const id = 'cm1' // 复用：再次相同分支不应再广播
  const before = wsBroadcasts.length
  cSvc.onTopicSwitch(id, ['A', 'B', 'C'])
  await flush()
  assert.equal(wsBroadcasts.length, before) // 无新增
})

test('onTopicSwitch: commentaryEnabled=false → 记录分支但不生成', async () => {
  const id = 'cm2'
  newMeeting(id, { enabled: false })
  wsBroadcasts.length = 0
  cSvc.onTopicSwitch(id, ['X', 'Y'])
  await flush()
  assert.equal(wsBroadcasts.length, 0)
})

test('频率上限: 已达 BIGSHOT_FREQ_CAP(20) → 不再生成', async () => {
  const id = 'cm3'
  const seed = Array.from({ length: 20 }, (_, i) => ({
    id: 'c' + i,
    source: 'bigshot',
    type: 'highlight',
    text: 't',
    ts: '2026-07-09T14:00:00Z',
    anchorTs: 'x',
    trigger: 'auto',
  }))
  newMeeting(id, { commentaries: seed })
  wsBroadcasts.length = 0
  cSvc.onTopicSwitch(id, ['P', 'Q'])
  await flush()
  assert.equal(wsBroadcasts.length, 0)
  assert.equal(addCounts.get(id) || 0, 0)
})

test('去重: 冷却后同大咖相似文本 → 跳过（bigram Dice>0.6）', async () => {
  mock.timers.enable({ now: Date.now() })
  try {
    const id = 'cm4'
    newMeeting(id)
    wsBroadcasts.length = 0
    cSvc.onTopicSwitch(id, ['A']) // 第一次生成
    await flush()
    assert.equal(wsBroadcasts.length, 1)
    // 推进 61s 绕过 60s 冷却 + 60s 最小间隔
    mock.timers.setTime(Date.now() + 61_000)
    cSvc.onTopicSwitch(id, ['B']) // 不同分支→changed；同大咖+相似文本→去重跳过
    await flush()
    assert.equal(wsBroadcasts.length, 1) // 仍只有 1 条
    assert.equal(addCounts.get(id), 1)
  } finally {
    mock.timers.reset()
  }
})

test('常量契约: 关键阈值与架构 §8.4 一致', () => {
  assert.equal(cSvc.BIGSHOT_FREQ_CAP, 20)
  assert.equal(cSvc.BIGSHOT_DEDUP_MS, 900_000)
  assert.equal(cSvc.COMMENTARY_MIN_GAP_MS, 60_000)
  assert.equal(cSvc.COMMENTARY_TOPIC_COOLDOWN_MS, 60_000)
  assert.ok(Array.isArray(cSvc.TRANSITION_PHRASES) && cSvc.TRANSITION_PHRASES.includes('接下来'))
})
