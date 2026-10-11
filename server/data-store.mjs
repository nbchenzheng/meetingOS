import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defaultModelConfigs } from './llm-router.mjs'

const tables = {
  students: {
    table: 'students',
    columns: ['id', 'name', 'phone', 'org', 'roleGoal', 'targetLevel', 'createdAt'],
  },
  batches: {
    table: 'batches',
    columns: ['id', 'name', 'owner', 'status', 'startAt', 'endAt', 'createdAt'],
  },
  users: {
    table: 'users',
    columns: ['id', 'name', 'email', 'password', 'role', 'studentId'],
  },
  questions: {
    table: 'questions',
    columns: ['id', 'type', 'title', 'dimension', 'answer', 'points', 'createdAt'],
  },
  assessmentRecords: {
    table: 'assessment_records',
    columns: ['id', 'studentId', 'batchId', 'answers', 'totalScore', 'level', 'status', 'submittedAt'],
    jsonColumns: ['answers'],
  },
  reports: {
    table: 'reports',
    columns: [
      'id',
      'recordId',
      'studentId',
      'batchId',
      'studentName',
      'batchName',
      'level',
      'totalScore',
      'summary',
      'dimensionScores',
      'recommendationPath',
      'explanations',
      'risks',
      'scoringMeta',
      'createdAt',
    ],
    jsonColumns: ['dimensionScores', 'recommendationPath', 'explanations', 'risks', 'scoringMeta'],
  },
  scoringLogs: {
    table: 'scoring_logs',
    columns: [
      'id',
      'recordId',
      'reportId',
      'questionId',
      'dimension',
      'provider',
      'model',
      'score',
      'semanticRawScore',
      'ruleRawScore',
      'fallbackUsed',
      'retryCount',
      'latencyMs',
      'matchedSignals',
      'evidence',
      'suggestion',
      'attempts',
      'createdAt',
    ],
    jsonColumns: ['matchedSignals', 'attempts'],
  },
  modelConfigs: {
    table: 'model_configs',
    columns: ['id', 'name', 'provider', 'purpose', 'model', 'temperature', 'maxTokens', 'isDefault', 'isActive', 'createdAt'],
  },
  modelCallLogs: {
    table: 'model_call_logs',
    columns: ['id', 'task', 'provider', 'model', 'promptVersion', 'inputChars', 'outputChars', 'latencyMs', 'tokenEstimate', 'retryCount', 'fallbackUsed', 'status', 'error', 'createdAt'],
  },
  platformEvents: {
    table: 'platform_events',
    columns: ['id', 'event', 'entityType', 'entityId', 'studentId', 'batchId', 'actorId', 'source', 'payload', 'webhookStatus', 'webhookAttempts', 'lastWebhookError', 'createdAt'],
    jsonColumns: ['payload'],
  },
  coachReviews: {
    table: 'coach_reviews',
    columns: ['id', 'recordId', 'reportId', 'studentId', 'batchId', 'status', 'priority', 'note', 'createdAt', 'updatedAt'],
  },
  learningProgress: {
    table: 'learning_progress',
    columns: [
      'id',
      'studentId',
      'courseId',
      'lessonKey',
      'completed',
      'assignmentStatus',
      'assignmentText',
      'coachFeedback',
      'updatedAt',
    ],
  },
  courseResources: {
    table: 'course_resources',
    columns: [
      'id',
      'courseId',
      'title',
      'type',
      'owner',
      'status',
      'fileName',
      'fileSize',
      'mimeType',
      'fileData',
      'url',
      'summary',
      'updatedAt',
      'createdAt',
    ],
  },
  defenseSessions: {
    table: 'defense_sessions',
    columns: [
      'id',
      'studentId',
      'batchId',
      'projectName',
      'industry',
      'companySize',
      'targetDepartment',
      'projectStage',
      'problemSummary',
      'solutionSummary',
      'mode',
      'difficulty',
      'status',
      'currentRound',
      'selectedRoleIds',
      'transcriptionProvider',
      'createdAt',
      'startedAt',
      'endedAt',
    ],
    jsonColumns: ['selectedRoleIds'],
  },
  projectMaterials: {
    table: 'project_materials',
    columns: ['id', 'sessionId', 'sourceName', 'sourceType', 'contentText', 'extractedSummary', 'keyProcesses', 'roiSignals', 'riskSignals', 'evidenceQuotes', 'parseStatus', 'createdAt'],
    jsonColumns: ['keyProcesses', 'roiSignals', 'riskSignals', 'evidenceQuotes'],
  },
  roleProfiles: {
    table: 'role_profiles',
    columns: ['id', 'name', 'type', 'persona', 'focusPoints', 'questionStyle', 'difficulty', 'rubricWeights', 'promptTemplate', 'outputSchema', 'scenarioTags', 'isSystem', 'isActive', 'createdAt'],
    jsonColumns: ['focusPoints', 'rubricWeights', 'outputSchema', 'scenarioTags'],
  },
  defenseRounds: {
    table: 'defense_rounds',
    columns: [
      'id',
      'sessionId',
      'roundIndex',
      'questionSource',
      'questionRoleId',
      'questionText',
      'questionType',
      'answerText',
      'transcriptSegmentIds',
      'followupText',
      'scoreSnapshot',
      'createdAt',
    ],
    jsonColumns: ['transcriptSegmentIds', 'scoreSnapshot'],
  },
  transcriptSegments: {
    table: 'transcript_segments',
    columns: ['id', 'sessionId', 'roundId', 'speakerId', 'speakerType', 'speakerName', 'text', 'rawText', 'confidence', 'isFinal', 'startedAtMs', 'endedAtMs', 'provider', 'latencyMs', 'createdAt', 'updatedAt'],
  },
  fieldMicTests: {
    table: 'field_mic_tests',
    columns: ['id', 'sessionId', 'studentId', 'batchId', 'status', 'startedAtIso', 'endedAtIso', 'durationMs', 'firstCaptionLatencyMs', 'finalCaptionLatencyMs', 'captionCount', 'finalSegmentCount', 'maxSilenceSeconds', 'errorCount', 'provider', 'userAgent', 'secureContext', 'webSocketAvailable', 'notes', 'createdAt', 'updatedAt'],
  },
  aiObservations: {
    table: 'ai_observations',
    columns: ['id', 'sessionId', 'roundId', 'roleProfileId', 'feedbackType', 'severity', 'summary', 'evidence', 'suggestedFollowup', 'rubricDimension', 'createdAt'],
  },
  defenseReports: {
    table: 'defense_reports',
    columns: [
      'id',
      'sessionId',
      'totalScore',
      'dimensionScores',
      'roleEvaluations',
      'strengths',
      'weaknesses',
      'keyRisks',
      'excellentSegments',
      'coachNotes',
      'recapCards',
      'recommendedTraining',
      'passStatus',
      'reviewerComment',
      'finalScore',
      'finalConclusion',
      'certificationSuggestion',
      'retakeTask',
      'shareToken',
      'reviewUpdatedAt',
      'pdfUrl',
      'generatedAt',
    ],
    jsonColumns: ['dimensionScores', 'roleEvaluations', 'strengths', 'weaknesses', 'keyRisks', 'excellentSegments', 'coachNotes', 'recapCards', 'recommendedTraining', 'retakeTask'],
  },
}

const createStatements = [
  `CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    org TEXT NOT NULL,
    roleGoal TEXT NOT NULL,
    targetLevel TEXT NOT NULL,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL,
    startAt TEXT NOT NULL,
    endAt TEXT NOT NULL,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    studentId TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    dimension TEXT NOT NULL,
    answer TEXT NOT NULL,
    points INTEGER NOT NULL,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS assessment_records (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    batchId TEXT NOT NULL,
    answers TEXT NOT NULL,
    totalScore INTEGER NOT NULL,
    level TEXT NOT NULL,
    status TEXT NOT NULL,
    submittedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    recordId TEXT NOT NULL,
    studentId TEXT NOT NULL,
    batchId TEXT NOT NULL,
    studentName TEXT NOT NULL,
    batchName TEXT NOT NULL,
    level TEXT NOT NULL,
    totalScore INTEGER NOT NULL,
    summary TEXT NOT NULL,
    dimensionScores TEXT NOT NULL,
    recommendationPath TEXT NOT NULL,
    explanations TEXT,
    risks TEXT,
    scoringMeta TEXT,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scoring_logs (
    id TEXT PRIMARY KEY,
    recordId TEXT NOT NULL,
    reportId TEXT NOT NULL,
    questionId TEXT NOT NULL,
    dimension TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    score INTEGER NOT NULL,
    semanticRawScore INTEGER NOT NULL,
    ruleRawScore INTEGER NOT NULL,
    fallbackUsed INTEGER NOT NULL,
    retryCount INTEGER NOT NULL,
    latencyMs INTEGER NOT NULL,
    matchedSignals TEXT NOT NULL,
    evidence TEXT NOT NULL,
    suggestion TEXT NOT NULL,
    attempts TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS model_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    temperature REAL NOT NULL,
    maxTokens INTEGER NOT NULL,
    isDefault INTEGER NOT NULL,
    isActive INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS model_call_logs (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    promptVersion TEXT NOT NULL,
    inputChars INTEGER NOT NULL,
    outputChars INTEGER NOT NULL,
    latencyMs INTEGER NOT NULL,
    tokenEstimate INTEGER NOT NULL,
    retryCount INTEGER NOT NULL,
    fallbackUsed INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_events (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    studentId TEXT,
    batchId TEXT,
    actorId TEXT,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    webhookStatus TEXT NOT NULL,
    webhookAttempts INTEGER NOT NULL,
    lastWebhookError TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS coach_reviews (
    id TEXT PRIMARY KEY,
    recordId TEXT NOT NULL,
    reportId TEXT NOT NULL,
    studentId TEXT NOT NULL,
    batchId TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    note TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS learning_progress (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    courseId TEXT NOT NULL,
    lessonKey TEXT NOT NULL,
    completed INTEGER NOT NULL,
    assignmentStatus TEXT NOT NULL,
    assignmentText TEXT NOT NULL,
    coachFeedback TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS course_resources (
    id TEXT PRIMARY KEY,
    courseId TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL,
    fileName TEXT NOT NULL,
    fileSize TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    fileData TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS defense_sessions (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    batchId TEXT NOT NULL,
    projectName TEXT NOT NULL,
    industry TEXT NOT NULL,
    companySize TEXT,
    targetDepartment TEXT,
    projectStage TEXT,
    problemSummary TEXT,
    solutionSummary TEXT,
    mode TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    status TEXT NOT NULL,
    currentRound INTEGER NOT NULL,
    selectedRoleIds TEXT,
    transcriptionProvider TEXT,
    createdAt TEXT NOT NULL,
    startedAt TEXT,
    endedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS project_materials (
    id TEXT PRIMARY KEY,
    sessionId TEXT,
    sourceName TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    contentText TEXT NOT NULL,
    extractedSummary TEXT NOT NULL,
    keyProcesses TEXT NOT NULL,
    roiSignals TEXT NOT NULL,
    riskSignals TEXT NOT NULL,
    evidenceQuotes TEXT NOT NULL,
    parseStatus TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS role_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    persona TEXT NOT NULL,
    focusPoints TEXT NOT NULL,
    questionStyle TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    rubricWeights TEXT NOT NULL,
    promptTemplate TEXT,
    outputSchema TEXT,
    scenarioTags TEXT,
    isSystem INTEGER DEFAULT 0,
    isActive INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS defense_rounds (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    roundIndex INTEGER NOT NULL,
    questionSource TEXT NOT NULL,
    questionRoleId TEXT NOT NULL,
    questionText TEXT NOT NULL,
    questionType TEXT,
    answerText TEXT,
    transcriptSegmentIds TEXT,
    followupText TEXT,
    scoreSnapshot TEXT,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    roundId TEXT,
    speakerId TEXT NOT NULL,
    speakerType TEXT NOT NULL,
    speakerName TEXT NOT NULL,
    text TEXT NOT NULL,
    rawText TEXT NOT NULL,
    confidence REAL,
    isFinal INTEGER NOT NULL,
    startedAtMs INTEGER NOT NULL,
    endedAtMs INTEGER NOT NULL,
    provider TEXT NOT NULL,
    latencyMs INTEGER,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS field_mic_tests (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    studentId TEXT NOT NULL,
    batchId TEXT NOT NULL,
    status TEXT NOT NULL,
    startedAtIso TEXT NOT NULL,
    endedAtIso TEXT,
    durationMs INTEGER NOT NULL,
    firstCaptionLatencyMs INTEGER,
    finalCaptionLatencyMs INTEGER,
    captionCount INTEGER NOT NULL,
    finalSegmentCount INTEGER NOT NULL,
    maxSilenceSeconds INTEGER NOT NULL,
    errorCount INTEGER NOT NULL,
    provider TEXT,
    userAgent TEXT,
    secureContext INTEGER,
    webSocketAvailable INTEGER,
    notes TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_observations (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    roundId TEXT,
    roleProfileId TEXT NOT NULL,
    feedbackType TEXT,
    severity TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence TEXT NOT NULL,
    suggestedFollowup TEXT NOT NULL,
    rubricDimension TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS defense_reports (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    totalScore INTEGER NOT NULL,
    dimensionScores TEXT NOT NULL,
    roleEvaluations TEXT NOT NULL,
    strengths TEXT NOT NULL,
    weaknesses TEXT NOT NULL,
    keyRisks TEXT NOT NULL,
    excellentSegments TEXT,
    coachNotes TEXT NOT NULL DEFAULT '[]',
    recapCards TEXT NOT NULL DEFAULT '[]',
    recommendedTraining TEXT NOT NULL,
    passStatus TEXT NOT NULL,
    reviewerComment TEXT,
    finalScore INTEGER,
    finalConclusion TEXT,
    certificationSuggestion TEXT,
    retakeTask TEXT,
    shareToken TEXT,
    reviewUpdatedAt TEXT,
    pdfUrl TEXT,
    generatedAt TEXT NOT NULL
  )`,
]

function decodeRow(row, config) {
  const jsonColumns = config.jsonColumns ?? []
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (jsonColumns.includes(key)) return [key, JSON.parse(value)]
      if (['completed', 'fallbackUsed', 'secureContext', 'webSocketAvailable'].includes(key)) return [key, Boolean(value)]
      return [key, value]
    }),
  )
}

function encodeValue(key, value, config) {
  if ((config.jsonColumns ?? []).includes(key)) return JSON.stringify(value ?? {})
  if (['completed', 'fallbackUsed', 'secureContext', 'webSocketAvailable'].includes(key)) return value ? 1 : 0
  return value ?? null
}

const defaultRoleProfiles = [
  {
    id: 'role-human',
    name: '人类面试官',
    type: 'human',
    persona: '现场主问人，负责控制答辩节奏。',
    focusPoints: ['方案落地细节', '证据完整度'],
    questionStyle: '直接、追求证据',
    difficulty: 'standard',
    rubricWeights: { clarity: 15, feasibility: 15, roi: 15, risk: 15 },
    promptTemplate: '请围绕方案落地细节和证据完整度进行追问。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['综合评审'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
  {
    id: 'role-boss',
    name: '老板',
    type: 'boss',
    persona: '企业经营者，判断项目是否值得投入。',
    focusPoints: ['战略价值', '投入产出', '组织影响'],
    questionStyle: '直接、不接受空话',
    difficulty: 'hard',
    rubricWeights: { roi: 30, communication: 20, risk: 15 },
    promptTemplate: '请像企业经营者一样追问战略价值、投入产出和失败风险。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['经营评审', 'ROI'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
  {
    id: 'role-business',
    name: '业务负责人',
    type: 'business',
    persona: '部门负责人，关注一线使用和流程变化。',
    focusPoints: ['真实痛点', '流程改造', '员工采纳'],
    questionStyle: '具体、场景化',
    difficulty: 'standard',
    rubricWeights: { clarity: 20, feasibility: 20 },
    promptTemplate: '请围绕一线流程、真实痛点和员工采纳追问。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['业务落地'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
  {
    id: 'role-finance',
    name: '财务负责人',
    type: 'finance',
    persona: '财务评审人，关注预算和回报。',
    focusPoints: ['成本结构', 'ROI', '持续费用'],
    questionStyle: '数据导向、成本敏感',
    difficulty: 'hard',
    rubricWeights: { roi: 35, feasibility: 15 },
    promptTemplate: '请围绕预算、ROI、持续费用和回报周期追问。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['ROI', '预算'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
  {
    id: 'role-tech',
    name: '技术负责人',
    type: 'tech',
    persona: 'IT 负责人，关注集成、安全和稳定性。',
    focusPoints: ['数据接入', '权限控制', '日志审计', '回滚'],
    questionStyle: '严谨、追问边界',
    difficulty: 'hard',
    rubricWeights: { risk: 30, feasibility: 20 },
    promptTemplate: '请围绕数据、权限、安全、审计和回滚进行追问。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['技术评审'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
  {
    id: 'role-user-dept',
    name: '使用部门代表',
    type: 'user',
    persona: '一线使用部门代表，关注采用体验和执行负担。',
    focusPoints: ['使用体验', '培训成本', '执行负担'],
    questionStyle: '具体、贴近一线',
    difficulty: 'standard',
    rubricWeights: { communication: 25, feasibility: 20 },
    promptTemplate: '请围绕使用体验、培训成本和执行负担进行追问。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['采用落地'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
  {
    id: 'role-legal',
    name: '合规负责人',
    type: 'legal',
    persona: '合规负责人，关注数据和风险边界。',
    focusPoints: ['敏感数据', '授权', '合规证据'],
    questionStyle: '谨慎、风险导向',
    difficulty: 'standard',
    rubricWeights: { risk: 35, feasibility: 10 },
    promptTemplate: '请围绕敏感数据、授权、脱敏、留痕和越权防护追问。',
    outputSchema: { severity: 'low|medium|high', summary: 'string', evidence: 'string', suggestedFollowup: 'string', rubricDimension: 'string' },
    scenarioTags: ['合规评审'],
    isSystem: 1,
    isActive: 1,
    createdAt: '2026-06-25T08:00:00.000Z',
  },
]

export function createDataStore({ dbPath, seedPath }) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  for (const statement of createStatements) db.exec(statement)

  const reportColumns = db.prepare('PRAGMA table_info(reports)').all().map((column) => column.name)
  for (const [column, type] of [
    ['explanations', 'TEXT'],
    ['risks', 'TEXT'],
    ['scoringMeta', 'TEXT'],
  ]) {
    if (!reportColumns.includes(column)) {
      db.exec(`ALTER TABLE reports ADD COLUMN ${column} ${type}`)
    }
  }

  const courseResourceColumns = db.prepare('PRAGMA table_info(course_resources)').all().map((column) => column.name)
  if (!courseResourceColumns.includes('fileData')) {
    db.exec("ALTER TABLE course_resources ADD COLUMN fileData TEXT NOT NULL DEFAULT ''")
  }

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
  if (!userColumns.includes('studentId')) {
    db.exec('ALTER TABLE users ADD COLUMN studentId TEXT')
  }

  const defenseReportColumns = db.prepare('PRAGMA table_info(defense_reports)').all().map((column) => column.name)
  for (const column of ['coachNotes', 'recapCards']) {
    if (!defenseReportColumns.includes(column)) {
      db.exec(`ALTER TABLE defense_reports ADD COLUMN ${column} TEXT NOT NULL DEFAULT '[]'`)
    }
  }

  const store = {
    all(collectionName) {
      const config = tables[collectionName]
      const rows = db.prepare(`SELECT * FROM ${config.table}`).all()
      return rows.map((row) => decodeRow(row, config)).reverse()
    },

    insert(collectionName, item) {
      const config = tables[collectionName]
      const columns = config.columns.filter((column) => Object.prototype.hasOwnProperty.call(item, column))
      const placeholders = columns.map((column) => `$${column}`).join(', ')
      const values = Object.fromEntries(columns.map((column) => [`$${column}`, encodeValue(column, item[column], config)]))
      db.prepare(`INSERT OR REPLACE INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(values)
      return item
    },

    updateReview(id, patch) {
      const current = db.prepare('SELECT * FROM coach_reviews WHERE id = ?').get(id)
      if (!current) return undefined
      const review = decodeRow(current, tables.coachReviews)
      const next = {
        ...review,
        status: patch.status ?? review.status,
        note: patch.note ?? review.note,
        updatedAt: new Date().toISOString(),
      }
      this.insert('coachReviews', next)
      return next
    },

    updateUser(id, patch) {
      const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
      if (!current) return undefined
      const user = decodeRow(current, tables.users)
      const next = {
        ...user,
        name: patch.name ?? user.name,
        email: patch.email ?? user.email,
        password: patch.password ?? user.password,
        role: patch.role ?? user.role,
        studentId: patch.studentId ?? user.studentId ?? null,
      }
      this.insert('users', next)
      return next
    },

    upsertLearningProgress(item) {
      const now = new Date().toISOString()
      const id = item.id ?? `${item.studentId}-${item.lessonKey}`.replace(/[^a-zA-Z0-9_-]/g, '-')
      const current = db.prepare('SELECT * FROM learning_progress WHERE id = ?').get(id)
      const existing = current ? decodeRow(current, tables.learningProgress) : {}
      const next = {
        id,
        studentId: item.studentId ?? existing.studentId,
        courseId: item.courseId ?? existing.courseId,
        lessonKey: item.lessonKey ?? existing.lessonKey,
        completed: item.completed ?? existing.completed ?? false,
        assignmentStatus: item.assignmentStatus ?? existing.assignmentStatus ?? 'not_started',
        assignmentText: item.assignmentText ?? existing.assignmentText ?? '',
        coachFeedback: item.coachFeedback ?? existing.coachFeedback ?? '',
        updatedAt: now,
      }
      this.insert('learningProgress', next)
      return next
    },

    updateDefenseReport(id, patch) {
      const current = db.prepare('SELECT * FROM defense_reports WHERE id = ?').get(id)
      if (!current) return undefined
      const report = decodeRow(current, tables.defenseReports)
      const next = {
        ...report,
        ...patch,
        reviewUpdatedAt: new Date().toISOString(),
      }
      this.insert('defenseReports', next)
      return next
    },

    snapshot() {
      return {
        students: this.all('students'),
        batches: this.all('batches'),
        users: this.all('users'),
        questions: this.all('questions'),
        assessmentRecords: this.all('assessmentRecords'),
        reports: this.all('reports'),
        scoringLogs: this.all('scoringLogs'),
        modelConfigs: this.all('modelConfigs'),
        modelCallLogs: this.all('modelCallLogs'),
        platformEvents: this.all('platformEvents'),
        coachReviews: this.all('coachReviews'),
        learningProgress: this.all('learningProgress'),
        courseResources: this.all('courseResources'),
        defenseSessions: this.all('defenseSessions'),
        projectMaterials: this.all('projectMaterials'),
        roleProfiles: this.all('roleProfiles'),
        defenseRounds: this.all('defenseRounds'),
        transcriptSegments: this.all('transcriptSegments'),
        fieldMicTests: this.all('fieldMicTests'),
        aiObservations: this.all('aiObservations'),
        defenseReports: this.all('defenseReports'),
      }
    },

    close() {
      db.close()
    },
  }

  const hasSeedData = db.prepare('SELECT COUNT(*) as count FROM students').get().count > 0
  if (!hasSeedData && seedPath) {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
    for (const collectionName of Object.keys(tables)) {
      for (const item of seed[collectionName] ?? []) {
        store.insert(collectionName, item)
      }
    }
  }

  if (seedPath) {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
    const seedQuestions = seed.questions ?? []
    const questionCount = db.prepare('SELECT COUNT(*) as count FROM questions').get().count
    if (seedQuestions.length > questionCount) {
      for (const question of seedQuestions) {
        store.insert('questions', question)
      }
    }
  }

  db.prepare("UPDATE users SET name = '系统管理员' WHERE id = 'user-admin'").run()

  const roleCount = db.prepare('SELECT COUNT(*) as count FROM role_profiles').get().count
  if (roleCount < defaultRoleProfiles.length) {
    for (const role of defaultRoleProfiles) {
      store.insert('roleProfiles', role)
    }
  }

  if (store.all('modelConfigs').length === 0) {
    for (const config of defaultModelConfigs) {
      store.insert('modelConfigs', { ...config, createdAt: new Date().toISOString() })
    }
  }

  return store
}
