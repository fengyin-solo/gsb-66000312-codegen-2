<template>
  <Teleport to="body">
    <div v-if="reportStore.viewerOpen && report" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" @click.self="close">
      <div class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <!-- 头部 -->
        <div class="flex items-start justify-between px-5 py-4 border-b border-slate-700">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-lg font-bold text-cyan-400 truncate">{{ report.title }}</h2>
              <span class="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">v{{ report.schemaVersion }}</span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">生成于 {{ new Date(report.repro.createdAt).toLocaleString() }} · 报告 ID {{ report.id.slice(0, 8) }}</p>
          </div>
          <button @click="close" class="text-slate-500 hover:text-slate-300 text-xl leading-none ml-2">✕</button>
        </div>

        <!-- 校验条 -->
        <div v-if="verify" class="px-5 py-2.5 border-b text-sm flex items-start gap-2"
          :class="verifyClass">
          <span class="shrink-0">{{ verifyIcon }}</span>
          <div class="flex-1">
            <span class="font-bold">{{ verifyTitle }}</span>
            <span class="ml-2">{{ verify.message }}</span>
            <ul v-if="verify.diffs.length" class="list-disc list-inside mt-1 text-xs space-y-0.5">
              <li v-for="(d, i) in verify.diffs" :key="i">{{ d }}</li>
            </ul>
            <div v-if="verify.rerun" class="text-xs mt-1 opacity-80">
              复算：{{ verify.rerun.matched ? '匹配' : '未匹配' }} · 总步数 {{ verify.rerun.totalSteps }} · 回溯 {{ verify.rerun.backtracks }} · 耗时 {{ verify.rerun.duration }}ms
            </div>
          </div>
          <button v-if="canReverify" @click="reportStore.reVerify()" class="text-xs underline shrink-0">重新校验</button>
        </div>

        <!-- 正文 -->
        <div class="overflow-y-auto px-5 py-4 space-y-5 text-sm">
          <!-- 当前正则 -->
          <section v-if="has('pattern')">
            <h3 class="text-xs font-bold text-slate-400 mb-2">当前正则</h3>
            <div class="bg-slate-900 rounded-lg px-3 py-2 font-mono text-cyan-300 break-all">/{{ report.pattern }}/{{ report.flags }}</div>
          </section>

          <!-- 匹配摘要 -->
          <section v-if="has('summary') && report.summary">
            <h3 class="text-xs font-bold text-slate-400 mb-2">匹配摘要</h3>
            <div class="bg-slate-900 rounded-lg p-3 space-y-2">
              <div class="flex items-center gap-2">
                <span class="font-bold" :class="report.summary.matched ? 'text-green-400' : 'text-red-400'">
                  {{ report.summary.matched ? '✓ 匹配成功' : '✗ 未匹配（空结果）' }}
                </span>
                <span v-if="report.summary.matched" class="text-xs text-slate-500">
                  命中区间 [{{ report.summary.matchStart }}, {{ report.summary.matchEnd }})
                </span>
              </div>
              <div v-if="report.summary.matched" class="font-mono text-xs">
                <span class="text-slate-500">命中文本：</span>
                <span class="bg-green-700/40 text-green-200 px-1.5 py-0.5 rounded">{{ report.summary.matchText }}</span>
              </div>
              <div v-else class="text-xs text-orange-300">{{ report.summary.note }}</div>
              <div class="text-xs text-slate-500">共 {{ report.summary.groupsCount }} 个分组（含 Group 0 整体匹配）</div>

              <div v-if="has('groups') && visibleGroups.length" class="pt-1">
                <div class="text-xs text-slate-500 mb-1">
                  捕获分组（导出时勾选了 {{ report.selectedGroups.length }} 个{{ report.selectedGroups.length !== report.summary.groupsCount ? '，未勾选的不在报告内' : '' }}）
                </div>
                <div class="space-y-1">
                  <div v-for="g in visibleGroups" :key="g.index" class="flex items-center gap-2 text-xs">
                    <span class="inline-block w-3 h-3 rounded" :style="{ backgroundColor: groupColor(g.index) }"></span>
                    <span class="text-slate-500 w-16">Group {{ g.index }}</span>
                    <span v-if="g.empty" class="text-orange-300 italic">空（∅）— 该分组本次未捕获到内容</span>
                    <span v-else class="font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-200 break-all">{{ g.value }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 原因诊断 -->
          <section v-if="has('diagnosis')">
            <h3 class="text-xs font-bold text-slate-400 mb-2">原因诊断 · 未匹配 / 回溯过多</h3>
            <div class="space-y-2">
              <div v-for="(d, i) in report.diagnosis" :key="i"
                class="rounded-lg border p-3"
                :class="levelClass(d.level)">
                <div class="flex items-center gap-2">
                  <span>{{ levelIcon(d.level) }}</span>
                  <span class="font-bold">{{ d.title }}</span>
                  <span class="ml-auto text-xs text-slate-500 font-mono">{{ d.code }}</span>
                </div>
                <p class="text-xs mt-1 text-slate-300 leading-relaxed">{{ d.detail }}</p>
                <p v-if="d.suggestion" class="text-xs mt-1.5 text-cyan-300">💡 建议：{{ d.suggestion }}</p>
              </div>
            </div>
          </section>

          <!-- 性能指标 -->
          <section v-if="has('performance') && report.performance">
            <h3 class="text-xs font-bold text-slate-400 mb-2">性能指标</h3>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div class="bg-slate-900 rounded-lg p-2.5">
                <div class="text-xs text-slate-500">总步数</div>
                <div class="text-lg font-bold text-slate-200">{{ report.performance.totalSteps }}</div>
              </div>
              <div class="bg-slate-900 rounded-lg p-2.5">
                <div class="text-xs text-slate-500">回溯次数</div>
                <div class="text-lg font-bold" :class="report.performance.backtracks > 0 ? 'text-orange-400' : 'text-slate-200'">{{ report.performance.backtracks }}</div>
              </div>
              <div class="bg-slate-900 rounded-lg p-2.5">
                <div class="text-xs text-slate-500">回溯占比</div>
                <div class="text-lg font-bold" :class="ratioClass(report.performance.backtrackRatio)">{{ (report.performance.backtrackRatio * 100).toFixed(1) }}%</div>
              </div>
              <div class="bg-slate-900 rounded-lg p-2.5">
                <div class="text-xs text-slate-500">耗时 (ms)</div>
                <div class="text-lg font-bold text-slate-200">{{ report.performance.duration }}</div>
              </div>
              <div class="bg-slate-900 rounded-lg p-2.5">
                <div class="text-xs text-slate-500">NFA 状态</div>
                <div class="text-lg font-bold text-slate-200">{{ report.performance.statesCount }}</div>
              </div>
              <div class="bg-slate-900 rounded-lg p-2.5">
                <div class="text-xs text-slate-500">转移边</div>
                <div class="text-lg font-bold text-slate-200">{{ report.performance.transitionsCount }}</div>
              </div>
            </div>
            <p class="text-xs text-slate-600 mt-1.5">耗时随机器负载波动，重新打开时以记录值展示并单独复算，不纳入一致性比对。</p>
          </section>

          <!-- 回溯步骤 -->
          <section v-if="has('backtracks') && report.backtracks">
            <h3 class="text-xs font-bold text-slate-400 mb-2">
              回溯步骤（共 {{ report.backtracks.totalCount }} 次）
            </h3>
            <div v-if="report.backtracks.entries.length === 0" class="text-xs text-green-400 bg-slate-900 rounded-lg p-3">本次匹配没有发生回溯。</div>
            <template v-else>
              <div class="bg-slate-900 rounded-lg max-h-56 overflow-y-auto">
                <table class="w-full text-xs font-mono">
                  <thead class="text-slate-500 sticky top-0 bg-slate-900">
                    <tr>
                      <th class="text-left px-3 py-1.5">步骤#</th>
                      <th class="text-left px-3 py-1.5">字符索引</th>
                      <th class="text-left px-3 py-1.5">字符</th>
                      <th class="text-left px-3 py-1.5">来源状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="b in report.backtracks.entries" :key="b.stepIndex" class="border-t border-slate-800 text-orange-300">
                      <td class="px-3 py-1">{{ b.stepIndex }}</td>
                      <td class="px-3 py-1">{{ b.charIndex }}</td>
                      <td class="px-3 py-1">'{{ displayChar(b.char) }}'</td>
                      <td class="px-3 py-1">{{ b.fromState }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="report.backtracks.truncated" class="text-xs text-orange-300 mt-1">
                ⚠ 回溯步骤超过 {{ MAX_BACKTRACK_STEPS }} 条，仅记录前 {{ MAX_BACKTRACK_STEPS}} 条；完整次数（{{ report.backtracks.totalCount }}）见性能指标。
              </p>
            </template>
          </section>

          <!-- 测试文本 -->
          <section v-if="has('testText')">
            <h3 class="text-xs font-bold text-slate-400 mb-2">
              测试文本（{{ report.testText.truncated ? report.testText.content.length + ' / ' + report.testText.originalLength : report.testText.originalLength }} 字符）
            </h3>
            <pre class="bg-slate-900 rounded-lg p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{{ report.testText.content || '（空文本）' }}</pre>
            <div v-if="report.testText.note" class="text-xs text-orange-300 mt-1.5">⚠ {{ report.testText.note }}</div>
          </section>

          <!-- 复现信息 -->
          <section v-if="has('repro')">
            <h3 class="text-xs font-bold text-slate-400 mb-2">复现信息</h3>
            <div class="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400 space-y-1 break-all">
              <div>生成器：{{ report.repro.generator }} {{ report.repro.appVersion }}</div>
              <div>生成时间（ISO）：{{ report.repro.createdAt }}</div>
              <div>文本长度：{{ report.repro.textLength }} 字符{{ report.repro.textTruncated ? '（导出时已截断）' : '' }}</div>
              <div>Schema：v{{ report.repro.schemaVersion }}</div>
              <div>指纹：<span class="text-cyan-400">{{ report.repro.fingerprint }}</span></div>
              <div class="text-slate-600">User-Agent：{{ report.repro.userAgent }}</div>
            </div>
            <p class="text-xs text-slate-600 mt-1.5">复现方式：在本工具中「导入报告」，或用报告内正则与完整测试文本重新执行匹配。</p>
          </section>
        </div>

        <!-- 底部操作 -->
        <div class="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-700">
          <button @click="loadIntoWorkbench" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs">载回工作台继续调试</button>
          <div class="flex gap-2">
            <button @click="close" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">关闭</button>
            <button @click="download" class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-bold">下载文件</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useReportStore } from '../store/report'
import { useRegexStore } from '../store/regex'
import { MAX_BACKTRACK_STEPS } from '../lib/report'
import type { DiagnosisLevel } from '../types'

const reportStore = useReportStore()
const regexStore = useRegexStore()

const report = computed(() => reportStore.activeReport)
const verify = computed(() => reportStore.verifyResult)

const GROUP_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

function has(section: string) {
  return !!report.value?.sections.includes(section as any)
}

const visibleGroups = computed(() => {
  if (!report.value?.summary) return []
  return report.value.summary.groups.filter((g) => report.value!.selectedGroups.includes(g.index))
})

function groupColor(i: number) {
  return GROUP_COLORS[i % GROUP_COLORS.length]
}

function displayChar(ch: string) {
  if (ch === '\n') return '\\n'
  if (ch === '\t') return '\\t'
  if (ch === '\r') return '\\r'
  return ch || 'EOF'
}

function levelClass(level: DiagnosisLevel) {
  if (level === 'critical') return 'border-red-700 bg-red-900/20'
  if (level === 'warning') return 'border-orange-700 bg-orange-900/15'
  return 'border-slate-700 bg-slate-900/60'
}
function levelIcon(level: DiagnosisLevel) {
  if (level === 'critical') return '🛑'
  if (level === 'warning') return '⚠️'
  return 'ℹ️'
}

const verifyClass = computed(() => {
  switch (verify.value?.status) {
    case 'consistent': return 'border-green-700 bg-green-900/20 text-green-300 border-b'
    case 'inconsistent': return 'border-red-700 bg-red-900/20 text-red-300 border-b'
    case 'unverifiable': return 'border-orange-700 bg-orange-900/15 text-orange-300 border-b'
    default: return 'border-yellow-700 bg-yellow-900/15 text-yellow-300 border-b'
  }
})
const verifyIcon = computed(() => {
  switch (verify.value?.status) {
    case 'consistent': return '✅'
    case 'inconsistent': return '❌'
    case 'unverifiable': return 'ℹ️'
    default: return '⚠️'
  }
})
const verifyTitle = computed(() => {
  switch (verify.value?.status) {
    case 'consistent': return '关键数字一致'
    case 'inconsistent': return '关键数字不一致'
    case 'unverifiable': return '无法自动复算'
    case 'engine-error': return '复算失败'
    default: return ''
  }
})
const canReverify = computed(() => verify.value?.status === 'inconsistent' || verify.value?.status === 'engine-error')

function ratioClass(r: number) {
  if (r >= 0.3) return 'text-red-400'
  if (r > 0) return 'text-orange-400'
  return 'text-slate-200'
}

function close() {
  reportStore.closeViewer()
}

function download() {
  if (report.value) reportStore.downloadOnly(report.value)
}

/** 将报告里的正则与完整（截断时则为保留的）文本载入工作台，方便继续调试 */
function loadIntoWorkbench() {
  if (!report.value) return
  regexStore.setPattern(report.value.pattern)
  regexStore.setTestString(report.value.testText.content)
  regexStore.execute()
  close()
}
</script>
