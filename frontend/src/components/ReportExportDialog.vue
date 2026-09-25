<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="close">
    <div class="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 sticky top-0 bg-slate-800">
        <h3 class="text-base font-bold text-cyan-400">导出匹配诊断报告</h3>
        <button @click="close" class="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
      </div>

      <div class="p-5 space-y-4">
        <!-- 当前工作台快照 -->
        <div class="bg-slate-900 rounded-lg p-3 text-sm space-y-1">
          <div class="flex justify-between gap-2">
            <span class="text-slate-500 shrink-0">正则</span>
            <span class="font-mono text-cyan-400 truncate">{{ store.pattern || '（空）' }}</span>
          </div>
          <div class="flex justify-between gap-2">
            <span class="text-slate-500 shrink-0">测试文本</span>
            <span class="text-slate-300 truncate">{{ store.testString || '（空）' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">匹配状态</span>
            <span :class="snapshot?.matched ? 'text-green-400' : 'text-red-400'">
              {{ store.matchResult ? (store.matchResult.matched ? '✓ 匹配成功' : '✗ 未匹配') : '无匹配结果' }}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">关键数字</span>
            <span class="text-slate-300">总步数 {{ snapshot?.totalSteps ?? 0 }} · 回溯 {{ snapshot?.backtracks ?? 0 }} · {{ snapshot?.duration ?? 0 }}ms</span>
          </div>
        </div>

        <!-- 特殊情况说明 -->
        <div v-if="notices.length" class="space-y-2">
          <div
            v-for="notice in notices"
            :key="notice.id"
            class="text-sm rounded-lg px-3 py-2 border"
            :class="notice.severity === 'error'
              ? 'bg-red-900/30 border-red-700 text-red-300'
              : notice.severity === 'warning'
                ? 'bg-orange-900/30 border-orange-700 text-orange-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'"
          >
            <span class="font-bold">{{ notice.icon }} {{ notice.title }}</span>
            <span class="ml-1">{{ notice.detail }}</span>
          </div>
        </div>

        <!-- 标题 / 备注 -->
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">报告标题（可选）</label>
          <input
            v-model="title"
            type="text"
            placeholder="留空则自动生成"
            class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">备注（可选）</label>
          <textarea
            v-model="note"
            rows="2"
            placeholder="补充排查背景，将写入报告"
            class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-cyan-500"
          ></textarea>
        </div>

        <!-- 分组选择 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs font-bold text-slate-500">包含分组</label>
            <div class="flex gap-2 text-xs">
              <button @click="selectAll" class="text-cyan-400 hover:text-cyan-300">全选</button>
              <button @click="selectNone" class="text-slate-500 hover:text-slate-300">全不选</button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="section in selectableSections"
              :key="section.id"
            class="flex items-center gap-2 bg-slate-900 border rounded-lg px-3 py-2 text-sm cursor-pointer"
              :class="section.disabled ? 'border-slate-800 opacity-50 cursor-not-allowed' : isSelected(section.id) ? 'border-cyan-600' : 'border-slate-700'"
            >
              <input
                type="checkbox"
                :checked="isSelected(section.id)"
                :disabled="section.disabled"
                @change="toggle(section.id)"
                class="accent-cyan-500"
              />
              <span :class="section.disabled ? 'text-slate-500' : 'text-slate-200'">{{ section.label }}</span>
              <span v-if="section.hint" class="text-xs text-slate-500 ml-auto">{{ section.hint }}</span>
            </label>
          </div>
          <p class="text-xs text-slate-500 mt-2">
            注：正则与匹配状态属于必要复现信息，无论是否勾选都会写入报告。
          </p>
        </div>

        <!-- 失败提示与重试 -->
        <div v-if="errorMessage" class="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">
          ⚠ 报告生成失败：{{ errorMessage }}
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-700 sticky bottom-0 bg-slate-800">
        <button @click="close" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">取消</button>
        <button
          @click="retry"
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
        >↻ 重试</button>
        <button
          @click="generate"
          :disabled="generating"
          class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-lg text-white font-bold text-sm"
        >{{ generating ? '生成中…' : '生成并导出' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRegexStore } from '../store/regex'
import { useReportsStore } from '../store/reports'
import {
  ALL_SECTIONS,
  SECTION_LABELS,
  STEP_STORE_LIMIT,
  TEST_TEXT_LONG_THRESHOLD,
  TEST_TEXT_STORE_LIMIT,
  prepareTestText,
} from '../utils/diagnosticReport'
import type { ReportSectionId } from '../types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'generated', id: string): void
}>()

const store = useRegexStore()
const reports = useReportsStore()

const selected = ref<ReportSectionId[]>([...ALL_SECTIONS])
const title = ref('')
const note = ref('')
const generating = ref(false)
const errorMessage = ref('')

const snapshot = computed(() => store.matchResult)

const textStatus = computed(() => prepareTestText(store.testString))

interface Notice {
  id: string
  severity: 'error' | 'warning' | 'info'
  icon: string
  title: string
  detail: string
}

const notices = computed<Notice[]>(() => {
  const list: Notice[] = []
  if (!store.matchResult) {
    list.push({
      id: 'no-result',
      severity: 'error',
      icon: '⚠',
      title: '空结果',
      detail: '当前没有匹配结果（正则可能解析失败或尚未执行），报告将明确标注为空结果。',
    })
  } else if (!store.matchResult.matched) {
    list.push({
      id: 'no-match',
      severity: 'warning',
      icon: '✗',
      title: '未匹配',
      detail: '报告会给出未匹配的可能原因，并保留全部失败转移步骤用于定位。',
    })
  }
  if (store.testString.length === 0) {
    list.push({
      id: 'empty-text',
      severity: 'warning',
      icon: '∅',
      title: '测试文本为空',
      detail: '报告会说明输入为空，仅可复现空匹配场景。',
    })
  } else if (textStatus.value.isLong) {
    list.push({
      id: 'long-text',
      severity: 'info',
      icon: '📏',
      title: '超长测试文本',
      detail: textStatus.value.truncated
        ? `共 ${textStatus.value.length} 字符，超过 ${TEST_TEXT_STORE_LIMIT} 的部分将不写入文件，附原文指纹供核对。`
        : `共 ${textStatus.value.length} 字符，查看器中仅预览前 ${TEST_TEXT_LONG_THRESHOLD} 字符，文件内完整保留。`,
    })
  }
  if ((store.matchResult?.steps.length ?? 0) > STEP_STORE_LIMIT) {
    list.push({
      id: 'many-steps',
      severity: 'info',
      icon: '🧾',
      title: '步骤较多',
      detail: `共 ${store.matchResult!.steps.length} 步，报告仅保留前 ${STEP_STORE_LIMIT} 条并注明总数。`,
    })
  }
  return list
})

const selectableSections = computed(() =>
  ALL_SECTIONS.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    disabled: false,
    hint:
      id === 'steps' && !store.matchResult?.matched
        ? '含失败转移'
        : id === 'groups' && (store.matchResult?.groups.length ?? 0) === 0
          ? '空'
          : '',
  })),
)

function isSelected(id: ReportSectionId) {
  return selected.value.includes(id)
}
function toggle(id: ReportSectionId) {
  if (isSelected(id)) selected.value = selected.value.filter((s) => s !== id)
  else selected.value = [...selected.value, id]
}
function selectAll() {
  selected.value = [...ALL_SECTIONS]
}
function selectNone() {
  selected.value = []
}

function runGeneration(): boolean {
  errorMessage.value = ''
  if (!store.matchResult) {
    // 空结果仍允许导出（报告会说明），但正则本身不能为空
    if (!store.pattern) {
      errorMessage.value = '正则为空且没有匹配结果，无法生成可复现报告。'
      return false
    }
  }
  generating.value = true
  try {
    const report = reports.generate({
      pattern: store.pattern,
      testText: store.testString,
      matchResult: store.matchResult,
      nfa: store.nfa,
      sections: selected.value,
      title: title.value,
      note: note.value,
    })
    emit('generated', report.id)
    return true
  } catch (e: any) {
    errorMessage.value = e?.message || '未知错误'
    return false
  } finally {
    generating.value = false
  }
}

function generate() {
  if (runGeneration()) close()
}

/** 失败后重试：重新读取当前工作台快照再生成，会话状态不丢失 */
function retry() {
  runGeneration()
}

function close() {
  emit('close')
}

defineExpose({ reset: () => { errorMessage.value = '' } })
</script>
