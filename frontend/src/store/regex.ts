import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NFA, MatchResult, MatchStep, RegexTemplate, ASTNode } from '../types'

const GROUP_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

export const TEMPLATES: RegexTemplate[] = [
  { name: '邮箱地址', pattern: '^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\\.([a-zA-Z]{2,})$', description: '匹配标准邮箱格式：用户名@域名.顶级域', testString: 'user@example.com admin@mail.org test.user+tag@sub.domain.co.uk', category: '常用' },
  { name: 'URL链接', pattern: '^(https?)://([^/:]+)(?::(\\d+))?(.*)$', description: '匹配HTTP/HTTPS URL：协议://主机:端口/路径', testString: 'https://www.example.com:8080/path/to/page http://localhost:3000/api', category: '常用' },
  { name: 'IPv4地址', pattern: '^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$', description: '匹配IPv4地址四段数字', testString: '192.168.1.1 10.0.0.1 255.255.255.0', category: '常用' },
  { name: '日期格式', pattern: '^(\\d{4})-(\\d{2})-(\\d{2})$', description: '匹配YYYY-MM-DD日期', testString: '2024-01-15 1999-12-31 2025-06-06', category: '常用' },
  { name: '手机号码', pattern: '^1[3-9]\\d{9}$', description: '匹配中国大陆手机号', testString: '13800138000 15912345678 18600000000', category: '常用' },
  { name: '身份证号', pattern: '^(\\d{6})(\\d{4})(\\d{2})(\\d{2})(\\d{3})([0-9Xx])$', description: '18位身份证：地区码+出生日期+顺序码+校验码', testString: '11010119900101001X 440304200512120039', category: '常用' },
  { name: '十六进制颜色', pattern: '^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$', description: '匹配#RGB或#RRGGBB格式', testString: '#FF5733 #abc #1A2B3C ff0000', category: '前端' },
  { name: '邮政编码', pattern: '^\\d{6}$', description: '6位中国邮编', testString: '100000 518000 200120', category: '常用' },
  { name: '浮点数', pattern: '^-?\\d+\\.\\d+$', description: '匹配带小数点的数字', testString: '3.14 -0.5 100.0', category: '数字' },
  { name: '科学计数法', pattern: '^-?\\d+(\\.\\d+)?[eE][+-]?\\d+$', description: '匹配科学计数法数字', testString: '1.5e10 -2.3E-4 6.022e23', category: '数字' },
  { name: 'MAC地址', pattern: '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$', description: '匹配MAC地址XX:XX:XX:XX:XX:XX', testString: '00:1A:2B:3C:4D:5E AA-BB-CC-DD-EE-FF', category: '网络' },
  { name: 'UUID', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', description: '标准UUID格式', testString: '550e8400-e29b-41d4-a716-446655440000', category: '网络' },
  { name: 'QQ号', pattern: '^[1-9]\\d{4,10}$', description: '5-11位QQ号', testString: '12345 10000 1234567890', category: '常用' },
  { name: '密码强度', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$', description: '至少8位含大小写字母数字特殊字符', testString: 'Passw0rd! Str0ng@Pass', category: '安全' },
  { name: '中文姓名', pattern: '^[\\u4e00-\\u9fa5]{2,4}$', description: '2-4位中文字符', testString: '张三 李世明 王小明', category: '常用' },
  { name: '车牌号', pattern: '^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-HJ-NP-Z0-9]{5}$', description: '中国车牌格式', testString: '京A12345 沪B6789X', category: '常用' },
  { name: 'HTML标签', pattern: '<(\\w+)(\\s[^>]*)?>(.*?)</\\1>', description: '匹配HTML开闭标签对', testString: '<div class="x">content</div> <span>text</span>', category: '前端' },
  { name: '文件扩展名', pattern: '^.+\\.(\\w+)$', description: '提取文件扩展名', testString: 'image.png doc.pdf index.html', category: '前端' },
  { name: '经纬度', pattern: '^(\\-?\\d{1,3}\\.\\d+)\\s*,\\s*(\\-?\\d{1,3}\\.\\d+)$', description: '匹配经纬度坐标', testString: '116.404,39.915 -73.9857,40.7484', category: '地理' },
  { name: '版本号', pattern: '^(\\d+)\\.(\\d+)\\.(\\d+)(?:-(\\w+))?$', description: '语义化版本号x.y.z-tag', testString: '1.0.0 2.3.1-beta 10.20.30', category: '常用' },
  { name: '时间格式', pattern: '^([01]?\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$', description: 'HH:MM或HH:MM:SS', testString: '14:30 23:59:59 00:00', category: '常用' }
]

interface StateNode {
  id: number
  isAccept: boolean
  transitions: Map<string, number[]>
  epsilonTransitions: number[]
}

export function buildNFA(pattern: string): { states: StateNode[]; startState: number; acceptStates: number[]; startAnchor: boolean; endAnchor: boolean } {
  const states: StateNode[] = []
  let stateCounter = 0
  let pos = 0
  let groupCount = 0
  let startAnchor = false
  let endAnchor = false

  function newState(): number {
    const id = stateCounter++
    states.push({ id, isAccept: false, transitions: new Map(), epsilonTransitions: [] })
    return id
  }

  function addTransition(from: number, symbol: string, to: number) {
    if (!states[from].transitions.has(symbol)) {
      states[from].transitions.set(symbol, [])
    }
    states[from].transitions.get(symbol)!.push(to)
  }

  function addEpsilon(from: number, to: number) {
    states[from].epsilonTransitions.push(to)
  }

  // 深拷贝一段子 NFA（用于 {n,m} 区间量词的重复构建）
  function cloneFrag(s: number, e: number): [number, number] {
    const reachable = new Set<number>([s])
    const stack = [s]
    while (stack.length) {
      const id = stack.pop()!
      const node = states[id]
      node.transitions.forEach((targets) => targets.forEach((t) => { if (!reachable.has(t)) { reachable.add(t); stack.push(t) } }))
      node.epsilonTransitions.forEach((t) => { if (!reachable.has(t)) { reachable.add(t); stack.push(t) } })
    }
    const idMap = new Map<number, number>()
    reachable.forEach((oldId) => { idMap.set(oldId, newState()) })
    reachable.forEach((oldId) => {
      const src = states[oldId]
      const dst = states[idMap.get(oldId)!]
      src.transitions.forEach((targets, symbol) => {
        targets.forEach((t) => {
          if (idMap.has(t)) dst.transitions.set(symbol, [...(dst.transitions.get(symbol) || []), idMap.get(t)!])
        })
      })
      if ((src as any)._matcher) (dst as any)._matcher = (src as any)._matcher
      dst.epsilonTransitions = src.epsilonTransitions.filter((t) => idMap.has(t)).map((t) => idMap.get(t)!)
    })
    return [idMap.get(s)!, idMap.get(e)!]
  }

  function parseCharClass(): (ch: string) => boolean {
    const negative = pattern[pos] === '^'
    if (negative) pos++
    const ranges: [string, string][] = []
    const chars: string[] = []
    const readEscape = (): { ch: string; size: number } | null => {
      if (pattern[pos] !== '\\') return null
      const marker = pattern[pos + 1]
      if (marker === 'u' || marker === 'x') {
        const width = marker === 'u' ? 4 : 2
        const code = parseInt(pattern.slice(pos + 2, pos + 2 + width), 16)
        if (Number.isNaN(code)) return null
        return { ch: String.fromCodePoint(code), size: 2 + width }
      }
      return { ch: pattern[pos + 1], size: 2 }
    }

    while (pos < pattern.length && pattern[pos] !== ']') {
      const esc1 = readEscape()
      const first = esc1?.ch ?? pattern[pos]
      const firstSize = esc1?.size ?? 1
      // 形如 X-Y 的范围（X、Y 均可为转义）
      if (pattern[pos + firstSize] === '-' && pattern[pos + firstSize + 1] && pattern[pos + firstSize + 1] !== ']') {
        const rangeDashPos = pos + firstSize
        const savedPos = pos
        pos = rangeDashPos + 1
        const esc2 = readEscape()
        const second = esc2?.ch ?? pattern[pos]
        const secondSize = esc2?.size ?? 1
        ranges.push([first, second])
        pos = rangeDashPos + 1 + secondSize
        void savedPos
        continue
      }
      chars.push(first)
      pos += firstSize
    }
    pos++ // skip ]
    return (ch: string) => {
      if (negative) {
        return !chars.includes(ch) && !ranges.some(([s, e]) => ch >= s && ch <= e)
      }
      return chars.includes(ch) || ranges.some(([s, e]) => ch >= s && ch <= e)
    }
  }

  function parseConcat(): [number, number] {
    let start = -1
    let end = -1
    let prevEnd = -1
    while (pos < pattern.length && !['|', ')'].includes(pattern[pos])) {
      let segStart = 0, segEnd = 0
      let zeroLen = false
      const ch = pattern[pos]
      if (ch === '(') {
        pos++
        groupCount++
        if (pattern[pos] === '?') {
          pos++
          if (pattern[pos] === ':') { pos++; }
          else if (pattern[pos] === '=' || pattern[pos] === '!') {
            throw new Error(`暂不支持${pattern[pos] === '=' ? '正向先行断言 (?=...)' : '负向先行断言 (?!...)'}，请改用普通字符类或分组后再试`)
          }
          else if (pattern[pos] === '<') {
            throw new Error('暂不支持后行断言 (?<= / (?<!)，请改用普通分组')
          }
          const [s, e] = parseOr()
          segStart = s; segEnd = e
        } else {
          const [s, e] = parseOr()
          segStart = s; segEnd = e
        }
        pos++ // skip )
      } else if (ch === '[') {
        pos++
        segStart = newState()
        segEnd = newState()
        const matcher = parseCharClass()
        addTransition(segStart, '__class_' + segStart, segEnd)
        ;(states[segStart] as any)._matcher = matcher
      } else if (ch === '.') {
        segStart = newState()
        segEnd = newState()
        addTransition(segStart, '__dot', segEnd)
        pos++
      } else if (ch === '\\') {
        pos++
        const escaped = pattern[pos]
        segStart = newState()
        segEnd = newState()
        if (escaped === 'd') addTransition(segStart, '__digit', segEnd)
        else if (escaped === 'w') addTransition(segStart, '__word', segEnd)
        else if (escaped === 's') addTransition(segStart, '__space', segEnd)
        else if (escaped >= '1' && escaped <= '9') {
          throw new Error(`暂不支持反向引用 \\${escaped}，请改用具体字符或分组后再试`)
        }
        else if (escaped === 'u' || escaped === 'x') {
          // \uXXXX / \xXX 十六进制码位转义
          const width = escaped === 'u' ? 4 : 2
          const hex = pattern.slice(pos + 1, pos + 1 + width)
          const code = parseInt(hex, 16)
          const target = Number.isNaN(code) ? escaped : String.fromCodePoint(code)
          addTransition(segStart, target, segEnd)
          pos += width
        }
        else addTransition(segStart, escaped, segEnd)
        pos++
      } else if (ch === '^' || ch === '$') {
        // 锚点不消耗字符、不产生状态与连接边，只记录约束
        if (ch === '^') startAnchor = true
        else endAnchor = true
        pos++
        zeroLen = true
      } else {
        segStart = newState()
        segEnd = newState()
        addTransition(segStart, ch, segEnd)
        pos++
      }

      if (zeroLen) continue

      // Handle quantifiers
      while (pos < pattern.length && ['*', '+', '?', '{'].includes(pattern[pos])) {
        const q = pattern[pos]
        if (q === '{') {
          // 解析 {n}、{n,}、{n,m}
          const braceStart = pos + 1
          let braceEnd = braceStart
          while (braceEnd < pattern.length && pattern[braceEnd] !== '}') braceEnd++
          const spec = pattern.slice(braceStart, braceEnd)
          pos = braceEnd < pattern.length ? braceEnd + 1 : braceEnd
          const m = /^(\d+)?(\s*,\s*(\d+)?)?$/.exec(spec)
          if (!m || m[1] === undefined) {
            // 不是合法量词（如 {,3} 或 {}），按普通字符处理（'{' 已被跳过）
            break
          }
          const min = parseInt(m[1], 10)
          const hasComma = m[2] !== undefined
          const hasMax = m[3] !== undefined
          const max = hasMax ? parseInt(m[3], 10) : Infinity
          if (hasComma && hasMax && max < min) break // 非法区间，放弃量词
          const qStart = newState()
          const qEnd = newState()

          // 先一次性克隆出所有需要的片段拷贝。
          // 必须在任何 ε 连接边触碰原片段之前完成克隆，否则从片段末端可达性会泄漏到后续结构。
          const copies: Array<[number, number]> = [[segStart, segEnd]]
          const copyCount = hasMax ? max : min + 1 // {n,m} 需要 max 份；{n,} 需要 n 份必需 + 1 份循环
          for (let k = 1; k < copyCount; k++) copies.push(cloneFrag(segStart, segEnd))

          // 串联前 min 份必需片段（用新的连接状态，避免改动片段自身的出入边）
          let cur = qStart
          for (let k = 0; k < min; k++) {
            const [cs, ce] = copies[k]
            addEpsilon(cur, cs)
            cur = newState()
            addEpsilon(ce, cur)
          }

          if (!hasComma) {
            // {n}：恰 n 次，直接结束
            addEpsilon(cur, qEnd)
          } else if (!hasMax) {
            // {n,}：n 份必需之后，再串 1 份可重复 0..∞ 次的片段
            const [loopS, loopE] = copies[min]
            const join = newState()
            addEpsilon(cur, qEnd)    // 恰 n 次结束
            addEpsilon(cur, join)    // 或继续
            addEpsilon(join, loopS)
            addEpsilon(loopE, join)  // 自环重复
            addEpsilon(loopE, qEnd)  // 重复后结束
          } else {
            // {n,m}：n 份必需之后，剩余片段逐个可选（任一前缀长度都可结束）
            for (let k = min; k < max; k++) {
              const [cs, ce] = copies[k]
              addEpsilon(cur, qEnd) // 在此处停止也合法
              const join = newState()
              addEpsilon(cur, cs)
              addEpsilon(ce, join)
              cur = join
            }
            addEpsilon(cur, qEnd)
          }
          segStart = qStart; segEnd = qEnd
        } else {
          pos++
          const qStart = newState()
          const qEnd = newState()
          addEpsilon(qStart, segStart)
          if (q === '*') { addEpsilon(qStart, qEnd); addEpsilon(segEnd, qEnd); addEpsilon(segEnd, segStart) }
          else if (q === '+') { addEpsilon(segEnd, qEnd); addEpsilon(segEnd, segStart) }
          else if (q === '?') { addEpsilon(qStart, qEnd); addEpsilon(segEnd, qEnd) }
          segStart = qStart; segEnd = qEnd
        }
        if (pos < pattern.length && pattern[pos] === '?') pos++ // lazy
      }

      // 连接相邻片段
      if (start === -1) {
        start = segStart
      } else {
        addEpsilon(prevEnd, segStart)
      }
      end = segEnd
      prevEnd = segEnd
    }
    // 全部为零长度（仅锚点 / 空表达式）：用单个状态表示
    if (start === -1) { start = newState(); end = start }
    return [start, end]
  }

  function parseOr(): [number, number] {
    const [s1, e1] = parseConcat()
    let start = s1, end = e1
    while (pos < pattern.length && pattern[pos] === '|') {
      pos++
      const [s2, e2] = parseConcat()
      const ns = newState(), ne = newState()
      addEpsilon(ns, start); addEpsilon(ns, s2)
      addEpsilon(end, ne); addEpsilon(e2, ne)
      start = ns; end = ne
    }
    return [start, end]
  }

  const [startState, acceptState] = parseOr()
  states[acceptState].isAccept = true
  return { states, startState, acceptStates: [acceptState], startAnchor, endAnchor }
}

function epsilonClosure(states: StateNode[], stateId: number): Set<number> {
  const closure = new Set<number>([stateId])
  const stack = [stateId]
  while (stack.length) {
    const s = stack.pop()!
    for (const next of states[s].epsilonTransitions) {
      if (!closure.has(next)) {
        closure.add(next)
        stack.push(next)
      }
    }
  }
  return closure
}

function matchTransition(state: StateNode, symbol: string): number[] {
  const results: number[] = []
  for (const [sym, targets] of state.transitions) {
    if (sym === symbol) { results.push(...targets); continue }
    if (sym === '__dot' && symbol !== '\n') { results.push(...targets); continue }
    if (sym === '__digit' && /\d/.test(symbol)) { results.push(...targets); continue }
    if (sym === '__word' && /\w/.test(symbol)) { results.push(...targets); continue }
    if (sym === '__space' && /\s/.test(symbol)) { results.push(...targets); continue }
    if (sym.startsWith('__class_')) {
      const matcher = (state as any)._matcher
      if (matcher && matcher(symbol)) results.push(...targets)
    }
  }
  return results
}

export function runMatch(
  states: StateNode[],
  startState: number,
  input: string,
  anchors: { startAnchor: boolean; endAnchor: boolean } = { startAnchor: false, endAnchor: false },
): MatchResult {
  const steps: MatchStep[] = []
  let backtracks = 0
  let stepIndex = 0
  const startTime = performance.now()

  const acceptsAt = (stateIds: number[], i: number): boolean => {
    if (!stateIds.some((s) => states[s].isAccept)) return false
    // 结尾锚点要求接受位置恰好位于字符串末尾
    return !anchors.endAnchor || i === input.length
  }

  // Try to match from each position
  for (let startPos = 0; startPos <= input.length; startPos++) {
    if (anchors.startAnchor && startPos !== 0) break
    let currentStates = Array.from(epsilonClosure(states, startState))
    // 该起点记录到的最长合法接受点（贪婪）。
    // $ 锚点要求接受位置恰好为字符串末尾；非锚点匹配在任何位置接受都有效。
    let bestEnd = -1

    if (acceptsAt(currentStates, startPos)) bestEnd = startPos

    let failed = false
    for (let i = startPos; i < input.length; i++) {
      const char = input[i]
      const nextStates: number[] = []
      const seen = new Set<number>()

      for (const s of currentStates) {
        const targets = matchTransition(states[s], char)
        for (const t of targets) {
          const closure = epsilonClosure(states, t)
          for (const c of closure) {
            if (!seen.has(c)) {
              seen.add(c)
              nextStates.push(c)
              steps.push({
                stepIndex: stepIndex++,
                charIndex: i,
                char,
                currentState: s,
                nextState: c,
                transition: char,
                isBacktrack: false,
                isMatch: true
              })
            }
          }
        }
      }

      if (nextStates.length === 0) {
        failed = true
        break
      }
      currentStates = nextStates
      if (acceptsAt(currentStates, i + 1)) bestEnd = i + 1
    }

    // 扫描正常结束（字符全部消耗）时再确认一次末尾接受
    if (!failed && acceptsAt(currentStates, input.length)) bestEnd = input.length
    // $ 锚点：只有完整覆盖到字符串末尾的接受才有效
    if (anchors.endAnchor && bestEnd !== input.length) bestEnd = -1

    if (bestEnd !== -1) {
      const matchText = input.substring(startPos, bestEnd)
      const duration = performance.now() - startTime
      return {
        matched: true,
        matchText,
        groups: [matchText],
        steps,
        backtracks,
        totalSteps: stepIndex,
        duration: Math.round(duration * 100) / 100
      }
    }

    // 该起点确实做过尝试但失败：计一次回溯（失败回退）
    backtracks++
    steps.push({
      stepIndex: stepIndex++,
      charIndex: startPos,
      char: input[startPos] || '',
      currentState: startState,
      nextState: -1,
      transition: 'FAIL',
      isBacktrack: true,
      isMatch: false
    })
  }

  const duration = performance.now() - startTime
  return { matched: false, matchText: '', groups: [], steps, backtracks, totalSteps: stepIndex, duration: Math.round(duration * 100) / 100 }
}

export function computeNFA(nfaResult: ReturnType<typeof buildNFA>): NFA {
  const nodes = nfaResult.states.map((s, i) => ({
    id: s.id,
    isStart: i === nfaResult.startState,
    isAccept: nfaResult.acceptStates.includes(s.id),
    x: 0, y: 0
  }))

  // Layout: circular
  const cx = 400, cy = 300, radius = 200
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    n.x = cx + Math.cos(angle) * radius
    n.y = cy + Math.sin(angle) * radius
  })

  const transitions: any[] = []
  nfaResult.states.forEach(s => {
    s.transitions.forEach((targets, symbol) => {
      targets.forEach(t => {
        transitions.push({ from: s.id, to: t, symbol: symbol.startsWith('__') ? symbol.replace('__', '') : symbol, label: symbol.startsWith('__') ? symbol.replace('__', '') : symbol })
      })
    })
    s.epsilonTransitions.forEach(t => {
      transitions.push({ from: s.id, to: t, symbol: null, label: 'ε' })
    })
  })

  return { states: nodes, transitions, startState: nfaResult.startState, acceptStates: nfaResult.acceptStates }
}

export function parseAST(pattern: string): ASTNode {
  let pos = 0
  let groupIdx = 0

  function parseAtom(): ASTNode {
    const ch = pattern[pos]
    if (ch === '(') {
      pos++
      if (pattern[pos] === '?') { pos++; if (pattern[pos] === ':') pos++ }
      else groupIdx++
      const node = parseOr()
      if (pattern[pos] === ')') pos++
      return { type: 'group', children: [node], groupIndex: groupIdx }
    }
    if (ch === '[') {
      pos++
      let cls = ''
      while (pos < pattern.length && pattern[pos] !== ']') { cls += pattern[pos]; pos++ }
      pos++
      return { type: 'charclass', value: cls }
    }
    if (ch === '.') { pos++; return { type: 'dot' } }
    if (ch === '\\') {
      pos++
      const e = pattern[pos]; pos++
      if (e === 'd') return { type: 'digit' }
      if (e === 'w') return { type: 'word' }
      if (e === 's') return { type: 'space' }
      return { type: 'char', value: e }
    }
    if (ch === '^' || ch === '$') { pos++; return { type: 'anchor', value: ch } }
    pos++
    return { type: 'char', value: ch }
  }

  function parseQuantifier(): ASTNode {
    let node = parseAtom()
    while (pos < pattern.length && ['*', '+', '?', '{'].includes(pattern[pos])) {
      const q = pattern[pos]
      if (q === '{') {
        while (pos < pattern.length && pattern[pos] !== '}') pos++
        pos++
      } else {
        pos++
      }
      const type = q === '*' ? 'star' : q === '+' ? 'plus' : 'question'
      node = { type, children: [node] }
      if (pos < pattern.length && pattern[pos] === '?') pos++
    }
    return node
  }

  function parseConcat(): ASTNode {
    const nodes: ASTNode[] = []
    while (pos < pattern.length && !['|', ')'].includes(pattern[pos])) {
      nodes.push(parseQuantifier())
    }
    if (nodes.length === 1) return nodes[0]
    return { type: 'concat', children: nodes }
  }

  function parseOr(): ASTNode {
    let left = parseConcat()
    while (pos < pattern.length && pattern[pos] === '|') {
      pos++
      const right = parseConcat()
      left = { type: 'or', children: [left, right] }
    }
    return left
  }

  return parseOr()
}

export const useRegexStore = defineStore('regex', () => {
  const pattern = ref('^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\\.([a-zA-Z]{2,})$')
  const testString = ref('user@example.com')
  const currentStep = ref(0)
  const isPlaying = ref(false)
  const nfa = ref<NFA | null>(null)
  const matchResult = ref<MatchResult | null>(null)
  const ast = ref<ASTNode | null>(null)
  const error = ref('')
  const selectedTemplate = ref<string>('')

  const groupColors = GROUP_COLORS

  const matchHighlight = computed(() => {
    if (!matchResult.value || !matchResult.value.matched) return null
    const matchText = matchResult.value.matchText
    const idx = testString.value.indexOf(matchText)
    if (idx === -1) return null
    return {
      before: testString.value.substring(0, idx),
      match: matchText,
      after: testString.value.substring(idx + matchText.length)
    }
  })

  function execute() {
    error.value = ''
    try {
      const built = buildNFA(pattern.value)
      nfa.value = computeNFA(built)
      matchResult.value = runMatch(built.states, built.startState, testString.value, {
        startAnchor: built.startAnchor,
        endAnchor: built.endAnchor,
      })
      ast.value = parseAST(pattern.value)
      currentStep.value = 0
    } catch (e: any) {
      error.value = e.message || '正则表达式解析错误'
      nfa.value = null
      matchResult.value = null
      ast.value = null
    }
  }

  function setPattern(p: string) {
    pattern.value = p
    execute()
  }

  function setTestString(s: string) {
    testString.value = s
    execute()
  }

  function applyTemplate(t: RegexTemplate) {
    pattern.value = t.pattern
    testString.value = t.testString
    selectedTemplate.value = t.name
    execute()
  }

  function stepForward() {
    if (matchResult.value && currentStep.value < matchResult.value.steps.length - 1) {
      currentStep.value++
    }
  }

  function stepBackward() {
    if (currentStep.value > 0) currentStep.value--
  }

  function resetStep() {
    currentStep.value = 0
  }

  function play() {
    isPlaying.value = true
    const interval = setInterval(() => {
      if (matchResult.value && currentStep.value < matchResult.value.steps.length - 1) {
        currentStep.value++
      } else {
        isPlaying.value = false
        clearInterval(interval)
      }
    }, 200)
  }

  function stop() {
    isPlaying.value = false
  }

  return {
    pattern, testString, currentStep, isPlaying, nfa, matchResult, ast, error,
    selectedTemplate, groupColors, matchHighlight,
    execute, setPattern, setTestString, applyTemplate,
    stepForward, stepBackward, resetStep, play, stop
  }
})
