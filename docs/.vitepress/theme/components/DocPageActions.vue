<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'

const { page, lang } = useData()

// vitepress-plugin-llms emits Markdown for the English tree only, at the page's path without
// the locale prefix: en/build/agents.md and zh/build/agents.md both map to /docs/build/agents.md.
const markdownUrl = computed(() => {
  const path = page.value.relativePath.match(/^(?:en|zh)\/(.+\.md)$/)?.[1]
  return path ? withBase(`/${path}`) : null
})

const zh = computed(() => lang.value.startsWith('zh'))
const labels = computed(() =>
  zh.value
    ? { copy: '复制英文 Markdown', copied: '已复制', failed: '复制失败', view: '查看英文 Markdown' }
    : { copy: 'Copy page', copied: 'Copied', failed: 'Copy failed', view: 'View as Markdown' },
)

const status = ref<'idle' | 'copied' | 'failed'>('idle')
let reset: ReturnType<typeof setTimeout> | undefined

async function fetchMarkdown(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status}`)
  return response.text()
}

async function copyPage() {
  const url = markdownUrl.value
  if (!url) return
  try {
    // Safari only grants clipboard access within the click, so hand it the pending fetch
    // instead of awaiting it first. Fall back to writeText where ClipboardItem is missing.
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = fetchMarkdown(url).then((text) => new Blob([text], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    } else {
      await navigator.clipboard.writeText(await fetchMarkdown(url))
    }
    status.value = 'copied'
  } catch {
    status.value = 'failed'
  }
  clearTimeout(reset)
  reset = setTimeout(() => (status.value = 'idle'), 2000)
}
</script>

<template>
  <div v-if="markdownUrl" class="zc-page-actions">
    <button type="button" class="zc-page-action" @click="copyPage">
      {{ status === 'copied' ? labels.copied : status === 'failed' ? labels.failed : labels.copy }}
    </button>
    <a class="zc-page-action" :href="markdownUrl" target="_blank" rel="noopener">{{ labels.view }}</a>
  </div>
</template>
