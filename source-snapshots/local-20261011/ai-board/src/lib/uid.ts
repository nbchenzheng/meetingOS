// src/lib/uid.ts —— 轻量唯一 id 生成（前端会话态，不依赖后端）。
let _n = 0
export function uid(prefix = 'u'): string {
  _n += 1
  return `${prefix}_${Date.now().toString(36)}_${_n.toString(36)}`
}
