<template>
  <div class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-2xl font-bold text-cyan-400">正则表达式可视化调试器</h1>
          <p class="text-sm text-slate-500 mt-1">NFA 状态机可视化 · 逐步匹配高亮 · 分组捕获 · 回溯追踪</p>
        </div>
        <div class="flex items-center gap-2">
          <button @click="triggerImport"
            class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm flex items-center gap-1.5">
            📂 <span>导入报告</span>
          </button>
          <button @click="reportStore.openExport()"
            class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-bold flex items-center gap-1.5">
            📋 <span>导出诊断报告</span>
          </button>
          <input ref="importInputRef" type="file" accept=".json,application/json" class="hidden" @change="onImportFile" />
        </div>
      </div>
      <p v-if="importMsg" :class="importOk ? 'text-green-400' : 'text-red-400'" class="text-xs mt-2">{{ importMsg }}</p>
    </header>

    <div class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-1/4 space-y-4">
        <RegexEditor />
        <TemplateLibrary />
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-2">匹配诊断报告</h3>
          <p class="text-xs text-slate-500 mb-3 leading-relaxed">
            把当前正则、测试文本、匹配摘要、回溯步骤和性能指标整理成可分享的报告；报告会标明未匹配或回溯过多的原因并附复现信息。
          </p>
          <div class="flex gap-2">
            <button @click="reportStore.openExport()" class="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-bold">📋 导出报告</button>
            <button @click="triggerImport" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">📂 导入</button>
          </div>
          <button v-if="reportStore.savedReports.length > 0" @click="reportStore.openViewer(reportStore.savedReports[0])"
            class="w-full mt-2 px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 rounded-lg text-xs text-slate-400">
            最近报告：{{ reportStore.savedReports[0].title }}（共 {{ reportStore.savedReports.length }} 份，点击重新打开）
          </button>
        </div>
      </div>

      <div class="lg:w-1/2 space-y-4">
        <NfaVisualizer />
        <MatchHighlight />
      </div>

      <div class="lg:w-1/4 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">匹配统计</h3>
          <div v-if="store.matchResult" class="space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-slate-500">匹配状态</span><span :class="store.matchResult.matched ? 'text-green-400' : 'text-red-400'">{{ store.matchResult.matched ? '✓ 匹配成功' : '✗ 未匹配' }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">匹配文本</span><span class="text-cyan-400 font-mono truncate ml-2">{{ store.matchResult.matchText || '—' }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">总步数</span><span class="text-slate-300">{{ store.matchResult.totalSteps }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">回溯次数</span><span :class="store.matchResult.backtracks > 0 ? 'text-orange-400 font-bold' : 'text-slate-300'">{{ store.matchResult.backtracks }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">耗时(ms)</span><span class="text-slate-300">{{ store.matchResult.duration }}</span></div>
          </div>
          <div v-else class="text-slate-500 text-sm">点击"执行匹配"开始</div>
        </div>

        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">逐步控制</h3>
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <button @click="store.stepBackward" :disabled="store.currentStep === 0" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 rounded text-sm">⏮ 上一步</button>
            <button v-if="!store.isPlaying" @click="store.play" class="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-sm">▶ 播放</button>
            <button v-else @click="store.stop" class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm">⏸ 停止</button>
            <button @click="store.stepForward" :disabled="!store.matchResult || store.currentStep >= store.matchResult.steps.length - 1" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 rounded text-sm">下一步 ⏭</button>
            <button @click="store.resetStep" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm">⟲ 重置</button>
          </div>
          <div class="text-sm text-slate-400">步骤: {{ store.currentStep }} / {{ store.matchResult?.steps.length || 0 }}</div>
        </div>

        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">当前步骤详情</h3>
          <div v-if="store.matchResult && store.matchResult.steps[store.currentStep]" class="space-y-1 text-sm">
            <div>字符索引: <span class="text-cyan-400">{{ store.matchResult.steps[store.currentStep].charIndex }}</span></div>
            <div>当前字符: <span class="text-yellow-400 font-mono">'{{ store.matchResult.steps[store.currentStep].char }}'</span></div>
            <div>状态转换: <span class="text-green-400">{{ store.matchResult.steps[store.currentStep].currentState }}</span> → <span class="text-blue-400">{{ store.matchResult.steps[store.currentStep].nextState }}</span></div>
            <div>转移符号: <span class="text-purple-400 font-mono">{{ store.matchResult.steps[store.currentStep].transition }}</span></div>
            <div v-if="store.matchResult.steps[store.currentStep].isBacktrack" class="text-orange-400 font-bold">⚠ 回溯发生</div>
          </div>
          <div v-else class="text-slate-500 text-sm">无步骤数据</div>
        </div>
      </div>
    </div>

    <ReportExportDialog />
    <ReportViewer />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRegexStore } from './store/regex'
import { useReportStore } from './store/report'
import RegexEditor from './components/RegexEditor.vue'
import NfaVisualizer from './components/NfaVisualizer.vue'
import MatchHighlight from './components/MatchHighlight.vue'
import TemplateLibrary from './components/TemplateLibrary.vue'
import ReportExportDialog from './components/ReportExportDialog.vue'
import ReportViewer from './components/ReportViewer.vue'

const store = useRegexStore()
const reportStore = useReportStore()
const importInputRef = ref<HTMLInputElement | null>(null)
const importMsg = ref('')
const importOk = ref(false)

function triggerImport() {
  importMsg.value = ''
  importInputRef.value?.click()
}

function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const report = reportStore.importFromText(String(reader.result || ''))
      importOk.value = true
      importMsg.value = `已导入「${report.title}」并重新打开。`
      reportStore.openViewer(report)
    } catch (err: any) {
      importOk.value = false
      importMsg.value = `导入失败：${err?.message || '文件格式错误'}，可重新选择文件再试。`
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

onMounted(() => {
  reportStore.loadSaved()
  store.execute()
})
</script>
