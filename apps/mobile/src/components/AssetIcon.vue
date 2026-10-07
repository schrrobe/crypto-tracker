<template>
  <!-- Decorative: the ticker is always printed next to it -->
  <span class="asset-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <img v-if="src && !failed" :src="src" alt="" loading="lazy" @error="failed = true" />
    <span v-else class="mono" :style="{ fontSize: `${Math.max(9, Math.round(size * 0.36))}px` }">{{ symbol.slice(0, 3) }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ src: string | null; symbol: string; size?: number }>(), { size: 24 })
const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false),
)
</script>

<style scoped>
.asset-icon {
  display: inline-grid;
  place-items: center;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(var(--app-ink-rgb), 0.07);
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mono {
  font-family: var(--app-font-ui);
  font-weight: 700;
  color: var(--app-ink-2);
  letter-spacing: -0.02em;
  line-height: 1;
}
</style>
