// server/llm-router.mjs
// 双网关 LLM 路由：按角色 model 字段分流 DeepSeek / LinkHarbor，均走 OpenAI 兼容 SSE。
// 密钥仅从 process.env 读取，禁止硬编码或打印。未配置 / 失败 → 本地规则兜底。
const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')
const LINKHARBOR_BASE = (process.env.LINKHARBOR_BASE_URL || 'https://api.linkharbor.ai/v1').replace(/\/$/, '')

// 惰性读取：必须在调用时取 process.env，因为 dotenv 在 api-server 的 import 之后才加载，
// 若在模块顶层捕获会变成空字符串导致 401。
function deepseekKey() {
  return process.env.DEEPSEEK_API_KEY || ''
}
function linkharborKey() {
  return process.env.LINKHARBOR_API_KEY || ''
}

export function llmGatewayStatus() {
  return {
    deepseek: { configured: Boolean(deepseekKey()), baseUrl: DEEPSEEK_BASE },
    linkharbor: { configured: Boolean(linkharborKey()), baseUrl: LINKHARBOR_BASE },
  }
}

// 把 OpenAI 兼容的 SSE 响应体解析为文本 delta 生成器
async function* parseOpenAiSse(response, signal) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf8')
  let buffer = ''
  while (true) {
    if (signal?.aborted) break
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let json
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      const delta = json.choices?.[0]?.delta?.content
      if (delta) yield delta
      // 某些网关把正文放在 message.content（非流式兜底），这里一并兼容
      const messageContent = json.choices?.[0]?.message?.content
      if (!delta && messageContent && json.choices?.[0]?.finish_reason) yield messageContent
    }
  }
}

async function* streamOpenAiCompatible({ baseUrl, apiKey, model, messages, signal }) {
  if (!apiKey) {
    throw new Error('llm_api_key_missing')
  }
  const endpoint = `${baseUrl}/chat/completions`
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }),
    })
  } catch {
    // 网络错误：转成不暴露密钥的可读错误
    throw new Error('llm_network_error')
  }
  if (!response.ok || !response.body) {
    throw new Error(`llm_http_${response.status}`)
  }
  yield* parseOpenAiSse(response, signal)
}

// DeepSeek V4 Pro 专用封装：集中 baseUrl + key + model，供 transcript-service 复用。
// 不改动既有 streamLLM / streamOpenAiCompatible 行为；仅新增导出。
// 作为异步生成器逐字 yield delta，与 streamOpenAiCompatible 保持一致的消费方式。
export async function* streamDeepSeek({ messages, signal }) {
  yield* streamOpenAiCompatible({
    baseUrl: DEEPSEEK_BASE,
    apiKey: deepseekKey(),
    model: 'deepseek-v4-pro', // 与 big-shot 使用的同一 model 字符串
    messages,
    signal,
  })
}

// 本地兜底：无密钥 / 调用失败时不白屏，给出基于人设与关注点的确定性建议
async function* localFallback({ role }) {
  const focus = Array.isArray(role?.focus) && role.focus.length ? role.focus.join('、') : '战略与执行'
  const name = role?.cn ?? '大咖'
  const templates = [
    `（本地兜底模式）${name}：当前议题关键在「${focus}」。建议先定义最小可行闭环，把验证成本压到最低，再决定是否放大。`,
    `（本地兜底模式）${name}：围绕「${focus}」，我倾向先小步快跑验证假设，用真实数据替代直觉，再谈规模化。`,
    `（本地兜底模式）${name}：从「${focus}」视角看，节奏比完美更重要——先把一件事做透，护城河是结果不是起点。`,
  ]
  const text = templates[Math.floor(Math.random() * templates.length)]
  for (const ch of text) {
    yield ch
    await new Promise((r) => setTimeout(r, 12))
  }
}

// 主入口：按 model 分流；返回 异步生成器（逐字 delta）
export async function* streamLLM({ model, messages, signal, role }) {
  const m = String(model || '').toLowerCase()
  try {
    if (m === 'deepseek-v4-pro') {
      yield* streamOpenAiCompatible({ baseUrl: DEEPSEEK_BASE, apiKey: deepseekKey(), model: 'deepseek-v4-pro', messages, signal })
      return
    }
    if (m === 'claude-opus-4-8' || m === 'gpt-5.5') {
      yield* streamOpenAiCompatible({ baseUrl: LINKHARBOR_BASE, apiKey: linkharborKey(), model: m, messages, signal })
      return
    }
    if (m === 'local') {
      yield* localFallback({ role })
      return
    }
    // 未知模型 → 尝试按 provider 推断；否则本地兜底
    if (role?.provider === 'deepseek') {
      yield* streamOpenAiCompatible({ baseUrl: DEEPSEEK_BASE, apiKey: deepseekKey(), model: 'deepseek-v4-pro', messages, signal })
      return
    }
    if (role?.provider === 'linkharbor') {
      yield* streamOpenAiCompatible({ baseUrl: LINKHARBOR_BASE, apiKey: linkharborKey(), model: role.model || 'gpt-5.5', messages, signal })
      return
    }
    yield* localFallback({ role })
  } catch {
    // 任何失败都不向上抛出密钥；转本地兜底，保证界面不白屏
    yield* localFallback({ role })
  }
}
