// scripts/smoke.mjs —— 运行时冒烟（条件：环境有 LLM key 且能起服务）
// 验证：/api/summary/generate、/api/transcript/commentary 恒 200 降级、WS commentary 广播（mock 客户端）。
import WebSocket from 'ws'

const BASE = 'http://localhost:3001'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const health = await (await fetch(BASE + '/api/health')).json()
  console.log('HEALTH', JSON.stringify(health))

  const rolesRes = await (await fetch(BASE + '/api/roles')).json()
  const roleIds = (rolesRes.roles || []).slice(0, 6).map((r) => r.id)
  console.log('ROLES', roleIds.length, roleIds.slice(0, 3))

  const m = await (
    await fetch(BASE + '/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'AI 落地节奏', brief: '', roleIds }),
    })
  ).json()
  const meetingId = m.meeting?.id
  console.log('MEETING', meetingId)

  // —— WS mock 客户端：监听 commentary 广播 ——
  const ws = new WebSocket(`ws://localhost:3001/ws/board/transcribe?sessionId=${meetingId}`)
  let gotCommentary = false
  let gotRaw = null
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'commentary') {
        gotCommentary = true
        gotRaw = msg
      }
    } catch {}
  })

  // 先灌入转录（含转场短语），使大咖挑选有素材可匹配
  for (const t of [
    '我们讨论获客成本与渠道ROI，当前转化偏低。',
    '接下来转到产品打磨节奏，要关注用户体验与留存。',
    '关于风险，节奏过快可能踩坑，需要谨慎控制扩张。',
  ]) {
    await fetch(`${BASE}/api/meetings/${meetingId}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t, final: true }),
    })
  }

  // —— /api/transcript/commentary（后端 liveCommentary 当前因 randomUUID 缺陷会降级）——
  const cRes = await (
    await fetch(BASE + '/api/transcript/commentary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText: '我们讨论AI落地节奏与获客成本', ctx: { trigger: 'timer' } }),
    })
  ).json()
  console.log('COMMENTARY_ENDPOINT', JSON.stringify({ ok: cRes.ok, degraded: cRes.degraded, hasCommentary: !!cRes.commentary, code: cRes.code }))

  // —— /api/summary/generate（恒 200，真实或降级）——
  const sRes = await (
    await fetch(BASE + '/api/summary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId,
        entries: [{ id: 'e1', type: 'speech', text: '关于AI落地节奏的讨论', speaker: '主持人', ts: new Date().toISOString(), final: true }],
        level: 'detailed',
      }),
    })
  ).json()
  console.log('SUMMARY_GENERATE', JSON.stringify({ ok: sRes.ok, degraded: sRes.degraded, cached: sRes.cached, elementCount: sRes.result?.elements?.length }))

  // —— /api/transcript/mindmap → 触发 onTopicSwitch → 大咖主动点评 WS 广播 ——
  const mmRes = await (
    await fetch(BASE + '/api/transcript/mindmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText: '我们先讨论获客成本与渠道ROI，然后转到产品打磨节奏，最后总结下一步行动项与风险。',
        meetingTitle: 'AI 落地节奏',
        meetingId,
      }),
    })
  ).json()
  console.log('MINDMAP', JSON.stringify({ ok: mmRes.ok, degraded: mmRes.degraded }))

  for (let i = 0; i < 35 && !gotCommentary; i++) await sleep(1000)
  console.log('WS_COMMENTARY', gotCommentary ? JSON.stringify({ source: gotRaw.commentary.source, type: gotRaw.commentary.type, text: (gotRaw.commentary.text || '').slice(0, 24) }) : 'NONE within 35s')

  ws.close()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('SMOKE_ERR', e)
    process.exit(1)
  })
