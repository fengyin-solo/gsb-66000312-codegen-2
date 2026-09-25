<template>
  <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
    <h3 class="text-sm font-bold text-slate-400 mb-3">诊断报告</h3>
    <div class="flex flex-wrap gap-2">
      <button @click="exportOpen = true" class="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold text-sm">
        ⬆ 导出报告
      </button>
      <button @click="triggerImport" class="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">
        ⬇ 导入报告
      </button>
      <input ref="fileInputRef" type="file" accept="application/json,.json" class="hidden" @change="onFileSelected" />
    </div>

    <div v-if="importError" class="mt-2 text-xs text-red-400 flex items-start gap-1">
      <span>⚠ {{ importError }}</span>
      <button @click="triggerImport" class="text-cyan-400 hover:text-cyan-300 underline shrink-0">重试</button>
    </div>

    <div class="mt-3">
      <h4 class="text-xs font-bold text-slate-500 mb-2">最近报告（{{ reports.saved.length }}）</h4>
      <div v-if="reports.saved.length === 0" class="text-xs text-slate-600">生成或导入后可在此重新打开。</div>
      <div v-else class="space-y-1 max-h-56 overflow-y-auto">
        <div
          v-for="entry in reports.saved"
          :key="entry.id"
          class="group flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5"
        >
          <button @click="reports.openEntry(entry.id)" class="min-w-0 flex-1 text-left">
            <div class="flex items-center gap-1.5">
              <span :class="entry.matched ? 'text-green-400' : 'text-red-400'">{{ entry.matched ? '✓' : '✗' }}</span>
              <span class="text-xs text-slate-200 truncate">{{ entry.title }}</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-0.5">
              {{ formatTime(entry.createdAt) }} · {{ entry.totalSteps }} 步 · {{ entry.backtracks }} 回溯
            </div>
          </button>
          <button @click="reports.download(entry.id)" title="下载文件" class="text-slate-500 hover:text-cyan-400 text-xs px-1">⬇</button>
          <button @click="reports.remove(entry.id)" title="删除" class="text-slate-500 hover:text-red-400 text-xs px-1">✕</button>
        </div>
      </div>
    </div>

    <ReportExportDialog :open="exportOpen" @close="exportOpen = false" @generated="onGenerated" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useReportsStore } from '../store/reports'
import { readReportFile, ReportParseError } from '../utils/diagnosticReport'
import ReportExportDialog from './ReportExportDialog.vue'

const reports = useReportsStore()
const exportOpen = ref(false)
const importError = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

function triggerImport() {
  importError.value = ''
  fileInputRef.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 允许重新选择同一个文件
  input.value = ''
  if (!file) return
  try {
    const report = await readReportFile(file)
    const entry = reports.importReport(report)
    reports.openEntry(entry.id)
  } catch (err) {
    importError.value = err instanceof ReportParseError ? err.message : '导入失败，请重试。'
  }
}

function onGenerated(id: string) {
  // 生成成功：直接打开查看器，用户可继续下载
  reports.openEntry(id)
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
</script>
