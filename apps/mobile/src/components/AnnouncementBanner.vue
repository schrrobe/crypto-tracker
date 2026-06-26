<template>
  <div
    v-if="store.visible.length"
    ref="stackEl"
    class="announcement-stack"
    data-testid="announcement-stack"
  >
    <div
      v-for="a in store.visible"
      :key="a.id"
      class="announcement"
      :class="a.level === 'ERROR' ? 'is-error' : 'is-info'"
      :role="style(a).role"
      data-testid="announcement"
    >
      <span class="icon" aria-hidden="true">{{ style(a).icon }}</span>
      <span class="label">{{ $t(style(a).labelKey) }}</span>
      <span class="msg">{{ message(a) }}</span>
      <button
        v-if="a.dismissible"
        class="close"
        :aria-label="$t('common.close')"
        data-testid="announcement-dismiss"
        @click="store.dismiss(a)"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import {
  ANNOUNCEMENT_LEVEL_STYLE,
  resolveAnnouncementMessage,
  type AnnouncementDto,
} from '@crypto-tracker/shared'
import { useAnnouncementsStore } from '../stores/announcements.store'
import { getLocale } from '../i18n'

const store = useAnnouncementsStore()
const stackEl = ref<HTMLElement | null>(null)

function style(a: AnnouncementDto) {
  return ANNOUNCEMENT_LEVEL_STYLE[a.level]
}
function message(a: AnnouncementDto): string {
  return resolveAnnouncementMessage(a.messages, a.defaultLocale, getLocale())
}

// Reserve layout space equal to the rendered stack height (incl. safe-area)
// so the fixed banner never covers the Ionic toolbar. Empty state reserves 0.
function setOffset(px: number): void {
  document.documentElement.style.setProperty('--announcement-offset', `${px}px`)
}

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => setOffset(stackEl.value?.offsetHeight ?? 0))
  watch(
    () => store.visible.length,
    async () => {
      // v-if recreates the stack element each show cycle; drop the previous
      // (now-detached) observation before observing the new node to avoid leaks.
      ro?.disconnect()
      await nextTick()
      if (stackEl.value) ro?.observe(stackEl.value)
      setOffset(stackEl.value?.offsetHeight ?? 0)
    },
    { immediate: true },
  )
})
onBeforeUnmount(() => {
  ro?.disconnect()
  setOffset(0)
})
</script>

<style scoped>
/* Fixed overlay so the broadcast is visible on every screen. Content is offset
   by --announcement-offset (set above + consumed in App.vue) so it is not hidden. */
.announcement-stack {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  padding-top: env(safe-area-inset-top);
  max-height: 40vh;
  overflow-y: auto;
}
.announcement {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.3;
}
.announcement.is-error {
  background: #c0392b;
  color: #fff;
}
.announcement.is-info {
  background: #2d6cdf;
  color: #fff;
}
.icon {
  font-size: 16px;
  flex: none;
}
.label {
  font-weight: 700;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.04em;
  flex: none;
}
.msg {
  flex: 1;
  /* Do NOT clamp: this banner is the only surface that renders the incident /
     maintenance text, so the full message must be readable. The stack caps its
     own height (max-height: 40vh) and scrolls if a notice is very long. */
  white-space: pre-line;
  word-break: break-word;
}
.close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: -10px -8px -10px 0;
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
</style>
