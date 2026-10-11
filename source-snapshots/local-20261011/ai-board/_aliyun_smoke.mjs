// 阿里云实时 ASR 桥接冒烟测试：验证 run-task / task-started / 音频转发 / finish 全链路。
// 用静音 PCM 验证协议与鉴权（静音不会产出转写文本，属正常）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 手动加载 .env（与 api-server 一致）
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '.env')
try {
  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const { createAliyunStream } = await import('./server/asr-service.mjs')

const stream = createAliyunStream({
  sampleRate: 16000,
  format: 'pcm',
  onResult: (text, final) => console.log('  RESULT', final ? '(final)' : '(interim)', '->', text),
})

try {
  console.log('等待阿里云 task-started ...')
  await stream.ready()
  console.log('✅ task-started 收到：鉴权与协议正常')
  // 发送 2 秒静音 16k/16bit PCM
  const sr = 16000
  const total = sr * 2
  for (let off = 0; off < total; off += 4096) {
    const n = Math.min(4096, total - off)
    stream.sendAudio(Buffer.alloc(n * 2)) // 静音帧
    await new Promise((r) => setTimeout(r, 8))
  }
  stream.finish()
  await new Promise((r) => setTimeout(r, 1500))
  console.log('✅ 音频上行 + finish-task 完成，无异常')
} catch (e) {
  console.log('❌ 失败：', e?.message || e)
  process.exitCode = 1
}
