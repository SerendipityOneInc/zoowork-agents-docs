<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useData } from 'vitepress'

// Wraps one fenced code block in the page Markdown. The block stays in the source, so the
// generated AI Markdown carries the same prompt text; this component only changes how a
// reader sees it: a short preview with Copy and Expand, and the full prompt in a dialog.
defineProps<{ title: string }>()

const { lang } = useData()
const zh = () => lang.value.startsWith('zh')
const label = (en: string, cn: string) => (zh() ? cn : en)

const preview = ref<HTMLElement>()
const dialog = ref<HTMLDialogElement>()
const copied = ref(false)
// The dialog is teleported to <body>, which only exists in the browser.
const mounted = ref(false)
let reset: ReturnType<typeof setTimeout> | undefined

onMounted(() => (mounted.value = true))
onBeforeUnmount(() => clearTimeout(reset))

function promptText(): string {
  return preview.value?.querySelector('pre')?.innerText.trimEnd() ?? ''
}

async function copy() {
  try {
    await navigator.clipboard.writeText(promptText())
    copied.value = true
    clearTimeout(reset)
    reset = setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Leave the label unchanged; the reader can still select the text in the dialog.
  }
}

// Open state lives on the native <dialog> only, so Escape, the close button and a backdrop
// click cannot leave a copy of it out of sync. The stylesheet locks page scroll while open.
function expand() {
  dialog.value?.showModal()
}

function close() {
  dialog.value?.close()
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === dialog.value) close()
}
</script>

<template>
  <div class="zc-agent-prompt">
    <div class="zc-agent-prompt-header">
      <span class="zc-agent-prompt-title">{{ title }}</span>
      <button type="button" class="zc-agent-prompt-copy" @click="copy">
        {{ copied ? label('Copied', '已复制') : label('Copy prompt', '复制 prompt') }}
      </button>
    </div>
    <div ref="preview" class="zc-agent-prompt-preview">
      <slot />
      <div class="zc-agent-prompt-fade">
        <button type="button" class="zc-agent-prompt-expand" @click="expand">
          {{ label('Expand prompt', '展开 prompt') }}
        </button>
      </div>
    </div>

    <Teleport v-if="mounted" to="body">
      <dialog
        ref="dialog"
        class="zc-agent-prompt-dialog"
        :aria-label="title"
        @click="onBackdropClick"
      >
        <div class="zc-agent-prompt-header">
          <span class="zc-agent-prompt-title">{{ title }}</span>
          <button type="button" class="zc-agent-prompt-copy" @click="copy">
            {{ copied ? label('Copied', '已复制') : label('Copy prompt', '复制 prompt') }}
          </button>
          <button
            type="button"
            class="zc-agent-prompt-close"
            :aria-label="label('Close', '关闭')"
            @click="close"
          >
            ×
          </button>
        </div>
        <div class="zc-agent-prompt-full">
          <slot />
        </div>
      </dialog>
    </Teleport>
  </div>
</template>
