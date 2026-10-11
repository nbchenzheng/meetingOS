// 真实验证 /speak：是否返回真实大模型意见（非本地兜底）
const BASE = 'http://localhost:3001'

async function createMeeting() {
  const r = await fetch(`${BASE}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'AI大咖私董会·验证会议',
      brief: '讨论：一家做AI教育的创业公司，要不要从ToC转向ToB？',
      roleIds: ['steve_jobs', 'claude', 'gpt55'],
    }),
  })
  return (await r.json()).meeting
}

async function addTranscript(meetingId, text) {
  await fetch(`${BASE}/api/meetings/${meetingId}/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, final: true }),
  })
}

function parseSse(stream) {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events = []
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const ev = {}
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) ev.event = line.slice(7).trim()
            else if (line.startsWith('data:')) {
              try { ev.data = JSON.parse(line.slice(6).trim()) } catch {}
            }
          }
          if (ev.event) { events.push(ev); yield ev }
        }
      }
    },
    events,
  }
}

async function speak(meetingId, roleId) {
  const r = await fetch(`${BASE}/api/meetings/${meetingId}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId, trigger: 'manual' }),
  })
  const parser = parseSse(r.body)
  let full = ''
  for await (const ev of parser) {
    if (ev.event === 'token') full += ev.data.delta
    if (ev.event === 'end') full = ev.data.text || full
  }
  const isFallback = full.includes('本地兜底模式')
  return { full, isFallback }
}

const meeting = await createMeeting()
console.log('会议ID:', meeting.id)
await addTranscript(meeting.id, '创始人：我们现在有10万ToC用户，但付费转化只有2%，获客成本越来越高。有人建议我们转向服务企业的AI培训。')

for (const roleId of ['steve_jobs', 'claude', 'gpt55']) {
  const { full, isFallback } = await speak(meeting.id, roleId)
  console.log(`\n===== ${roleId} =====`)
  console.log('模式:', isFallback ? '❌ 本地兜底' : '✅ 真实大模型')
  console.log('意见:', full.slice(0, 400))
  console.log('……(共', full.length, '字)')
}
