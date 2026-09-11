<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import SearchButton from 'vitepress/dist/client/theme-default/components/VPNavBarSearchButton.vue'

const { Layout } = DefaultTheme

function openSearch() {
  // Keep VitePress's single search dialog and keyboard-shortcut handler.
  document.querySelector<HTMLButtonElement>('.VPNavBarSearch .DocSearch-Button')?.click()
}
</script>

<template>
  <Layout>
    <template #sidebar-nav-before>
      <div class="zc-sidebar-search">
        <SearchButton @click="openSearch" />
      </div>
    </template>
  </Layout>
</template>
