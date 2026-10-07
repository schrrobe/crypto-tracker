<template>
  <!-- Replaceable placeholder mark: a statement sheet, three booked lines over a Summenstrich -->
  <svg class="brand-mark" :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="30" height="30" rx="8" class="paper" />
    <rect x="8" y="8.5" width="16" height="2" rx="1" class="ink" />
    <rect x="12" y="12.5" width="12" height="2" rx="1" class="ink" />
    <rect x="10" y="16.5" width="14" height="2" rx="1" class="ink" />
    <rect x="8" y="21" width="16" height="1.25" class="ink" />
    <rect x="8" y="23.25" width="16" height="1.25" class="ink" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 32 })
</script>

<style scoped>
.paper {
  fill: var(--app-ink);
}
.ink {
  fill: var(--app-ground);
}
</style>
