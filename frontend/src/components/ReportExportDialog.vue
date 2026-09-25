<template>
  <Teleport to="body">
    <div v-if="reportStore.exportOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" @click.self="close">
      <div class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <!-- 头部 -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 class="text-lg font-bold text-cyan-400">导出匹配诊断报告</h2>
            <p class="text-xs text-slate-500 mt-0.5">整理当前正则、测试文本、匹配摘要、回溯步骤与性能指标，生成可分享的诊断报告。生成与保存不会改动当前工作台会话。</p>
          </div>
          <button @click="close" class="text-slate-500 hover:text-slate-300 text-xl leading-none">✕</button>
        </div>

        <!-- 内容 -->
        <div class="overflow-y-auto px-5 py-4 space-y-5">
          <!-- 工作台快照状态 -->
          <div class="rounded-lg border p-3 text-sm space-y-2"
            :class="regexStore.error ? 'border-red-700 bg-red-900/20' : !regexStore.matchResult?.matched ? 'border-orange-700 bg-orange-900/10' : 'border-slate-700 bg-slate-900/50'">
            <div class="flex items-center justify-between">
              <span class="text-slate-400 font-bold text-xs">当前工作台快照</span>
              <span v-if="regexStore.error" class="text-red-400 text-xs">⚠ 正则解析错误</span>
              <span v-else-if="!regexStore.matchResult?.matched" class="text-orange-400 text-xs">⚠ 未匹配（报告会记录原因）</span>
              <span v-else class="text-green-400 text-xs">✓ 匹配成功</span>
            </div>
            <div class="font-mono text-cyan-300 text-xs break-all">/{{ regexStore.pattern || '（空）' }}/g</div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>测试文本：<span :class="textTooLong ? 'text-orange-400 font-bold' : ''">{{ regexStore.testString.length }} 字符</span></span>
              <template v-if="regexStore.matchResult">
                <span>总步数：{{ regexStore.matchResult.totalSteps }}</span>
                <span>回溯：<span :class="regexStore.matchResult.backtracks > 0 ? 'text-orange-400' : ''">{{ regexStore.matchResult.backtracks }}</span></span>
                <span>耗时：{{ regexStore.matchResult.duration }} ms</span>
              </template>
            </div>
            <!-- 特殊情况说明 -->
            <div v-if="!regexStore.pattern.trim()" class="text-red-400 text-xs">⚠ 正则为空，无法生成报告，请先返回工作台填写。</div>
            <div v-if="textTooLong" class="text-orange-300 text-xs">
              ⚠ 测试文本超过 {{ MAX_TEST_TEXT_LENGTH }} 字符，导出时只会保留前 {{ MAX_TEST_TEXT_LENGTH }} 字符并在报告中注明；截断后的报告重新打开时将无法自动复算校验。
            </div>
            <div v-if="regexStore.testString.length === 0" class="text-orange-300 text-xs">
              ⚠ 测试文本为空：报告将把「空输入」标记为未匹配的可能原因。
            </div>
            <div v-if="regexStore.matchResult && !regexStore.matchResult.matched" class="text-orange-300 text-xs">
              ⚠ 空结果：报告的匹配摘要会明确标注「未匹配」并说明分组捕获为空，诊断区会给出未匹配原因。
            </div>
          </div>

          <!-- 标题 -->
          <div>
            <label class="block text-xs font-bold text-slate-400 mb-1">报告标题</label>
            <input v-model="title" type="text" placeholder="给报告起个名字，便于以后重新打开"
              class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500" />
          </div>

          <!-- 分组选择 -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-bold text-slate-400">选择包含的分组（信息板块）</label>
              <div class="flex gap-3 text-xs">
                <button @click="selectAllSections" class="text-cyan-400 hover:underline">全选</button>
                <button @click="selectRequiredSections" class="text-slate-400 hover:underline">仅必含</button>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label v-for="opt in SECTION_OPTIONS" :key="opt.id"
                class="flex items-start gap-2 p-2 rounded-lg border cursor-pointer"
                :class="isSectionOn(opt.id) ? 'border-cyan-600 bg-cyan-900/20' : 'border-slate-700 bg-slate-900'">
                <input type="checkbox" class="mt-0.5 accent-cyan-500"
                  :checked="isSectionOn(opt.id)"
                  :disabled="opt.required"
                  @change="toggleSection(opt.id)" />
                <span>
                  <span class="text-sm text-slate-200">{{ opt.label }}<span v-if="opt.required" class="text-slate-500">（必含）</span></span>
                  <span class="block text-xs text-slate-500">{{ opt.description }}</span>
                </span>
              </label>
            </div>
          </div>

          <!-- 捕获分组选择 -->
          <div v-if="isSectionOn('groups') && captureGroups.length > 0">
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-bold text-slate-400">选择包含的捕获分组（{{ captureGroups.length }} 个）</label>
              <div class="flex gap-3 text-xs">
                <button @click="selectedGroups = captureGroups.map(g => g.index)" class="text-cyan-400 hover:underline">全选</button>
                <button @click="selectedGroups = [0]" class="text-slate-400 hover:underline">仅 Group 0</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <label v-for="g in captureGroups" :key="g.index"
                class="flex items-center gap-2 px-2 py-1 rounded-lg border text-xs cursor-pointer"
                :class="selectedGroups.includes(g.index) ? 'border-cyan-600 bg-cyan-900/20' : 'border-slate-700 bg-slate-900'">
                <input type="checkbox" class="accent-cyan-500" :value="g.index" v-model="selectedGroups" />
                <span class="inline-block w-3 h-3 rounded" :style="{ backgroundColor: regexStore.groupColors[g.index % regexStore.groupColors.length] }"></span>
                <span class="text-slate-300">Group {{ g.index }}</span>
                <span class="font-mono text-slate-500 truncate max-w-[8rem]">{{ g.value || '∅' }}</span>
              </label>
            </div>
            <p v-if="selectedGroups.length === 0" class="text-orange-300 text-xs mt-1">未选择任何捕获分组，报告中该板块将只显示分组数量，不包含具体值。</p>
          </div>

          <!-- 生成错误 + 重试 -->
          <div v-if="errorMsg" class="rounded-lg border border-red-700 bg-red-900/20 p-3 text-sm">
            <div class="flex items-start gap-2">
              <span class="text-red-400">⚠</span>
              <div class="flex-1">
                <div class="text-red-300 font-bold">生成失败</div>
                <div class="text-red-400/90 text-xs mt-1">{{ errorMsg }}</div>
                <div class="text-slate-400 text-xs mt-1">工作台的正则与测试文本均未被修改，修正后可直接重试。</div>
              </div>
              <button @click="doGenerate" class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-xs text-white shrink-0">重试</button>
            </div>
          </div>

          <!-- 生成预览 -->
          <div v-if="draft" class="rounded-lg border border-slate-600 bg-slate-900 p-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-green-400">✓ 报告已生成（尚未保存）</span>
              <span class="text-xs text-slate-500">{{ new Date(draft.repro.createdAt).toLocaleString() }}</span>
            </div>
            <div class="text-sm text-slate-300 mb-1">{{ draft.title }}</div>
            <div class="text-xs text-slate-500 space-y-0.5">
              <div>诊断结论 {{ draft.diagnosis.length }} 条 · 板块 {{ draft.sections.length }} 个 · 分组 {{ draft.selectedGroups.length }} 个</div>
              <div v-if="draft.testText.truncated" class="text-orange-400">测试文本已截断（{{ draft.testText.originalLength }} → {{ draft.testText.content.length }} 字符）</div>
              <div v-if="draft.backtracks?.truncated" class="text-orange-400">回溯步骤较多，仅记录前 {{ MAX_BACKTRACK_STEPS }} / {{ draft.backtracks.totalCount }} 步</div>
            </div>
          </div>

          <!-- 已保存的报告 -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xs font-bold text-slate-400">已保存的报告（{{ reportStore.savedReports.length }}）</h3>
              <button @click="triggerImport" class="text-xs text-cyan-400 hover:underline">📂 从文件导入</button>
              <input ref="fileInputRef" type="file" accept=".json,application/json" class="hidden" @change="onFileSelected" />
            </div>
            <div v-if="importMsg" :class="importOk ? 'text-green-400' : 'text-red-400'" class="text-xs mb-2">{{ importMsg }}</div>
            <div v-if="reportStore.savedReports.length === 0" class="text-xs text-slate-600">暂无保存的报告。生成后可保存到本列表，也可以直接下载为 JSON 文件分享。</div>
            <div class="space-y-1 max-h-40 overflow-y-auto">
              <div v-for="r in reportStore.savedReports" :key="r.id"
                class="flex items-center gap-2 p-2 rounded-lg border border-slate-700 bg-slate-900 text-sm">
                <button class="flex-1 text-left min-w-0" @click="reopen(r)">
                  <span class="block truncate text-slate-200 hover:text-cyan-300">{{ r.title }}</span>
                  <span class="block text-xs text-slate-500">{{ r.repro.createdAt }} · {{ r.pattern.slice(0, 40) }}{{ r.pattern.length > 40 ? '…' : '' }}</span>
                </button>
                <button @click="reopen(r)" title="重新打开" class="text-slate-400 hover:text-cyan-300 text-xs px-1">查看</button>
                <button @click="downloadSaved(r)" title="下载文件" class="text-slate-400 hover:text-cyan-300 text-xs px-1">下载</button>
                <button @click="remove(r.id)" title="删除" class="text-slate-400 hover:text-red-400 text-xs px-1">删除</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-700">
          <button @click="triggerImport" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">导入报告</button>
          <div class="flex gap-2">
            <button @click="close" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">关闭</button>
            <button @click="doGenerate" :disabled="!canGenerate"
              class="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 rounded-lg text-sm">
              {{ draft ? '重新生成预览' : '生成预览' }}
            </button>
            <button @click="onSave(false)" :disabled="!draft"
              class="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 rounded-lg text-sm">保存</button>
            <button @click="onSave(true)" :disabled="!draft"
              class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-lg text-sm font-bold">保存并下载文件</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRegexStore } from '../store/regex'
import { useReportStore } from '../store/report'
import { SECTION_OPTIONS, REQUIRED_SECTIONS, MAX_TEST_TEXT_LENGTH, MAX_BACKTRACK_STEPS } from '../lib/report'
import type { DiagnosticReport, ReportSectionId } from '../types'

const regexStore = useRegexStore()
const reportStore = useReportStore()

const title = ref('')
const selectedSections = ref<ReportSectionId[]>(SECTION_OPTIONS.map((o) => o.id))
const selectedGroups = ref<number[]>([])
const draft = ref<DiagnosticReport | null>(null)
const errorMsg = ref('')
const importMsg = ref('')
const importOk = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const textTooLong = computed(() => regexStore.testString.length > MAX_TEST_TEXT_LENGTH)
const canGenerate = computed(() => !!regexStore.pattern.trim() && !!regexStore.matchResult)

const captureGroups = computed(() => {
  const r = regexStore.matchResult
  if (!r) return []
  return r.groups.map((value, index) => ({ index, value }))
})

function isSectionOn(id: ReportSectionId) {
  return selectedSections.value.includes(id)
}

function toggleSection(id: ReportSectionId) {
  const opt = SECTION_OPTIONS.find((o) => o.id === id)
  if (opt?.required) return
  if (isSectionOn(id)) selectedSections.value = selectedSections.value.filter((s) => s !== id)
  else selectedSections.value = [...selectedSections.value, id]
  draft.value = null
}

function selectAllSections() {
  selectedSections.value = SECTION_OPTIONS.map((o) => o.id)
}
function selectRequiredSections() {
  selectedSections.value = [...REQUIRED_SECTIONS]
}

function syncGroupSelection() {
  const indexes = captureGroups.value.map((g) => g.index)
  // 默认全选；保留仍然存在的已选项
  selectedGroups.value = selectedGroups.value.filter((i) => indexes.includes(i))
  for (const i of indexes) {
    if (!selectedGroups.value.includes(i)) selectedGroups.value.push(i)
  }
  selectedGroups.value.sort((a, b) => a - b)
}

function doGenerate() {
  errorMsg.value = ''
  try {
    syncGroupSelection()
    draft.value = reportStore.buildReport(
      title.value || `诊断报告 ${new Date().toLocaleString()}`,
      selectedSections.value,
      isSectionOn('groups') ? selectedGroups.value : [],
    )
    if (!title.value) title.value = draft.value.title
  } catch (e: any) {
    draft.value = null
    errorMsg.value = e?.message || '生成失败'
  }
}

function onSave(download: boolean) {
  if (!draft.value) return
  const res = reportStore.saveReport(draft.value, download)
  if (!res.ok) {
    errorMsg.value = res.error || '保存失败，可重试（当前会话不会丢失）'
    return
  }
  if (res.error) {
    errorMsg.value = res.error // 保存成功但下载失败的提示
  } else {
    reportStore.openViewer(draft.value)
    reportStore.closeExport()
  }
}

function close() {
  reportStore.closeExport()
}

function reopen(r: DiagnosticReport) {
  reportStore.closeExport()
  reportStore.openViewer(r)
}

function downloadSaved(r: DiagnosticReport) {
  reportStore.downloadOnly(r)
}

function remove(id: string) {
  reportStore.deleteReport(id)
}

function triggerImport() {
  importMsg.value = ''
  fileInputRef.value?.click()
}

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const report = reportStore.importFromText(String(reader.result || ''))
      importOk.value = true
      importMsg.value = `已导入「${report.title}」，正在打开…`
      reportStore.openViewer(report)
      reportStore.closeExport()
    } catch (err: any) {
      importOk.value = false
      importMsg.value = `导入失败：${err?.message || '文件格式错误'}，可修正文件后重新选择导入。`
    } finally {
      input.value = ''
    }
  }
  reader.onerror = () => {
    importOk.value = false
    importMsg.value = '读取文件失败，请重试。'
    input.value = ''
  }
  reader.readAsText(file)
}

function initDefaults() {
  if (!title.value) title.value = `诊断报告 ${new Date().toLocaleString()}`
  syncGroupSelection()
}

// 每次打开弹窗时重置草稿状态
watch(() => reportStore.exportOpen, (open) => {
  if (open) {
    draft.value = null
    errorMsg.value = ''
    importMsg.value = ''
    initDefaults()
  }
})
</script>
