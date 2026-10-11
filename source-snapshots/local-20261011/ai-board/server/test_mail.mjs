// server/test_mail.mjs —— 两步确认发信纯逻辑单测（Node node:test）
// 通过 mock child_process.spawn（mail-cli.__setSpawnForTest）模拟 agently-cli 的 stdout JSON，
// 覆盖：stage→confirm 主路径、配额超限、ctk 过期、CLI 缺失降级、错误码映射、收件人非法。
// 不依赖真实 agently-cli（仅云服务器存在，本地无），全部走 fake spawn。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import * as mailCli from './mail-cli.mjs'
import { quota } from './quota.mjs'
const summarySvc = await import('./summary-service.mjs')

// ===================== fake spawn（模拟 agently-cli）=====================
const fakeState = { stdout: '', exitCode: 0, error: null, noClose: false }
function setFake(partial) {
  Object.assign(fakeState, partial)
}
function makeFakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  const { stdout, exitCode, error, noClose } = fakeState
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf8'))
    process.nextTick(() => {
      if (error) child.emit('error', error)
      else if (!noClose) child.emit('close', exitCode)
    })
  })
  return child
}
// 注入为 mail-cli 的 spawn 实现
mailCli.__setSpawnForTest(() => makeFakeChild())
// 测试超时用短超时，避免等待 30s
mailCli.__setTimeoutForTest(150)

// stage 成功的 stdout JSON（含 ctk）
const STAGE_JSON = JSON.stringify({
  ok: true,
  data: {
    confirmation_required: true,
    confirmation_token: 'ctk_abc123',
    message: 'need confirm',
    summary: { action: 'send', from: 'weispace@agent.qq.com', subject: 's', to: ['a@b.com'] },
  },
})
// confirm 成功的 stdout JSON
const CONFIRM_JSON = JSON.stringify({ ok: true, data: { sent: true, message: 'sent' } })
const ENOENT = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })

function makeSummary(over = {}) {
  return {
    subject: 'AI 落地节奏',
    occurredAt: '2026-07-09T14:00:00Z',
    elements: [
      { key: 'meta', title: '会议主题与时间', content: '关于节奏', collapsed: false },
      { key: 'topics', title: '核心议题', content: '落地', collapsed: false },
    ],
    bigShots: [{ roleId: 'sj', cn: '乔布斯', title: '极致', viewpoint: '节奏优先' }],
    ...over,
  }
}
function cleanup() {
  summarySvc.__resetStoreForTest()
  quota.reset()
  summarySvc.__setTtlForTest(5 * 60 * 1000)
  setFake({ stdout: '', exitCode: 0, error: null, noClose: false })
}

// ===================== 主路径：stage → confirm =====================
test('主路径：stage 取 ctk 返回 confirmationRef+preview，confirm 真发成功', async () => {
  setFake({ stdout: STAGE_JSON, exitCode: 0 })
  const stageRes = await summarySvc.stage('m1', 'boss@example.com', makeSummary(), '逐字稿内容', null)
  assert.equal(stageRes.ok, true)
  assert.match(stageRes.confirmationRef, /^cfr_/)
  assert.ok(stageRes.preview)
  assert.equal(stageRes.preview.email, 'boss@example.com')
  assert.equal(stageRes.preview.hasAttachment, true) // 逐字稿走附件
  assert.equal(stageRes.preview.elementCount, 2)

  setFake({ stdout: CONFIRM_JSON, exitCode: 0 })
  const confirmRes = await summarySvc.confirm(stageRes.confirmationRef, null)
  assert.equal(confirmRes.ok, true)
  assert.ok(confirmRes.preview)
  // 一次性消费：再次 confirm 应已失效
  const again = await summarySvc.confirm(stageRes.confirmationRef, null)
  assert.equal(again.ok, false)
  assert.equal(again.code, 'CONFIRMATION_EXPIRED')
  cleanup()
})

// ===================== 配额超限 =====================
test('配额超限：第 51 次 confirm 返回 QUOTA_EXCEEDED', async () => {
  setFake({ stdout: STAGE_JSON, exitCode: 0 })
  const stageRes = await summarySvc.stage('m2', 'boss@example.com', makeSummary(), 't', null)
  assert.equal(stageRes.ok, true)
  // 填满配额（已 stage 但未 confirm，不影响配额；配额在 confirm 时计数）
  quota.reset()
  for (let i = 0; i < quota.DAILY_QUOTA; i++) assert.equal(quota.checkAndInc(), true)
  assert.equal(quota.remaining(), 0)
  assert.equal(quota.checkAndInc(), false) // 第 51 次被拒（直接计数层）

  setFake({ stdout: CONFIRM_JSON, exitCode: 0 })
  const confirmRes = await summarySvc.confirm(stageRes.confirmationRef, null)
  assert.equal(confirmRes.ok, false)
  assert.equal(confirmRes.code, 'QUOTA_EXCEEDED')
  cleanup()
})

// ===================== ctk 过期 =====================
test('ctk 过期：TTL 已过 → confirm 返回 CONFIRMATION_EXPIRED', async () => {
  setFake({ stdout: STAGE_JSON, exitCode: 0 })
  summarySvc.__setTtlForTest(-1000) // 立刻过期
  const stageRes = await summarySvc.stage('m3', 'boss@example.com', makeSummary(), 't', null)
  assert.equal(stageRes.ok, true)
  summarySvc.__setTtlForTest(5 * 60 * 1000) // 还原

  const confirmRes = await summarySvc.confirm(stageRes.confirmationRef, null)
  assert.equal(confirmRes.ok, false)
  assert.equal(confirmRes.code, 'CONFIRMATION_EXPIRED')
  cleanup()
})

// ===================== CLI 缺失降级 =====================
test('CLI 缺失：spawn ENOENT → stage 返回 CLI_NOT_FOUND（不白屏）', async () => {
  setFake({ error: ENOENT })
  const stageRes = await summarySvc.stage('m4', 'boss@example.com', makeSummary(), 't', null)
  assert.equal(stageRes.ok, false)
  assert.equal(stageRes.code, 'CLI_NOT_FOUND')
  assert.equal(stageRes.degraded, true)
  cleanup()
})

// ===================== 收件人非法 =====================
test('收件人非法：stage 直接返回 RECIPIENT_INVALID（未触达 CLI）', async () => {
  const stageRes = await summarySvc.stage('m5', 'not-an-email', makeSummary(), 't', null)
  assert.equal(stageRes.ok, false)
  assert.equal(stageRes.code, 'RECIPIENT_INVALID')
  cleanup()
})

// ===================== CTK_MISSING（CLI 退出码 6）=====================
test('CTK_MISSING：confirm 阶段 CLI 退出码 6 → 映射 CTK_MISSING', async () => {
  setFake({ stdout: STAGE_JSON, exitCode: 0 })
  const stageRes = await summarySvc.stage('m6', 'boss@example.com', makeSummary(), 't', null)
  assert.equal(stageRes.ok, true)
  setFake({ stdout: '', exitCode: 6 }) // confirm 时 CLI 报 ctk 缺失
  const confirmRes = await summarySvc.confirm(stageRes.confirmationRef, null)
  assert.equal(confirmRes.ok, false)
  assert.equal(confirmRes.code, 'CTK_MISSING')
  cleanup()
})

// ===================== NETWORK_ERROR（超时）=====================
test('NETWORK_ERROR：CLI 无响应超时 → 映射 NETWORK_ERROR（降级）', async () => {
  setFake({ noClose: true }) // 永不 close，触发超时
  const stageRes = await summarySvc.stage('m7', 'boss@example.com', makeSummary(), 't', null)
  assert.equal(stageRes.ok, false)
  assert.equal(stageRes.code, 'NETWORK_ERROR')
  assert.equal(stageRes.degraded, true)
  cleanup()
})

// ===================== mail-cli 退出码映射（直测）=====================
test('mail-cli 退出码映射：2→CLI_AUTH_EXPIRED / 3→RECIPIENT_INVALID / 7→CLI_NOT_FOUND', async () => {
  setFake({ stdout: '', exitCode: 2 })
  let r = await mailCli.runAgentlySend({ mode: 'confirm', email: 'a@b.com', token: 'ctk_x' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'CLI_AUTH_EXPIRED')

  setFake({ stdout: '', exitCode: 3 })
  r = await mailCli.runAgentlySend({ mode: 'confirm', email: 'a@b.com', token: 'ctk_x' })
  assert.equal(r.code, 'RECIPIENT_INVALID')

  setFake({ stdout: '', exitCode: 7 })
  r = await mailCli.runAgentlySend({ mode: 'confirm', email: 'a@b.com', token: 'ctk_x' })
  assert.equal(r.code, 'CLI_NOT_FOUND')
  cleanup()
})

// ===================== stage 解析 ctk（缺 token 兜底 CTK_MISSING）=====================
test('stage 解析：stdout 无 confirmation_token → CTK_MISSING', async () => {
  setFake({ stdout: JSON.stringify({ ok: true, data: {} }), exitCode: 0 }) // 退出 0 但无 token
  const stageRes = await summarySvc.stage('m8', 'boss@example.com', makeSummary(), 't', null)
  assert.equal(stageRes.ok, false)
  assert.equal(stageRes.code, 'CTK_MISSING')
  cleanup()
})
