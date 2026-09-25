export interface NFAState {
  id: number
  isStart: boolean
  isAccept: boolean
  x: number
  y: number
}

export interface NFATransition {
  from: number
  to: number
  symbol: string | null // null = epsilon
  label: string
}

export interface NFA {
  states: NFAState[]
  transitions: NFATransition[]
  startState: number
  acceptStates: number[]
}

export interface MatchStep {
  stepIndex: number
  charIndex: number
  char: string
  currentState: number
  nextState: number
  transition: string
  isBacktrack: boolean
  isMatch: boolean
}

export interface MatchResult {
  matched: boolean
  matchText: string
  groups: string[]
  steps: MatchStep[]
  backtracks: number
  totalSteps: number
  duration: number
}

export interface RegexTemplate {
  name: string
  pattern: string
  description: string
  testString: string
  category: string
}

export interface ASTNode {
  type: 'char' | 'star' | 'plus' | 'question' | 'or' | 'concat' | 'group' | 'dot' | 'anchor' | 'charclass' | 'digit' | 'word' | 'space'
  value?: string
  children?: ASTNode[]
  groupIndex?: number
}

// ===== 诊断报告相关类型 =====

export type ReportSectionId =
  | 'pattern'      // 当前正则（必含）
  | 'summary'      // 匹配摘要
  | 'diagnosis'    // 未匹配 / 回溯过多原因（必含）
  | 'performance'  // 性能指标
  | 'backtracks'   // 回溯步骤
  | 'groups'       // 分组捕获
  | 'testText'     // 测试文本
  | 'repro'        // 复现信息（必含）

export interface ReportSectionOption {
  id: ReportSectionId
  label: string
  description: string
  required: boolean
}

export interface MatchSummaryData {
  matched: boolean
  matchText: string
  matchStart: number
  matchEnd: number
  groupsCount: number
  groups: Array<{ index: number; value: string; empty: boolean }>
  emptyResult: boolean
  note?: string
}

export interface PerformanceData {
  totalSteps: number
  backtracks: number
  duration: number
  backtrackRatio: number
  statesCount: number
  transitionsCount: number
}

export interface BacktrackEntry {
  stepIndex: number
  charIndex: number
  char: string
  fromState: number
}

export interface TestTextSnapshot {
  content: string
  originalLength: number
  truncated: boolean
  truncatedAt: number
  note?: string
}

export type DiagnosisLevel = 'info' | 'warning' | 'critical'

export interface DiagnosisItem {
  level: DiagnosisLevel
  code: string
  title: string
  detail: string
  suggestion?: string
}

export interface ReproInfo {
  schemaVersion: number
  generator: string
  appVersion: string
  createdAt: string
  userAgent: string
  textLength: number
  textTruncated: boolean
  fingerprint: string
}

export interface DiagnosticReport {
  id: string
  title: string
  schemaVersion: number
  pattern: string
  flags: string
  sections: ReportSectionId[]
  selectedGroups: number[]
  testText: TestTextSnapshot
  summary?: MatchSummaryData
  performance?: PerformanceData
  backtracks?: {
    entries: BacktrackEntry[]
    totalCount: number
    truncated: boolean
  }
  diagnosis: DiagnosisItem[]
  repro: ReproInfo
  savedAt?: string
}

export type ReportVerifyStatus = 'consistent' | 'inconsistent' | 'unverifiable' | 'engine-error'

export interface ReportVerifyResult {
  status: ReportVerifyStatus
  diffs: string[]
  message: string
  rerun?: {
    matched: boolean
    matchText: string
    totalSteps: number
    backtracks: number
    duration: number
  }
}

export interface GenerateReportOptions {
  title: string
  pattern: string
  flags: string
  testText: string
  result: MatchResult
  nfa: NFA | null
  sections: ReportSectionId[]
  selectedGroups: number[]
}
