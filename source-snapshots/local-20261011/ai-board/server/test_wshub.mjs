// server/test_wshub.mjs —— WS 广播中心单测（Node node:test）
// 验证 broadcast 按 sessionId 精准推送，且 commentary 消息形状与前端 useBoard 消费一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as wsHub from './ws-hub.mjs'

function makeWs() {
  const sent = []
  return {
    sent,
    OPEN: 1,
    readyState: 1,
    send: (m) => sent.push(m),
  }
}

test('ws-hub: broadcast 向已注册 ws 发送 commentary 消息（形状正确）', () => {
  const ws = makeWs()
  wsHub.register('s1', ws)
  const commentary = { id: 'c1', source: 'bigshot', type: 'risk', text: 'x', ts: 't', anchorTs: 'a', anchorEntryIds: ['e1'], trigger: 'auto' }
  wsHub.broadcast('s1', { type: 'commentary', commentary })
  assert.equal(ws.sent.length, 1)
  const parsed = JSON.parse(ws.sent[0])
  assert.equal(parsed.type, 'commentary')
  assert.equal(parsed.commentary.text, 'x')
  assert.deepEqual(parsed.commentary.anchorEntryIds, ['e1'])
  wsHub.unregister('s1', ws)
})

test('ws-hub: 未注册 sessionId 不发送', () => {
  const ws = makeWs()
  wsHub.register('s2', ws)
  wsHub.broadcast('nonexistent', { type: 'commentary', commentary: {} })
  assert.equal(ws.sent.length, 0)
  wsHub.unregister('s2', ws)
})

test('ws-hub: connectionCount 反映注册数', () => {
  const ws = makeWs()
  wsHub.register('s3', ws)
  assert.equal(wsHub.connectionCount('s3'), 1)
  wsHub.unregister('s3', ws)
  assert.equal(wsHub.connectionCount('s3'), 0)
})

test('ws-hub: readyState 非 OPEN 的 ws 不发送', () => {
  const ws = makeWs()
  ws.readyState = 0 // not OPEN
  wsHub.register('s4', ws)
  wsHub.broadcast('s4', { type: 'commentary', commentary: {} })
  assert.equal(ws.sent.length, 0)
  wsHub.unregister('s4', ws)
})
