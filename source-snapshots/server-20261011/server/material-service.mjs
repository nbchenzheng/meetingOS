import { inflateRawSync } from 'node:zlib'

// 服务端防御：单份资料解码后体积上限（字节）。
// 低于 readBody 的 32MB 硬性限制，用于在进入重型正则解析前快速拦截超大文件，
// 返回明确错误而非让 Node 做耗时 / 易 OOM 的 PDF 文本抽取。
const MAX_MATERIAL_BYTES = 25 * 1024 * 1024 // 25 MB

function compactText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function splitSentences(text) {
  return compactText(text)
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueTake(items, limit) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, limit)
}

function findSentences(sentences, patterns, limit) {
  return uniqueTake(sentences.filter((sentence) => patterns.some((pattern) => pattern.test(sentence))), limit)
}

function decodeXmlEntities(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function stripXmlText(xml) {
  return compactText(decodeXmlEntities(String(xml ?? '').replace(/<[^>]+>/g, ' ')))
}

function bufferFromFileData(fileData = '') {
  const raw = String(fileData)
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
  return Buffer.from(base64, 'base64')
}

function readZipEntries(buffer) {
  const entries = new Map()
  const eocdSignature = 0x06054b50
  let eocdOffset = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) return entries
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(centralOffset + 10)
    const compressedSize = buffer.readUInt32LE(centralOffset + 20)
    const nameLength = buffer.readUInt16LE(centralOffset + 28)
    const extraLength = buffer.readUInt16LE(centralOffset + 30)
    const commentLength = buffer.readUInt16LE(centralOffset + 32)
    const localOffset = buffer.readUInt32LE(centralOffset + 42)
    const name = buffer.slice(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.slice(dataStart, dataStart + compressedSize)
    let data
    if (method === 0) data = compressed
    if (method === 8) data = inflateRawSync(compressed)
    if (data) entries.set(name, data)
    centralOffset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function extractOoxmlText(buffer, fileName = '') {
  const entries = readZipEntries(buffer)
  const lowerName = fileName.toLowerCase()
  const isPptx = lowerName.endsWith('.pptx')
  const isDocx = lowerName.endsWith('.docx')
  const names = Array.from(entries.keys())
    .filter((name) => {
      if (isPptx) return /^ppt\/slides\/slide\d+\.xml$/.test(name)
      if (isDocx) return name === 'word/document.xml' || /^word\/(header|footer)\d+\.xml$/.test(name)
      return /^(word\/document|ppt\/slides\/slide\d+)\.xml$/.test(name)
    })
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  return compactText(names.map((name) => stripXmlText(entries.get(name)?.toString('utf8') ?? '')).join('\n'))
}

function decodePdfLiteral(value) {
  return String(value ?? '')
    .replace(/\\([nrtbf()\\])/g, (_match, char) => {
      if (char === 'n') return '\n'
      if (char === 'r') return '\r'
      if (char === 't') return '\t'
      if (char === 'b') return '\b'
      if (char === 'f') return '\f'
      return char
    })
    .replace(/\\\d{1,3}/g, ' ')
}

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1')
  const literalMatches = Array.from(raw.matchAll(/\(([^()]{2,500})\)\s*Tj/g)).map((match) => decodePdfLiteral(match[1]))
  const arrayMatches = Array.from(raw.matchAll(/\[((?:\([^()]{1,500}\)|\s|-?\d+)+)\]\s*TJ/g)).map((match) => {
    return Array.from(match[1].matchAll(/\(([^()]{1,500})\)/g)).map((item) => decodePdfLiteral(item[1])).join('')
  })
  const hexMatches = Array.from(raw.matchAll(/<([0-9A-Fa-f]{4,})>\s*Tj/g)).map((match) => {
    try {
      return Buffer.from(match[1], 'hex').toString('utf16le')
    } catch {
      return ''
    }
  })
  return compactText([...literalMatches, ...arrayMatches, ...hexMatches].join(' '))
}

export function extractMaterialTextFromFile({ fileName = 'material.txt', mimeType = '', fileData = '' } = {}) {
  const buffer = bufferFromFileData(fileData)
  // 体积守卫：超大附件直接跳过重型解析，避免后端卡死 / 内存爆掉
  if (buffer.length > MAX_MATERIAL_BYTES) {
    return {
      fileName,
      mimeType,
      extractor: 'skipped-oversize',
      extractedText: '',
      byteLength: buffer.length,
      error: `附件过大（${buffer.length} 字节），服务端已跳过解析，请将单份资料控制在 ${MAX_MATERIAL_BYTES} 字节以内`,
    }
  }
  const lowerName = String(fileName).toLowerCase()
  let extractedText = ''
  let extractor = 'plain-text'
  if (lowerName.endsWith('.docx') || lowerName.endsWith('.pptx') || /officedocument/.test(mimeType)) {
    extractedText = extractOoxmlText(buffer, fileName)
    extractor = lowerName.endsWith('.pptx') ? 'pptx-ooxml' : 'docx-ooxml'
  } else if (lowerName.endsWith('.pdf') || mimeType === 'application/pdf') {
    extractedText = extractPdfText(buffer)
    extractor = 'pdf-basic'
  } else {
    extractedText = buffer.toString('utf8')
  }
  return {
    fileName,
    mimeType,
    extractor,
    extractedText: compactText(extractedText),
    byteLength: buffer.length,
  }
}

export function parseSolutionMaterial({ contentText = '', sourceName = 'pasted-material', sourceType = 'text' } = {}) {
  const normalized = compactText(contentText)
  const sentences = splitSentences(contentText)
  const evidenceQuotes = uniqueTake(sentences.filter((sentence) => sentence.length >= 8).map((sentence) => sentence.slice(0, 160)), 6)
  const keyProcesses = findSentences(sentences, [/流程|工单|客服|审批|交付|售后|销售|运营|培训|上线|验收/i], 5)
  const roiSignals = findSentences(sentences, [/ROI|成本|预算|效率|分钟|小时|人力|节省|提升|周期|回报/i], 5)
  const riskSignals = findSentences(sentences, [/风险|权限|安全|合规|审计|回滚|失败|敏感|脱敏|授权|兜底/i], 5)
  const problemSignals = findSentences(sentences, [/痛点|问题|现状|当前|依赖|慢|低|缺少|不足|困难/i], 3)
  const solutionSignals = findSentences(sentences, [/方案|建设|Agent|AI|知识库|自动|整合|生成|试点|MVP/i], 3)
  const summaryParts = uniqueTake([...problemSignals, ...solutionSignals, ...roiSignals], 3)
  const extractedSummary = summaryParts.length > 0
    ? summaryParts.join('；')
    : (normalized ? normalized.slice(0, 180) : '未识别到可解析材料')

  return {
    sourceName,
    sourceType,
    extractedSummary,
    problemSummary: problemSignals[0] ?? extractedSummary,
    solutionSummary: solutionSignals[0] ?? extractedSummary,
    keyProcesses: keyProcesses.length > 0 ? keyProcesses : evidenceQuotes.slice(0, 2),
    roiSignals,
    riskSignals,
    evidenceQuotes,
    parseStatus: normalized.length > 0 ? 'parsed' : 'empty',
    contentLength: normalized.length,
  }
}