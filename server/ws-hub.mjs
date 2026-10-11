// server/ws-hub.mjs
// 轻量 WebSocket 广播中心：按 sessionId（会议 id）维护连接集合。
// 复用既有的 /ws/board/transcribe 通道，仅新增 commentary 消息类型的精准下行推送。
// 设计约束（架构 §二）：单进程内存 Map，不落盘、不依赖外部组件。
const registry = new Map() // sessionId -> Set<ws>

/** 注册一条 WS 连接到指定 sessionId（会议）。 */
export function register(sessionId, ws) {
  if (!sessionId) return
  if (!registry.has(sessionId)) registry.set(sessionId, new Set())
  registry.get(sessionId).add(ws)
}

/** 注销一条 WS 连接（关闭/出错时调用）。 */
export function unregister(sessionId, ws) {
  if (!sessionId) return
  const set = registry.get(sessionId)
  if (!set) return
  set.delete(ws)
  if (set.size === 0) registry.delete(sessionId)
}

/**
 * 向指定 sessionId 的全部连接广播一条消息。
 * @param sessionId 会议 id
 * @param payload 任意 JSON 可序列化对象（此处为 { type:'commentary', commentary }）
 */
export function broadcast(sessionId, payload) {
  if (!sessionId) return
  const set = registry.get(sessionId)
  if (!set || set.size === 0) return
  const msg = JSON.stringify(payload)
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(msg)
      } catch {
        /* 单条发送失败不影响其余连接 */
      }
    }
  }
}

/** 仅用于测试/调试：返回某 sessionId 的当前连接数。 */
export function connectionCount(sessionId) {
  return registry.get(sessionId)?.size ?? 0
}
