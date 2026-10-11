// scripts/dev.mjs —— 同时启动前端(Vite) 与 后端(Node) 的开发启动器（替代 concurrently，零额外依赖）
import { spawn } from 'node:child_process'

const PORT = process.env.PORT || 3001
const procs = []

function start(name, cmd, args, color) {
  const child = spawn(cmd, args, { stdio: 'pipe', shell: process.platform === 'win32', env: process.env })
  const tag = `\x1b[${color}m[${name}]\x1b[0m`
  child.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  child.on('exit', (code) => {
    process.stdout.write(`${tag} 退出，code=${code}\n`)
    shutdown()
  })
  procs.push(child)
  return child
}

function shutdown() {
  for (const p of procs) {
    try {
      p.kill()
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('\x1b[34m[dev]\x1b[0m 启动 AI 大咖会议私董会（前端 + 后端）…')
start('SERVER', 'node', ['server/api-server.mjs'], '32')
// 稍等后端监听后再起前端，避免代理连接抖动
setTimeout(() => {
  start('WEB', 'npx', ['vite', '--port', '5173'], '36')
}, 600)

console.log(`\x1b[34m[dev]\x1b[0m 后端 http://localhost:${PORT} ｜ 前端 http://localhost:5173`)
