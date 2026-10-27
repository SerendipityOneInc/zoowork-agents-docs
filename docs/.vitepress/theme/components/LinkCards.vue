<script setup lang="ts">
// Wraps one Markdown list of links. Each item is a link paragraph followed by a one-line
// description paragraph. The list stays in the page source, so the generated AI Markdown
// carries the same links and descriptions; this component only lays them out as cards.
</script>

<template>
  <div class="zc-link-cards">
    <slot />
  </div>
</template>
