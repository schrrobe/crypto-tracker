<template>
  <div class="auth">
    <header class="brand">
      <BrandMark :size="32" />
      <span class="wordmark">{{ $t('auth.appTitle') }}</span>
    </header>
    <h1 class="title">{{ title }}</h1>
    <p class="promise">{{ $t('ui.auth.promise') }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
import BrandMark from './BrandMark.vue'

defineProps<{ title: string }>()
</script>

<style scoped>
.auth {
  max-width: 420px;
  margin: 0 auto;
  padding: calc(var(--app-space-7) + env(safe-area-inset-top, 0px)) var(--app-space-4)
    calc(var(--app-space-6) + env(safe-area-inset-bottom, 0px));
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin-bottom: var(--app-space-6);
}
.wordmark {
  font-weight: 700;
  font-size: var(--app-text-lg);
  letter-spacing: -0.01em;
}
.title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.promise {
  margin: var(--app-space-2) 0 var(--app-space-5);
  color: var(--app-ink-2);
  max-width: 36ch;
}
.auth :deep(form) {
  display: grid;
  gap: var(--app-space-4);
}
.auth :deep(.auth-fields) {
  margin: 0;
  border: 1px solid var(--app-rule-control);
  border-radius: var(--app-radius);
  --ion-item-background: var(--app-sheet);
}
.auth :deep(.auth-links) {
  display: grid;
  justify-items: start;
  gap: var(--app-space-1);
  margin-top: var(--app-space-5);
}
.auth :deep(.auth-links a) {
  display: inline-flex;
  align-items: center;
  min-height: var(--app-touch);
  font-weight: 600;
  text-decoration: none;
}
</style>
