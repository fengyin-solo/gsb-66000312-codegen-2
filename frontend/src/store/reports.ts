import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DiagnosticReport, SavedReport } from '../types'
import {
  buildDiagnosticReport,
  downloadReport,
  type BuildReportInput,
} from '../utils/diagnosticReport'

const STORAGE_KEY = 'regex-debugger.reports.v1'
const MAX_SAVED = 20

function loadSaved(): SavedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    // 只保留结构完整的记录，损坏的本地缓存不应影响当前会话
    return data.filter(
      (x: unknown) =>
        x && typeof x === 'object' && (x as SavedReport).report && (x as SavedReport).id,
    )
  } catch {
    return []
  }
}

export const useReportsStore = defineStore('reports', () => {
  // 最近生成 / 导入过的报告，随会话保留并持久化，任何失败都不会清空它
  const saved = ref<SavedReport[]>(loadSaved())
  // 当前正在查看器中打开的报告（“重新打开”）
  const activeReport = ref<DiagnosticReport | null>(null)
  const viewerOpen = ref(false)
  // 最近一次生成/导入错误，供界面提示与重试
  const lastError = ref('')

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.value.slice(0, MAX_SAVED)))
    } catch {
      // 存储满或被禁用时不影响会话内使用
    }
  }

  function addReport(report: DiagnosticReport): SavedReport {
    const entry: SavedReport = {
      id: report.id,
      title: report.title,
      createdAt: report.createdAt,
      matched: report.matched,
      backtracks: report.backtracks,
      totalSteps: report.metrics.totalSteps,
      report,
    }
    saved.value = [entry, ...saved.value.filter((s) => s.id !== entry.id)].slice(0, MAX_SAVED)
    persist()
    return entry
  }

  /** 生成报告；失败时记录错误并向上抛出，调用方可在保留当前会话的前提下重试 */
  function generate(input: BuildReportInput): DiagnosticReport {
    try {
      const { report } = buildDiagnosticReport(input)
      addReport(report)
      lastError.value = ''
      return report
    } catch (e: any) {
      lastError.value = e?.message || '报告生成失败'
      throw e
    }
  }

  /** 导入外部报告文件；校验失败同样可重试，不清空已有会话报告 */
  function importReport(report: DiagnosticReport): SavedReport {
    const entry = addReport(report)
    lastError.value = ''
    return entry
  }

  function openReport(report: DiagnosticReport) {
    activeReport.value = report
    viewerOpen.value = true
  }

  function openEntry(id: string) {
    const entry = saved.value.find((s) => s.id === id)
    if (entry) openReport(entry.report)
  }

  function closeViewer() {
    viewerOpen.value = false
  }

  function download(id: string) {
    const entry = saved.value.find((s) => s.id === id)
    if (entry) downloadReport(entry.report)
  }

  function remove(id: string) {
    saved.value = saved.value.filter((s) => s.id !== id)
    persist()
  }

  return {
    saved,
    activeReport,
    viewerOpen,
    lastError,
    generate,
    importReport,
    addReport,
    openReport,
    openEntry,
    closeViewer,
    download,
    remove,
  }
})
