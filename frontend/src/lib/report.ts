import type {
  DiagnosticReport,
  DiagnosisItem,
  ReportSectionId,
  ReportSectionOption,
  ReportVerifyResult,
  GenerateReportOptions,
  MatchResult,
} from '../types'
import { buildNFA, runMatch } from '../store/regex'

export const SCHEMA_VERSION = 1
export const APP_VERSION = '1.0.0'

export const MAX_TEST_TEXT_LENGTH = 2000
export const MAX_BACKTRACK_STEPS = 500

// 回溯阈值：绝对次数或回溯步骤占比，超过即判定"回溯过多"
export const BACKTRACK_ABSOLUTE_THRESHOLD = 20
export const BACKTRACK_RATIO_THRESHOLD = 0.3
export const BACKTRACK_RATIO_MIN_STEPS = 10

export const SECTION_OPTIONS: ReportSectionOption[] = [
  { id: 'pattern', label: '当前正则', description: '正则表达式与 flags（必含）', required: true },
  { id: 'summary', label: '匹配摘要', description: '匹配状态、命中区间与分组数量', required: false },
  { id: 'diagnosis', label: '原因诊断', description: '未匹配 / 回溯过多的原因分析（必含）', required: true },
  { id: 'performance', label: '性能指标', description: '总步数、回溯次数、耗时、状态规模', required: false },
  { id: 'backtracks', label: '回溯步骤', description: '每一次回溯的字符、索引与状态', required: false },
  { id: 'groups', label: '分组捕获', description: '各捕获分组的值（导出前可勾选）', required: false },
  { id: 'testText', label: '测试文本', description: '测试文本原文（超长会截断并注明）', required: false },
  { id: 'repro', label: '复现信息', description: '生成时间、环境、指纹等复现信息（必含）', required: true },
]

export const REQUIRED_SECTIONS: ReportSectionId[] = ['pattern', 'diagnosis', 'repro']

const SECTION_ORDER: ReportSectionId[] = [
  'pattern', 'summary', 'diagnosis', 'performance', 'backtracks', 'groups', 'testText', 'repro',
]

/** FNV-1a 32bit 指纹：覆盖正则与关键数字，重新打开时用于校验一致性 */
export function computeFingerprint(
  pattern: string,
  flags: string,
  result: Pick<MatchResult, 'matched' | 'matchText' | 'totalSteps' | 'backtracks'>,
): string {
  const payload = [pattern, flags, result.matched, result.matchText, result.totalSteps, result.backtracks]
    .map((v) => String(v))
    .join('')
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'rpt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * 检测嵌套量词（如 (a+)+、.*.*、\d*+），这是灾难性回溯的常见根因。
 * 思路：顺序扫描 token，跟踪“上一个 token 是否带量词”以及每个分组内是否出现过量词；
 * 当新量词修饰的原子本身带量词（紧邻量词 / 含量词的分组）时即判定为嵌套。
 */
export function hasNestedQuantifier(pattern: string): boolean {
  let i = 0
  let prevHadQuantifier = false
  // 每个分组栈帧记录该分组的表达式里是否出现过量词
  const groupHadQuantifier: boolean[] = []

  const readQuantifier = (): boolean => {
    if (i >= pattern.length) return false
    const q = pattern[i]
    if (q === '*' || q === '+') { i++; return true }
    if (q === '?') {
      // 排除 (?: 等组修饰
      if (pattern[i - 1] === '(' || pattern.slice(i - 2, i) === '?:' ) { i++; return false }
      i++; return true
    }
    if (q === '{') {
      const end = pattern.indexOf('}', i)
      if (end !== -1 && /^\{\d+(,\d*)?\}$/.test(pattern.slice(i, end + 1))) { i = end + 1; return true }
    }
    return false
  }

  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '\\') { i += 2; prevHadQuantifier = false; continue }
    if (ch === '[') {
      i++
      if (pattern[i] === '^') i++
      if (pattern[i] === ']') i++
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++
        i++
      }
      i++
      prevHadQuantifier = false
      continue
    }
    if (ch === '(') {
      // 非捕获 / 环视前缀
      if (pattern[i + 1] === '?') {
        i += pattern[i + 2] === ':' || pattern[i + 2] === '=' || pattern[i + 2] === '!' ? 3 : 2
      } else {
        i++
      }
      groupHadQuantifier.push(false)
      prevHadQuantifier = false
      continue
    }
    if (ch === ')') {
      const groupHad = groupHadQuantifier.pop() ?? false
      i++
      prevHadQuantifier = groupHad // 该分组整体作为一个“原子”，其内部量词性决定外层判定
      continue
    }
    if (ch === '|') { i++; prevHadQuantifier = false; continue }
    if (ch === '^' || ch === '$') { i++; continue }
    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      const isQuantifier = readQuantifier()
      if (!isQuantifier) { i++; prevHadQuantifier = false; continue }
      // 惰性 / 占有标记
      if (pattern[i] === '?') i++
      // 紧邻的两个量词：a++、\d*?+ 等（排除组修饰问号）
      if (prevHadQuantifier) return true
      prevHadQuantifier = true
      if (groupHadQuantifier.length) groupHadQuantifier[groupHadQuantifier.length - 1] = true
      continue
    }
    // 普通原子字符
    i++
    prevHadQuantifier = false
  }
  return false
}

function snippetAround(text: string, index: number, radius = 12): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + radius + 1)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/** 未匹配 / 回溯过多原因诊断 */
export function diagnose(pattern: string, testText: string, result: MatchResult): DiagnosisItem[] {
  const items: DiagnosisItem[] = []
  const ratio = result.totalSteps > 0 ? result.backtracks / result.totalSteps : 0

  if (!result.matched) {
    if (testText.length === 0) {
      items.push({
        level: 'critical',
        code: 'EMPTY_INPUT',
        title: '测试文本为空',
        detail: '当前测试文本长度为 0，没有任何字符可供引擎匹配；空结果是输入缺失而非正则错误。',
        suggestion: '在测试文本框中填入待匹配内容后重新执行。',
      })
    }

    if (pattern.includes('^') || pattern.includes('$')) {
      items.push({
        level: 'warning',
        code: 'ANCHOR_MISMATCH',
        title: '存在首尾锚点（^ / $）约束',
        detail:
          '正则包含 ^ 或 $，要求从字符串起始（或行首）开始、到字符串结尾（或行尾）结束完整匹配。' +
          '测试文本前后的空白、换行或多余字符都会导致整体未匹配。',
        suggestion: '检查测试文本首尾是否有空格 / 换行；若只想查找子串可尝试去掉锚点。',
      })
    }

    const failStep = [...result.steps].reverse().find((s) => s.transition === 'FAIL')
    if (failStep) {
      const chDisplay = failStep.char === '\n' ? '\\n' : failStep.char === '\t' ? '\\t' : failStep.char || 'EOF'
      items.push({
        level: 'warning',
        code: 'FIRST_FAIL_POSITION',
        title: `在字符索引 ${failStep.charIndex} 处匹配中断`,
        detail: `引擎推进到字符 '${chDisplay}'（索引 ${failStep.charIndex}）后没有任何可行的状态转移，该路径宣告失败。上下文：${snippetAround(testText, failStep.charIndex) || '（空）'}`,
        suggestion: '对照正则在该位置应满足的字符类别，检查字符是否拼写错误、大小写不符或缺少转义。',
      })
    }

    if (hasNestedQuantifier(pattern)) {
      items.push({
        level: 'critical',
        code: 'NESTED_QUANTIFIER',
        title: '检测到嵌套量词',
        detail: '正则中存在量词叠加（如 (a+)+、.*.*、\\d*+ 等结构），这类写法在输入不匹配时可能引发指数级回溯，是未匹配时耗时飙升的常见根因。',
        suggestion: '去掉冗余量词，或改用占有式 / 原子分组思路、字符类取反（如 [^x]*）限制重复范围。',
      })
    }

    if (items.filter((d) => d.level !== 'info').length === 0) {
      items.push({
        level: 'info',
        code: 'NO_MATCH_GENERIC',
        title: '所有起始位置均尝试失败',
        detail: `引擎已从测试文本的全部 ${testText.length + 1} 个起始位置尝试匹配，均未到达接受状态。`,
        suggestion: '建议用模板库中的近似模式对比，或先缩短测试文本二分定位不匹配的片段。',
      })
    }
  }

  // 回溯过多判定
  if (
    result.backtracks >= BACKTRACK_ABSOLUTE_THRESHOLD ||
    (result.totalSteps >= BACKTRACK_RATIO_MIN_STEPS && ratio >= BACKTRACK_RATIO_THRESHOLD)
  ) {
    items.push({
      level: result.backtracks >= BACKTRACK_ABSOLUTE_THRESHOLD * 5 ? 'critical' : 'warning',
      code: 'EXCESSIVE_BACKTRACK',
      title: `回溯过多：${result.backtracks} 次（占总步骤 ${(ratio * 100).toFixed(1)}%）`,
      detail: `总步骤 ${result.totalSteps} 中包含 ${result.backtracks} 次失败回退，回溯占比偏高，匹配效率低，输入稍长可能出现明显卡顿。`,
      suggestion: '优先检查贪婪量词（.*、.+）是否可以改为惰性或取反字符类；确认是否存在多选分支的重复尝试。',
    })
  }

  if (hasNestedQuantifier(pattern) && result.matched) {
    items.push({
      level: 'critical',
      code: 'NESTED_QUANTIFIER_RISK',
      title: '检测到嵌套量词，存在灾难性回溯风险',
      detail: '虽然当前文本可以匹配，但 (x+)+ 一类结构在近似但不完整的输入上会触发指数级路径爆炸。',
      suggestion: '在分享给他人前建议先消除嵌套量词，避免复现方使用长文本时卡死。',
    })
  }

  if (/\.\*|\.\+/.test(pattern) && result.backtracks > 0) {
    items.push({
      level: 'info',
      code: 'GREEDY_DOTSTAR',
      title: '贪婪的 .* / .+ 参与了回溯',
      detail: '模式中的贪婪通配会先吞掉尽可能多的字符，再逐字符退回以满足后续表达式，本次匹配中的回溯很可能来源于此。',
      suggestion: '尝试改为惰性（.*?）或更精确的取反字符类。',
    })
  }

  if (result.matched && result.backtracks === 0) {
    items.push({
      level: 'info',
      code: 'HEALTHY_MATCH',
      title: '匹配健康：无回溯',
      detail: `命中「${result.matchText}」，全程 ${result.totalSteps} 步且没有发生失败回退。`,
    })
  }

  if (items.length === 0) {
    items.push({
      level: 'info',
      code: 'OK',
      title: '未发现明显异常',
      detail: `匹配成功，回溯 ${result.backtracks} 次，处于正常范围。`,
    })
  }

  return items
}

/** 生成一份诊断报告（纯函数，不触碰工作台会话状态） */
export function generateReport(options: GenerateReportOptions): DiagnosticReport {
  const { title, pattern, flags, testText, result, nfa, sections, selectedGroups } = options

  if (!pattern) {
    throw new Error('正则表达式为空，无法生成报告')
  }

  const now = new Date().toISOString()
  const truncated = testText.length > MAX_TEST_TEXT_LENGTH
  const effectiveSections = Array.from(new Set([...REQUIRED_SECTIONS, ...sections])).sort(
    (a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b),
  ) as ReportSectionId[]

  const fingerprint = computeFingerprint(pattern, flags, result)
  const matchStart = result.matched ? testText.indexOf(result.matchText) : -1

  const report: DiagnosticReport = {
    id: genId(),
    title: title.trim() || `诊断报告 ${new Date().toLocaleString()}`,
    schemaVersion: SCHEMA_VERSION,
    pattern,
    flags,
    sections: effectiveSections,
    selectedGroups: [...selectedGroups].sort((a, b) => a - b),
    testText: {
      content: truncated ? testText.slice(0, MAX_TEST_TEXT_LENGTH) : testText,
      originalLength: testText.length,
      truncated,
      truncatedAt: truncated ? MAX_TEST_TEXT_LENGTH : 0,
      note: truncated
        ? `测试文本共 ${testText.length} 字符，超过 ${MAX_TEST_TEXT_LENGTH} 字符上限，已截断前 ${MAX_TEST_TEXT_LENGTH} 字符；截断报告无法在重新打开时自动复算校验。`
        : undefined,
    },
    diagnosis: diagnose(pattern, testText, result),
    repro: {
      schemaVersion: SCHEMA_VERSION,
      generator: 'regex-visual-debugger',
      appVersion: APP_VERSION,
      createdAt: now,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      textLength: testText.length,
      textTruncated: truncated,
      fingerprint,
    },
  }

  if (effectiveSections.includes('summary')) {
    const groups = result.groups.map((value, index) => ({
      index,
      value,
      empty: value.length === 0,
    }))
    report.summary = {
      matched: result.matched,
      matchText: result.matchText,
      matchStart,
      matchEnd: matchStart >= 0 ? matchStart + result.matchText.length : -1,
      groupsCount: result.groups.length,
      groups,
      emptyResult: !result.matched,
      note: !result.matched
        ? '匹配结果为空：引擎从全部起始位置尝试后均未到达接受状态，分组捕获同样为空。'
        : undefined,
    }
  }

  if (effectiveSections.includes('performance')) {
    report.performance = {
      totalSteps: result.totalSteps,
      backtracks: result.backtracks,
      duration: result.duration,
      backtrackRatio: result.totalSteps > 0 ? result.backtracks / result.totalSteps : 0,
      statesCount: nfa?.states.length ?? 0,
      transitionsCount: nfa?.transitions.length ?? 0,
    }
  }

  if (effectiveSections.includes('backtracks')) {
    const all = result.steps
      .filter((s) => s.isBacktrack)
      .map((s) => ({ stepIndex: s.stepIndex, charIndex: s.charIndex, char: s.char, fromState: s.currentState }))
    report.backtracks = {
      entries: all.slice(0, MAX_BACKTRACK_STEPS),
      totalCount: all.length,
      truncated: all.length > MAX_BACKTRACK_STEPS,
    }
  }

  return report
}

/** 重新打开报告时用报告内的正则 + 文本重跑引擎，比对关键数字是否仍与工作台一致 */
export function verifyReport(report: DiagnosticReport): ReportVerifyResult {
  if (report.repro.textTruncated || report.testText.truncated) {
    return {
      status: 'unverifiable',
      diffs: [],
      message: `测试文本在导出时已截断（原始 ${report.testText.originalLength} 字符，仅保留前 ${report.testText.content.length} 字符），无法用完整输入复算，关键数字以报告记录值为准。`,
    }
  }

  let result: MatchResult
  try {
    const built = buildNFA(report.pattern)
    result = runMatch(built.states, built.startState, report.testText.content, {
      startAnchor: built.startAnchor,
      endAnchor: built.endAnchor,
    })
  } catch (e: any) {
    return {
      status: 'engine-error',
      diffs: [],
      message: `当前版本引擎无法解析报告中的正则：${e?.message || '未知错误'}。报告记录的数字仍可直接查看。`,
    }
  }

  const diffs: string[] = []
  const check = (label: string, recorded: unknown, actual: unknown) => {
    if (String(recorded) !== String(actual)) {
      diffs.push(`${label}：报告记录 ${String(recorded)}，当前复算 ${String(actual)}`)
    }
  }

  const recordedInputs = {
    matched: report.summary?.matched ?? result.matched,
    matchText: report.summary?.matchText ?? result.matchText,
    totalSteps: report.performance?.totalSteps ?? result.totalSteps,
    backtracks: report.performance?.backtracks ?? result.backtracks,
  }
  if (report.summary) {
    check('匹配状态', recordedInputs.matched ? '匹配' : '未匹配', result.matched ? '匹配' : '未匹配')
    check('命中文本', recordedInputs.matchText || '（空）', result.matchText || '（空）')
  }
  if (report.performance) {
    check('总步数', recordedInputs.totalSteps, result.totalSteps)
    check('回溯次数', recordedInputs.backtracks, result.backtracks)
  }
  // 用记录值重算指纹：与存储指纹不一致说明文件在导出后被改动过
  if (report.repro.fingerprint !== computeFingerprint(report.pattern, report.flags, recordedInputs)) {
    diffs.push('报告指纹校验失败：文件内容可能在导出后被修改')
  }

  return {
    status: diffs.length > 0 ? 'inconsistent' : 'consistent',
    diffs,
    message:
      diffs.length > 0
        ? '关键数字与当前引擎复算结果不一致（耗时受机器影响不参与比对）：'
        : '已用报告内正则与完整测试文本重新执行，关键数字与原工作台一致。（耗时受运行环境影响，仅供参考）',
    rerun: {
      matched: result.matched,
      matchText: result.matchText,
      totalSteps: result.totalSteps,
      backtracks: result.backtracks,
      duration: result.duration,
    },
  }
}

/** 解析并校验导入的报告文件内容 */
export function parseReport(text: string): DiagnosticReport {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是合法的 JSON，无法导入')
  }
  if (!data || typeof data !== 'object') throw new Error('报告内容为空或格式不正确')
  if (data.repro?.generator !== 'regex-visual-debugger') {
    throw new Error('不是本工具导出的诊断报告（缺少生成器标识）')
  }
  if (typeof data.pattern !== 'string' || !Array.isArray(data.sections) || !Array.isArray(data.diagnosis)) {
    throw new Error('报告缺少必要字段（pattern / sections / diagnosis）')
  }
  if (typeof data.schemaVersion !== 'number') {
    throw new Error('报告缺少 schemaVersion，无法确认兼容性')
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`报告版本 v${data.schemaVersion} 高于当前支持的 v${SCHEMA_VERSION}，请升级工具后再打开`)
  }
  if (!data.testText || typeof data.testText.content !== 'string') {
    throw new Error('报告缺少测试文本快照')
  }
  return data as DiagnosticReport
}

export function serializeReport(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2)
}

function safeFileName(name: string): string {
  return (
    (name || 'diagnostic-report')
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) || 'diagnostic-report'
  )
}

/** 触发浏览器下载为 .json 文件 */
export function downloadReport(report: DiagnosticReport): void {
  if (typeof document === 'undefined') throw new Error('当前环境不支持文件下载')
  const blob = new Blob([serializeReport(report)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFileName(report.title)}_${report.id.slice(0, 8)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
