<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import SearchButton from 'vitepress/dist/client/theme-default/components/VPNavBarSearchButton.vue'
import DocPageActions from './DocPageActions.vue'

const { Layout } = DefaultTheme
const { page } = useData()

function openSearch() {
  // Keep VitePress's single search dialog and keyboard-shortcut handler.
  document.querySelector<HTMLButtonElement>('.VPNavBarSearch .DocSearch-Button')?.click()
}
</script>

<template>
  <Layout :class="{ 'zc-english-docs': page.relativePath.startsWith('en/') }">
    <template #sidebar-nav-before>
      <div class="zc-sidebar-search">
        <SearchButton @click="openSearch" />
      </div>
    </template>
    <template #doc-before>
      <DocPageActions />
    </template>
  </Layout>
</template>
