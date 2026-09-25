import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  DiagnosticReport,
  ReportSectionId,
  ReportVerifyResult,
} from '../types'
import {
  SECTION_OPTIONS,
  REQUIRED_SECTIONS,
  generateReport,
  verifyReport,
  parseReport,
  downloadReport,
} from '../lib/report'
import { useRegexStore } from './regex'

const STORAGE_KEY = 'regex-debugger.diagnostic-reports.v1'
const MAX_STORED_REPORTS = 20

export const useReportStore = defineStore('report', () => {
  const exportOpen = ref(false)
  const viewerOpen = ref(false)
  const activeReport = ref<DiagnosticReport | null>(null)
  const verifyResult = ref<ReportVerifyResult | null>(null)
  const savedReports = ref<DiagnosticReport[]>([])
  const lastError = ref('')

  const allSections = computed<ReportSectionId[]>(() => SECTION_OPTIONS.map((o) => o.id))

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) savedReports.value = parsed
    } catch {
      // 本地数据损坏不影响当前会话
      savedReports.value = []
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedReports.value))
    } catch (e: any) {
      throw new Error(`本地保存失败：${e?.name === 'QuotaExceededError' ? '浏览器存储空间已满' : e?.message || '未知错误'}`)
    }
  }

  function openExport() {
    lastError.value = ''
    exportOpen.value = true
  }

  function closeExport() {
    exportOpen.value = false
    lastError.value = ''
  }

  /** 生成报告。失败时抛出异常，由调用方在弹窗内提示并支持重试；不改动正则工作台状态 */
  function buildReport(
    title: string,
    sections: ReportSectionId[],
    selectedGroups: number[],
  ): DiagnosticReport {
    const regexStore = useRegexStore()
    if (!regexStore.pattern.trim()) {
      throw new Error('当前正则为空，请先在工作台输入正则表达式')
    }
    if (!regexStore.matchResult) {
      throw new Error('当前还没有匹配结果，请先点击「执行匹配」')
    }
    return generateReport({
      title,
      pattern: regexStore.pattern,
      flags: 'g',
      testText: regexStore.testString,
      result: regexStore.matchResult,
      nfa: regexStore.nfa,
      sections,
      selectedGroups,
    })
  }

  /** 保存（并可同时下载）；保存失败返回错误信息，当前工作台会话不受影响 */
  function saveReport(report: DiagnosticReport, alsoDownload: boolean): { ok: boolean; error?: string } {
    try {
      const stamped: DiagnosticReport = { ...report, savedAt: new Date().toISOString() }
      const idx = savedReports.value.findIndex((r) => r.id === stamped.id)
      if (idx >= 0) savedReports.value.splice(idx, 1, stamped)
      else savedReports.value.unshift(stamped)
      if (savedReports.value.length > MAX_STORED_REPORTS) {
        savedReports.value = savedReports.value.slice(0, MAX_STORED_REPORTS)
      }
      persist()
      if (alsoDownload) {
        try {
          downloadReport(stamped)
        } catch (e: any) {
          // 保存已成功，仅下载失败：不回滚本地报告
          return { ok: true, error: `报告已保存，但下载文件失败：${e?.message || '未知错误'}` }
        }
      }
      return { ok: true }
    } catch (e: any) {
      lastError.value = e?.message || '保存失败'
      return { ok: false, error: lastError.value }
    }
  }

  /** 仅下载，不落本地存储 */
  function downloadOnly(report: DiagnosticReport): { ok: boolean; error?: string } {
    try {
      downloadReport(report)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: `下载失败：${e?.message || '未知错误'}` }
    }
  }

  function openViewer(report: DiagnosticReport) {
    activeReport.value = report
    verifyResult.value = null
    viewerOpen.value = true
    // 重新打开即重算校验关键数字
    try {
      verifyResult.value = verifyReport(report)
    } catch (e: any) {
      verifyResult.value = {
        status: 'engine-error',
        diffs: [],
        message: `校验过程出错：${e?.message || '未知错误'}`,
      }
    }
  }

  function reVerify() {
    if (!activeReport.value) return
    verifyResult.value = verifyReport(activeReport.value)
  }

  function closeViewer() {
    viewerOpen.value = false
    activeReport.value = null
    verifyResult.value = null
  }

  /** 从文件文本导入：解析、校验、保存并打开。失败抛错由调用方提示，可重新选择文件重试 */
  function importFromText(text: string): DiagnosticReport {
    const report = parseReport(text)
    const idx = savedReports.value.findIndex((r) => r.id === report.id)
    if (idx >= 0) savedReports.value.splice(idx, 1, report)
    else savedReports.value.unshift(report)
    persist()
    return report
  }

  function deleteReport(id: string) {
    savedReports.value = savedReports.value.filter((r) => r.id !== id)
    persist()
  }

  return {
    exportOpen, viewerOpen, activeReport, verifyResult, savedReports, lastError,
    allSections,
    loadSaved, openExport, closeExport, buildReport, saveReport, downloadOnly,
    openViewer, reVerify, closeViewer, importFromText, deleteReport,
  }
})

export { REQUIRED_SECTIONS, SECTION_OPTIONS }
