// server/role-service.mjs
// 角色体系：22 位（Claude / GPT-5.5 + 20 位大咖）加载、排序、自定义 CRUD。
// 模型路由字段 model / provider / order 在此确定，是 llm-router 的唯一真理来源。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import seed from './data/大咖角色库.json' with { type: 'json' }

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const CUSTOM_FILE = join(DATA_DIR, 'custom-roles.json')
const DOSSIER_DIR = join(__dirname, '..', 'dossiers')

// 读取大咖「思想萃取」长文（dossiers/<id>.md）。T11：每个大咖数千字，覆盖思想体系 /
// 决策框架 / 代表观点 / 金句 / 语言风格。缺失则回退 persona+focus（board-service 处理）。
function loadDossier(id) {
  try {
    const p = join(DOSSIER_DIR, `${id}.md`)
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
  } catch {
    return ''
  }
}

function avatarUrl(raw) {
  if (!raw) return ''
  const name = String(raw).split('/').pop().split('\\').pop()
  return name ? `/avatars/${name}` : ''
}

// —— 两个大模型特殊角色（架构 §3.1 / §7.2）——
const CLAUDE = {
  id: 'claude',
  en: 'Claude',
  cn: 'Claude',
  title: 'Anthropic 大模型',
  color: '#d97757',
  initial: 'C',
  avatar: '',
  avatarOk: false,
  persona:
    '你是 Anthropic 开发的 Claude。以严谨、平衡、注重安全与责任的视角参与董事会讨论，善于结构化地分析利弊、识别风险与盲点，给出稳妥可执行的建议。',
  focus: ['风险', '合规', '安全', '伦理', '结构化', '权衡', '责任'],
  model: 'claude-opus-4-8',
  provider: 'linkharbor',
  preset: true,
  order: 1000,
  dossier: loadDossier('claude'),
}

const GPT = {
  id: 'gpt55',
  en: 'GPT-5.5',
  cn: 'GPT-5.5',
  title: 'OpenAI 大模型',
  color: '#10a37f',
  initial: 'G',
  avatar: '',
  avatarOk: false,
  persona:
    '你是 OpenAI 的 GPT-5.5。以广博的知识与务实的态度参与董事会，擅长快速给出可执行方案、多方案对比与落地步骤，语言干练、面向结果。',
  focus: ['方案', '执行', '效率', '增长', '对比', '落地', '数据'],
  model: 'gpt-5.5',
  provider: 'linkharbor',
  preset: true,
  order: 1001,
  dossier: loadDossier('gpt55'),
}

function buildBigShot(raw, index) {
  return {
    id: raw.id,
    en: raw.en ?? raw.id,
    cn: raw.cn ?? raw.en ?? raw.id,
    title: raw.title ?? '',
    color: raw.color ?? '#3b82f6',
    initial: raw.initial ?? (raw.cn ?? raw.en ?? '?').slice(0, 1),
    avatar: avatarUrl(raw.avatar),
    avatarOk: Boolean(raw.avatarOk ?? Boolean(raw.avatar)),
    persona: raw.persona ?? '',
    focus: Array.isArray(raw.focus) ? raw.focus : [],
    model: 'deepseek-v4-pro',
    provider: 'deepseek',
    preset: true,
    order: index, // 大咖顺序由 seed 决定：思维原型在 seed 前三位 → order 0/1/2 排最前；大模型 1000/1001 排最后
    thinkingModel: raw.thinkingModel ?? null,
    dossier: loadDossier(raw.id),
  }
}

function loadCustomRoles() {
  try {
    if (!existsSync(CUSTOM_FILE)) return []
    const arr = JSON.parse(readFileSync(CUSTOM_FILE, 'utf8'))
    if (!Array.isArray(arr)) return []
    return arr.map((r) => ({ ...r, preset: false, custom: true }))
  } catch {
    return []
  }
}

function persistCustomRoles(list) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(CUSTOM_FILE, JSON.stringify(list, null, 2), 'utf8')
  } catch {
    /* 持久化失败不影响内存态 */
  }
}

function presetRoles() {
  return [CLAUDE, GPT, ...seed.map(buildBigShot)]
}

export function listRoles() {
  return [...presetRoles(), ...loadCustomRoles()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
}

export function getRole(id) {
  return listRoles().find((r) => r.id === id) ?? null
}

export function addCustomRole(input = {}) {
  const cn = String(input.cn ?? input.name ?? '').trim() || '新大咖'
  const id = String(input.id ?? `custom_${randomUUID().slice(0, 8)}`)
  const role = {
    id,
    en: input.en ?? cn,
    cn,
    title: String(input.title ?? '特邀嘉宾').trim(),
    color: input.color ?? '#3b82f6',
    initial: String(input.initial ?? cn.slice(0, 1)),
    avatar: avatarUrl(input.avatar),
    avatarOk: Boolean(input.avatar) || (input.avatarOk ?? false),
    persona: String(input.persona ?? '').trim(),
    focus: Array.isArray(input.focus)
      ? input.focus.map(String)
      : String(input.focus ?? '')
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
    model: input.model ?? 'deepseek-v4-pro',
    provider: input.provider ?? 'deepseek',
    preset: false,
    custom: true,
    order: Number(input.order ?? 999),
    dossier: input.dossier ?? '',
  }
  const list = loadCustomRoles()
  list.push(role)
  persistCustomRoles(list)
  return role
}

export function removeRole(id) {
  const list = loadCustomRoles()
  const next = list.filter((r) => r.id !== id)
  if (next.length !== list.length) {
    persistCustomRoles(next)
    return true
  }
  return false
}
