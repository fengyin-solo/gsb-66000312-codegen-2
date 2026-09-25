import type {
  DiagnosticReport,
  MatchResult,
  NFA,
  ReportFinding,
  ReportSectionId,
} from '../types'

export const REPORT_FORMAT = 'regex-diagnostic-report'
export const REPORT_VERSION = 1
export const APP_VERSION = '1.0.0'

/** 报告中测试文本最多保留的字符数，超长部分截断并在报告中说明 */
export const TEST_TEXT_STORE_LIMIT = 20000
/** 超过该长度即视为超长测试文本，导出时给出提示 */
export const TEST_TEXT_LONG_THRESHOLD = 2000
/** 报告中最多保留的回溯/匹配步骤条数，避免文件过大 */
export const STEP_STORE_LIMIT = 1000
/** 回溯次数超过该值即判定为“回溯过多” */
export const BACKTRACK_HIGH_THRESHOLD = 3

export const ALL_SECTIONS: ReportSectionId[] = [
  'pattern',
  'testText',
  'summary',
  'diagnosis',
  'steps',
  'groups',
  'metrics',
  'repro',
]

export const SECTION_LABELS: Record<ReportSectionId, string> = {
  pattern: '当前正则',
  testText: '测试文本',
  summary: '匹配摘要',
  diagnosis: '原因诊断',
  steps: '回溯步骤',
  groups: '分组捕获',
  metrics: '性能指标',
  repro: '复现信息',
}

export interface BuildReportInput {
  pattern: string
  testText: string
  matchResult: MatchResult | null
  nfa: NFA | null
  sections: ReportSectionId[]
  title?: string
  note?: string
  /** 生成时的时间戳，便于测试与保证可复现 */
  now?: Date
}

/** FNV-1a 32 位哈希：短小、确定、无外部依赖 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ('0000000' + (hash >>> 0).toString(16)).slice(-8)
}

export interface TextStatus {
  length: number
  isLong: boolean
  truncated: boolean
  stored: string
  sha256?: string
}

/** 计算测试文本的存储状态：超长时截断，并对原文留指纹 */
export function prepareTestText(text: string): TextStatus {
  const length = text.length
  const truncated = length > TEST_TEXT_STORE_LIMIT
  const stored = truncated ? text.slice(0, TEST_TEXT_STORE_LIMIT) : text
  return {
    length,
    isLong: length > TEST_TEXT_LONG_THRESHOLD,
    truncated,
    stored,
    // 原文指纹，保证截断后仍可核对“看到的是不是同一份输入”
    sha256: fnv1a(text),
  }
}

function isLikelyCatastrophic(pattern: string): boolean {
  // 启发式：嵌套或相邻的无锚定重复（如 (a+)+、(a*)*、(a|a)*）
  return /([+*][+*?])|(\)\s*[+*])/.test(pattern) || /\((?:[^()]*[+*])+[^()]*\)\s*[+*]/.test(pattern)
}

/**
 * 根据匹配结果生成诊断结论：未匹配的原因、回溯过多的原因、空结果、超长文本等。
 */
export function buildFindings(input: BuildReportInput, textStatus: TextStatus): ReportFinding[] {
  const { pattern, testText, matchResult } = input
  const findings: ReportFinding[] = []

  if (testText.length === 0) {
    findings.push({
      id: 'empty-input',
      severity: matchResult?.matched ? 'info' : 'warning',
      title: '测试文本为空',
      detail: '当前测试文本长度为 0，仅能匹配允许空匹配的正则（如 ^$、a*）。',
      suggestion: '填入期望匹配的样本后重新执行匹配，再导出报告。',
    })
  }

  if (!matchResult) {
    findings.push({
      id: 'no-result',
      severity: 'error',
      title: '尚无匹配结果',
      detail: '正则可能解析失败或尚未执行匹配，报告中关键指标将显示为空。',
      suggestion: '修正正则并点击“执行匹配”后重试导出。',
    })
    return findings
  }

  if (!matchResult.matched) {
    const reasons: string[] = []
    const suggestions: string[] = []
    if (pattern.startsWith('^')) {
      reasons.push('正则以 ^ 锚定开头，引擎必须从文本起始位置（以及每个候选起点）匹配，起始字符不符即失败。')
    }
    if (pattern.endsWith('$')) {
      reasons.push('正则以 $ 锚定结尾，要求匹配一直延伸到文本末尾（或行尾），多余字符会导致整体失败。')
    }
    if (/\\d/.test(pattern) && /\D/.test(testText)) {
      reasons.push('模式包含数字类元字符 \\d，而测试文本中存在非数字字符，可能在该处失配。')
    }
    if (/\\w/.test(pattern) && /[^\w]/.test(testText)) {
      reasons.push('模式包含单词类元字符 \\w，而测试文本中存在标点、空格等非单词字符，可能在该处失配。')
    }
    if (reasons.length === 0) {
      reasons.push('引擎从文本的每个位置尝试驱动 NFA，所有路径在到达接受状态前都遇到了失配转移（FAIL）。')
    }
    suggestions.push('检查锚点（^/$）、字符类（[]、\\d、\\w）与文本是否一致；可在工作台单步执行，定位第一个 FAIL 转移对应的字符索引。')
    findings.push({
      id: 'no-match',
      severity: 'error',
      title: '未匹配到结果',
      detail: reasons.join(' '),
      suggestion: suggestions.join(' '),
    })
  } else if (matchResult.matchText === '') {
    findings.push({
      id: 'empty-match',
      severity: 'info',
      title: '匹配结果为空串',
      detail: '正则可以在不消耗任何字符的情况下成功（常见于 *、? 或仅由锚点组成的模式），匹配文本为空。',
    })
  }

  if (matchResult.backtracks > BACKTRACK_HIGH_THRESHOLD) {
    findings.push({
      id: 'high-backtrack',
      severity: 'warning',
      title: '回溯次数过多',
      detail: `本次匹配记录了 ${matchResult.backtracks} 次回溯（阈值 ${BACKTRACK_HIGH_THRESHOLD}），引擎在多个候选起点重复探索失败路径。`,
      suggestion: '尽量使用非捕获/占有型思路精简嵌套量词、收紧字符类（用 [^x] 代替 .*）、必要时加上 ^ 等锚点缩小搜索空间。',
    })
  } else if (matchResult.backtracks > 0) {
    findings.push({
      id: 'some-backtrack',
      severity: 'info',
      title: '存在少量回溯',
      detail: `记录到 ${matchResult.backtracks} 次回溯，属于正常的候选路径尝试范围。`,
    })
  }

  if (isLikelyCatastrophic(pattern)) {
    findings.push({
      id: 'catastrophic-risk',
      severity: 'warning',
      title: '潜在指数级回溯风险',
      detail: '模式中存在相邻或嵌套的重复量词（如 (a+)+、(.*)*），特定输入可能导致匹配时间指数级膨胀。',
      suggestion: '避免重叠的量词组合，重写为互斥分支或线性结构。',
    })
  }

  if (textStatus.isLong) {
    findings.push({
      id: 'long-text',
      severity: 'info',
      title: '测试文本超长',
      detail: textStatus.truncated
        ? `测试文本共 ${textStatus.length} 个字符，超过报告保留上限 ${TEST_TEXT_STORE_LIMIT}，文件中仅保存前 ${TEST_TEXT_STORE_LIMIT} 个字符，已附原文指纹用于核对。`
        : `测试文本共 ${textStatus.length} 个字符，已完整写入报告文件；查看器中仅预览前 ${TEST_TEXT_LONG_THRESHOLD} 个字符。`,
    })
  }

  return findings
}

export interface BuildResult {
  report: DiagnosticReport
  textStatus: TextStatus
}

/** 构建一份完整的诊断报告（纯函数，失败时抛错由调用方负责重试） */
export function buildDiagnosticReport(input: BuildReportInput): BuildResult {
  const sections = Array.from(new Set(input.sections))
  const has = (id: ReportSectionId) => sections.includes(id)

  const textStatus = prepareTestText(input.testText)
  const findings = buildFindings(input, textStatus)
  const mr = input.matchResult

  const allSteps = mr?.steps ?? []
  const stepsTruncated = allSteps.length > STEP_STORE_LIMIT
  const steps = has('steps') ? allSteps.slice(0, STEP_STORE_LIMIT) : []

  const metrics = {
    totalSteps: mr?.totalSteps ?? 0,
    backtracks: mr?.backtracks ?? 0,
    duration: mr?.duration ?? 0,
    inputLength: input.testText.length,
    nfaStates: input.nfa?.states.length ?? 0,
    nfaTransitions: input.nfa?.transitions.length ?? 0,
  }

  const now = input.now ?? new Date()
  const id = `rep_${now.getTime()}_${fnv1a(input.pattern + input.testText).slice(0, 8)}`
  const matched = mr?.matched ?? false
  const title =
    input.title?.trim() ||
    `${matched ? '匹配成功' : '未匹配'}诊断 · ${input.pattern.slice(0, 24)}${input.pattern.length > 24 ? '…' : ''}`

  const noteParts: string[] = []
  if (!matched) noteParts.push('本次匹配未命中，详见“原因诊断”。')
  if (textStatus.truncated) noteParts.push('测试文本超长，已在文件中截断并附指纹。')
  if (stepsTruncated) noteParts.push(`步骤超过 ${STEP_STORE_LIMIT} 条，仅保留前段。`)
  if (noteParts.length === 0) noteParts.push('报告关键数字与导出时工作台一致。')

  const report: DiagnosticReport = {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    id,
    createdAt: now.toISOString(),
    appVersion: APP_VERSION,
    title,
    note: [input.note?.trim(), noteParts.join(' ')].filter(Boolean).join(' '),
    sections,
    // 正则始终保存（复现的最小必要信息），即使未勾选“当前正则”分组
    pattern: input.pattern,
    flags: 'g',
    testText: has('testText') ? textStatus.stored : '',
    testTextLength: textStatus.length,
    testTextTruncated: textStatus.truncated,
    testTextMaxStored: TEST_TEXT_STORE_LIMIT,
    testTextSha256: textStatus.sha256,
    matched,
    matchText: mr?.matchText ?? '',
    captureGroups: has('groups') ? mr?.groups ?? [] : [],
    steps,
    stepsTruncated,
    totalStepCount: allSteps.length,
    backtracks: metrics.backtracks,
    metrics,
    findings: has('diagnosis') ? findings : [],
    engine: {
      name: 'built-in NFA engine',
      version: APP_VERSION,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    },
    checksum: { algorithm: 'fnv1a-32', value: '' },
  }

  report.checksum.value = checksumFor(report)
  return { report, textStatus }
}

/** 对报告的关键字段计算校验和，用于重新打开时确认数字未被篡改 */
export function checksumFor(r: Omit<DiagnosticReport, 'checksum'>): string {
  const payload = [
    r.format,
    r.version,
    r.pattern,
    r.testTextLength,
    r.testTextTruncated,
    r.testTextSha256 ?? '',
    r.matched,
    r.matchText,
    r.backtracks,
    r.totalStepCount,
    r.metrics.totalSteps,
    r.metrics.backtracks,
    r.metrics.duration,
    r.metrics.inputLength,
    r.metrics.nfaStates,
    r.metrics.nfaTransitions,
  ].join('')
  return fnv1a(payload)
}

export function isChecksumValid(r: DiagnosticReport): boolean {
  const { checksum, ...rest } = r
  return checksum.algorithm === 'fnv1a-32' && checksum.value === checksumFor(rest)
}

// ===== 序列化 / 解析 / 校验 =====

export class ReportParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportParseError'
  }
}

export function serializeReport(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2)
}

export function parseReport(json: string): DiagnosticReport {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new ReportParseError('文件不是合法的 JSON，无法打开报告。')
  }
  return validateReport(data)
}

export function validateReport(data: unknown): DiagnosticReport {
  if (typeof data !== 'object' || data === null) {
    throw new ReportParseError('报告内容为空或格式不正确。')
  }
  const r = data as Record<string, unknown>
  if (r.format !== REPORT_FORMAT) throw new ReportParseError('缺少 format 标识，不是本工具生成的诊断报告。')
  if (r.version !== REPORT_VERSION) throw new ReportParseError(`报告版本不兼容：期望 ${REPORT_VERSION}，实际 ${String(r.version)}。`)
  if (typeof r.pattern !== 'string') throw new ReportParseError('报告缺少正则字段（pattern）。')
  if (typeof r.testTextLength !== 'number') throw new ReportParseError('报告缺少测试文本长度信息。')
  if (typeof r.matched !== 'boolean') throw new ReportParseError('报告缺少匹配状态。')
  if (typeof r.metrics !== 'object' || r.metrics === null) throw new ReportParseError('报告缺少性能指标。')
  const report = data as DiagnosticReport
  if (!report.checksum || !isChecksumValid(report)) {
    throw new ReportParseError('报告校验和不一致，关键数字可能已被修改，无法保证与原工作台一致。')
  }
  return report
}

// ===== 文件下载 / 读取 =====

export function reportFileName(report: DiagnosticReport): string {
  const stamp = report.createdAt.slice(0, 19).replace(/[:T]/g, '-')
  const safe = report.pattern
    .replace(/[\\^$.*+?()[\]{}|/]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32)
  return `regex-diagnostic-${stamp}-${safe || 'report'}.json`
}

export function downloadReport(report: DiagnosticReport): void {
  const blob = new Blob([serializeReport(report)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = reportFileName(report)
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // 让浏览器有机会开始下载后再释放
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function readReportFile(file: File): Promise<DiagnosticReport> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(parseReport(String(reader.result ?? '')))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(new ReportParseError('读取文件失败，请重试。'))
    reader.readAsText(file)
  })
}
