// src/lib/api.test.ts —— 前端 API 层占位行为 + 降级（零真实网络）
// 验证：
//  - sendSummary / confirmSendSummary 返回 NOT_IMPLEMENTED 占位，且从不发起任何 fetch（不调 CLI/网络）
//  - generateSummary / liveCommentary 在 fetch 失败时本地降级（不白屏、保留历史）
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// 注册扩展名解析钩子（让 Node ESM 能像 Vite 一样解析 extensionless 的 .ts 导入）
register('../../scripts/ts-resolve-loader.mjs', import.meta.url)

const fetchCalls: unknown[][] = []
const fakeFetch = (async (...args: unknown[]) => {
  fetchCalls.push(args)
  throw new Error('network')
}) as unknown as typeof fetch
;(globalThis as { fetch?: unknown }).fetch = fakeFetch

const api = await import('./api.ts')

// 模拟「后端返回成功 JSON」的 fetch（api.ts 调用 res.json()）
function jsonFetch(json: unknown) {
  ;(globalThis as { fetch?: unknown }).fetch = (async (...args: unknown[]) => {
    fetchCalls.push(args)
    return { ok: true, json: async () => json }
  }) as unknown as typeof fetch
}

test('sendSummary: 网络失败 → 本地降级 NETWORK_ERROR（不白屏），且确实发起了请求', async () => {
  fetchCalls.length = 0
  const r = await api.sendSummary({ meetingId: 'm', email: 'a@b.com', level: 'detailed' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NETWORK_ERROR')
  assert.equal(r.degraded, true)
  assert.equal(fetchCalls.length, 1) // 确实请求了 /api/summary/send，不再占位
})

test('confirmSendSummary: 网络失败 → 本地降级 NETWORK_ERROR', async () => {
  fetchCalls.length = 0
  const r = await api.confirmSendSummary({ confirmationRef: 'cfr_x' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NETWORK_ERROR')
  assert.equal(r.degraded, true)
  assert.equal(fetchCalls.length, 1)
})

test('sendSummary: 后端返回 ok+confirmationRef+preview → 透传', async () => {
  jsonFetch({
    ok: true,
    confirmationRef: 'cfr_abc',
    preview: { email: 'a@b.com', subject: 's', elementCount: 6, hasAttachment: true, sizeHintBytes: 100 },
  })
  const r = await api.sendSummary({ meetingId: 'm', email: 'a@b.com', level: 'detailed' })
  assert.equal(r.ok, true)
  assert.equal(r.confirmationRef, 'cfr_abc')
  assert.equal(r.preview?.hasAttachment, true)
})

test('confirmSendSummary: 后端返回 ok → 透传 preview', async () => {
  jsonFetch({
    ok: true,
    preview: { email: 'a@b.com', subject: 's', elementCount: 6, hasAttachment: true, sizeHintBytes: 100 },
  })
  const r = await api.confirmSendSummary({ confirmationRef: 'cfr_abc' })
  assert.equal(r.ok, true)
  assert.ok(r.preview)
})

test('generateSummary: fetch 失败 → 本地降级（不白屏）', async () => {
  ;(globalThis as { fetch?: unknown }).fetch = fakeFetch // 还原为「抛网络错误」的 fetch
  fetchCalls.length = 0
  const r = await api.generateSummary({ meetingId: 'gen1', entries: [], level: 'detailed' })
  assert.equal(r.ok, false)
  assert.equal(r.degraded, true)
  assert.ok(fetchCalls.length >= 1) // 确实尝试了请求
})

test('liveCommentary: fetch 失败 → 降级保留历史', async () => {
  ;(globalThis as { fetch?: unknown }).fetch = fakeFetch // 还原为「抛网络错误」的 fetch
  fetchCalls.length = 0
  const r = await api.liveCommentary({ rawText: 'x', ctx: { trigger: 'timer' } })
  assert.equal(r.ok, false)
  assert.equal(r.commentary, null)
  assert.equal(r.degraded, true)
  assert.ok(fetchCalls.length >= 1)
})
