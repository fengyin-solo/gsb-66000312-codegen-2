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

// ===== 诊断报告 =====

export type ReportSectionId =
  | 'pattern'
  | 'testText'
  | 'summary'
  | 'diagnosis'
  | 'steps'
  | 'groups'
  | 'metrics'
  | 'repro'

export type ReportSeverity = 'error' | 'warning' | 'info'

export interface ReportFinding {
  id: string
  severity: ReportSeverity
  title: string
  detail: string
  suggestion?: string
}

export interface ReportMetrics {
  totalSteps: number
  backtracks: number
  duration: number
  inputLength: number
  nfaStates: number
  nfaTransitions: number
}

export interface ReportChecksum {
  algorithm: string
  /** 对核心复现信息（pattern + testText + 关键指标）计算的校验和 */
  value: string
}

export interface DiagnosticReport {
  format: 'regex-diagnostic-report'
  version: 1
  id: string
  createdAt: string
  appVersion: string
  title: string
  note: string
  sections: ReportSectionId[]
  pattern: string
  flags: string
  testText: string
  testTextLength: number
  testTextTruncated: boolean
  /** 超长文本在文件中保留的最大长度，超过则截断 */
  testTextMaxStored: number
  testTextSha256?: string
  matched: boolean
  matchText: string
  captureGroups: string[]
  steps: MatchStep[]
  stepsTruncated: boolean
  totalStepCount: number
  backtracks: number
  metrics: ReportMetrics
  findings: ReportFinding[]
  engine: {
    name: string
    version: string
    userAgent: string
  }
  checksum: ReportChecksum
}

/** 最近生成/打开过的报告（保留在当前会话并持久化） */
export interface SavedReport {
  id: string
  title: string
  createdAt: string
  matched: boolean
  backtracks: number
  totalSteps: number
  report: DiagnosticReport
}
