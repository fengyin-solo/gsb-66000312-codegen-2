<template>
  <div v-if="reports.viewerOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="reports.closeViewer()">
    <div class="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div class="min-w-0">
          <h3 class="text-base font-bold text-cyan-400 truncate">{{ report?.title || '诊断报告' }}</h3>
          <p class="text-xs text-slate-500 mt-0.5">{{ formatTime(report?.createdAt) }} · ID {{ report?.id }}</p>
        </div>
        <button @click="reports.closeViewer()" class="text-slate-500 hover:text-slate-300 text-lg leading-none shrink-0 ml-3">✕</button>
      </div>

      <div v-if="report" class="overflow-y-auto p-5 space-y-4 text-sm">
        <!-- 完整性 / 一致性 -->
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-xs">
            <span class="px-2 py-0.5 rounded bg-green-900/50 text-green-300 border border-green-800">✓ 校验和通过</span>
            <span class="px-2 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600">格式 v{{ report.version }}</span>
            <span class="text-slate-500">关键数字按报告生成时的快照原样展示</span>
          </div>
        </div>

        <!-- 与当前工作台对账 -->
        <div class="bg-slate-900 rounded-lg p-3">
          <h4 class="text-xs font-bold text-slate-500 mb-2">与当前工作台对账</h4>
          <div v-if="sameWorkbench" class="text-xs text-green-400 mb-2">✓ 当前工作台正则与报告一致，下表关键数字可直接对照。</div>
          <div v-else class="text-xs text-orange-400 mb-2">
            ⚠ 当前工作台正则或输入与报告生成时不同（或已切换），数字差异属于预期；报告数字保持原样。
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div v-for="row in metricRows" :key="row.key" class="bg-slate-800 rounded p-2">
              <div class="text-slate-500">{{ row.label }}</div>
              <div class="flex items-center gap-1 mt-1">
                <span class="font-mono text-cyan-400 text-base">{{ row.reportValue }}</span>
                <span
                  class="ml-auto text-[10px] px-1 rounded"
                  :class="row.same === null ? 'bg-slate-700 text-slate-500' : row.same ? 'bg-green-900/60 text-green-300' : 'bg-orange-900/60 text-orange-300'"
                >{{ row.same === null ? '无对照' : row.same ? '一致' : '已变化' }}</span>
              </div>
              <div class="text-slate-500 mt-0.5">工作台: {{ row.workbenchValue }}</div>
            </div>
          </div>
        </div>

        <p v-if="report.note" class="text-xs text-slate-400 bg-slate-900 rounded-lg px-3 py-2">{{ report.note }}</p>

        <!-- 当前正则 -->
        <section v-if="has('pattern')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">当前正则</h4>
          <div class="bg-slate-900 rounded-lg px-3 py-2 font-mono text-cyan-400 break-all">/{{ report.pattern }}/{{ report.flags }}</div>
        </section>

        <!-- 测试文本 -->
        <section>
          <h4 class="text-xs font-bold text-slate-500 mb-2">
            测试文本（{{ report.testTextLength }} 字符<template v-if="report.testTextTruncated">，已截断</template>）
          </h4>
          <pre v-if="has('testText')" class="bg-slate-900 rounded-lg px-3 py-2 font-mono text-xs text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto m-0">{{ textPreview }}</pre>
          <div v-else class="bg-slate-900 rounded-lg px-3 py-2 text-xs text-slate-500">导出时未包含测试文本分组。</div>
          <div v-if="report.testTextTruncated" class="text-xs text-orange-400 mt-1">
            📏 原文超过 {{ report.testTextMaxStored }} 字符，报告文件仅保留前 {{ report.testTextMaxStored }} 个字符；
            完整内容请在原工作台复现。指纹: <span class="font-mono">{{ report.testTextSha256 }}</span>
          </div>
          <div v-else-if="report.testTextLength > longThreshold" class="text-xs text-slate-500 mt-1">
            文本较长，仅预览前 {{ longThreshold }} 字符；文件中已完整保存。
          </div>
        </section>

        <!-- 匹配摘要 -->
        <section v-if="has('summary')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">匹配摘要</h4>
          <div class="bg-slate-900 rounded-lg p-3 space-y-1 text-xs">
            <div class="flex justify-between"><span class="text-slate-500">匹配状态</span>
              <span :class="report.matched ? 'text-green-400' : 'text-red-400'">{{ report.matched ? '✓ 匹配成功' : '✗ 未匹配' }}</span>
            </div>
            <div class="flex justify-between gap-2"><span class="text-slate-500 shrink-0">匹配文本</span>
              <span class="font-mono text-slate-200 truncate">{{ report.matchText || '（空串）' }}</span>
            </div>
            <div v-if="!report.matched" class="text-red-300 pt-1">引擎在所有候选起点均未能到达接受状态，具体原因见“原因诊断”。</div>
          </div>
        </section>

        <!-- 原因诊断 -->
        <section v-if="has('diagnosis')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">原因诊断</h4>
          <div v-if="report.findings.length === 0" class="text-xs text-slate-500 bg-slate-900 rounded-lg px-3 py-2">未发现明显问题，匹配在正常回溯范围内完成。</div>
          <div v-else class="space-y-2">
            <div
              v-for="f in report.findings"
              :key="f.id"
              class="rounded-lg px-3 py-2 border text-xs"
              :class="f.severity === 'error'
                ? 'bg-red-900/30 border-red-800'
                : f.severity === 'warning'
                  ? 'bg-orange-900/30 border-orange-800'
                  : 'bg-slate-900 border-slate-700'"
            >
              <div class="font-bold" :class="f.severity === 'error' ? 'text-red-300' : f.severity === 'warning' ? 'text-orange-300' : 'text-slate-300'">
                {{ f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ' }} {{ f.title }}
              </div>
              <div class="text-slate-400 mt-1">{{ f.detail }}</div>
              <div v-if="f.suggestion" class="text-cyan-300 mt-1">建议：{{ f.suggestion }}</div>
            </div>
          </div>
        </section>

        <!-- 回溯步骤 -->
        <section v-if="has('steps')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">
            回溯步骤<span class="text-slate-600">（共 {{ report.totalStepCount }} 步<template v-if="report.stepsTruncated">，仅展示前 {{ stepLimit }} 步</template>）</span>
          </h4>
          <div v-if="report.steps.length === 0" class="text-xs text-slate-500 bg-slate-900 rounded-lg px-3 py-2">无步骤记录（空结果或未执行匹配）。</div>
          <div v-else class="bg-slate-900 rounded-lg divide-y divide-slate-800 max-h-56 overflow-y-auto">
            <div
              v-for="step in report.steps"
              :key="step.stepIndex"
              class="px-3 py-1.5 font-mono text-xs"
              :class="step.isBacktrack ? 'text-orange-300 bg-orange-900/20' : 'text-slate-400'"
            >
              [{{ step.stepIndex }}] 索引{{ step.charIndex }} '{{ step.char }}' 状态{{ step.currentState }}→{{ step.nextState }} ({{ step.transition }}){{ step.isBacktrack ? ' ⚠ 回溯/失败' : '' }}
            </div>
          </div>
        </section>

        <!-- 分组捕获 -->
        <section v-if="has('groups')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">分组捕获（{{ report.captureGroups.length }}）</h4>
          <div v-if="report.captureGroups.length === 0" class="text-xs text-slate-500 bg-slate-900 rounded-lg px-3 py-2">无捕获分组。</div>
          <div v-else class="space-y-1">
            <div v-for="(g, i) in report.captureGroups" :key="i" class="flex items-center gap-2 text-xs">
              <span class="inline-block w-3 h-3 rounded" :style="{ backgroundColor: store.groupColors[i % store.groupColors.length] }"></span>
              <span class="text-slate-500 w-14">Group {{ i }}</span>
              <span class="font-mono bg-slate-900 px-2 py-0.5 rounded text-slate-200 break-all">{{ g || '∅' }}</span>
            </div>
          </div>
        </section>

        <!-- 性能指标 -->
        <section v-if="has('metrics')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">性能指标</h4>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="bg-slate-900 rounded-lg p-2"><div class="text-slate-500">总步数</div><div class="text-slate-200 font-mono text-base">{{ report.metrics.totalSteps }}</div></div>
            <div class="bg-slate-900 rounded-lg p-2"><div class="text-slate-500">回溯次数</div><div :class="report.metrics.backtracks > 0 ? 'text-orange-400' : 'text-slate-200'" class="font-mono text-base">{{ report.metrics.backtracks }}</div></div>
            <div class="bg-slate-900 rounded-lg p-2"><div class="text-slate-500">耗时 (ms)</div><div class="text-slate-200 font-mono text-base">{{ report.metrics.duration }}</div></div>
            <div class="bg-slate-900 rounded-lg p-2"><div class="text-slate-500">输入长度</div><div class="text-slate-200 font-mono text-base">{{ report.metrics.inputLength }}</div></div>
            <div class="bg-slate-900 rounded-lg p-2"><div class="text-slate-500">NFA 状态</div><div class="text-slate-200 font-mono text-base">{{ report.metrics.nfaStates }}</div></div>
            <div class="bg-slate-900 rounded-lg p-2"><div class="text-slate-500">转移数</div><div class="text-slate-200 font-mono text-base">{{ report.metrics.nfaTransitions }}</div></div>
          </div>
        </section>

        <!-- 复现信息 -->
        <section v-if="has('repro')">
          <h4 class="text-xs font-bold text-slate-500 mb-2">复现信息</h4>
          <div class="bg-slate-900 rounded-lg p-3 text-xs space-y-1">
            <div class="text-slate-500">在本工作台中粘贴相同正则与测试文本、点击“执行匹配”即可复现；耗时受机器负载影响，结构性数字（步数/回溯）应一致。</div>
            <div class="flex justify-between gap-2"><span class="text-slate-500 shrink-0">正则</span><span class="font-mono text-cyan-400 break-all text-right">/{{ report.pattern }}/{{ report.flags }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">测试文本长度</span><span class="font-mono text-slate-300">{{ report.testTextLength }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">测试文本指纹</span><span class="font-mono text-slate-300">{{ report.testTextSha256 }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">生成时间</span><span class="font-mono text-slate-300">{{ report.createdAt }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">应用版本</span><span class="font-mono text-slate-300">{{ report.appVersion }}</span></div>
            <div class="flex justify-between gap-2"><span class="text-slate-500 shrink-0">引擎</span><span class="font-mono text-slate-300 text-right break-all">{{ report.engine.name }} · {{ report.engine.version }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">校验和</span><span class="font-mono text-slate-300">{{ report.checksum.algorithm }}:{{ report.checksum.value }}</span></div>
          </div>
        </section>
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-700">
        <button @click="reports.closeViewer()" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">关闭</button>
        <button v-if="report" @click="download" class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold text-sm">⬇ 下载文件</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRegexStore } from '../store/regex'
import { useReportsStore } from '../store/reports'
import {
  STEP_STORE_LIMIT,
  TEST_TEXT_LONG_THRESHOLD,
  downloadReport,
  fnv1a,
} from '../utils/diagnosticReport'

const store = useRegexStore()
const reports = useReportsStore()

const report = computed(() => reports.activeReport)
const longThreshold = TEST_TEXT_LONG_THRESHOLD
const stepLimit = STEP_STORE_LIMIT

function has(section: string) {
  return report.value?.sections.includes(section as any)
}

function formatTime(iso?: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

const textPreview = computed(() => {
  if (!report.value) return ''
  const t = report.value.testText
  if (t.length > TEST_TEXT_LONG_THRESHOLD) {
    return t.slice(0, TEST_TEXT_LONG_THRESHOLD) + `\n…（仅预览前 ${TEST_TEXT_LONG_THRESHOLD} 字符）`
  }
  return t
})

const sameWorkbench = computed(() => {
  if (!report.value) return false
  // 用正则 + 测试文本指纹做精确对账，避免长度相同但内容不同的误判
  return (
    store.pattern === report.value.pattern &&
    fnv1a(store.testString) === report.value.testTextSha256
  )
})

interface MetricRow {
  key: string
  label: string
  reportValue: string | number
  workbenchValue: string | number
  same: boolean | null
}

const metricRows = computed<MetricRow[]>(() => {
  if (!report.value) return []
  const r = report.value
  const mr = store.matchResult
  // 仅当工作台仍持同一正则时才有对账意义
  const comparable = sameWorkbench.value
  const cmp = (a: number, b: number | undefined) => (comparable && b !== undefined ? a === b : null)
  return [
    { key: 'totalSteps', label: '总步数', reportValue: r.metrics.totalSteps, workbenchValue: mr?.totalSteps ?? '—', same: cmp(r.metrics.totalSteps, mr?.totalSteps) },
    { key: 'backtracks', label: '回溯次数', reportValue: r.metrics.backtracks, workbenchValue: mr?.backtracks ?? '—', same: cmp(r.metrics.backtracks, mr?.backtracks) },
    // 耗时每次运行会波动，仅展示不判定一致性
    { key: 'duration', label: '耗时(ms)', reportValue: r.metrics.duration, workbenchValue: mr?.duration ?? '—', same: null },
  ]
})

function download() {
  if (report.value) downloadReport(report.value)
}
</script>
