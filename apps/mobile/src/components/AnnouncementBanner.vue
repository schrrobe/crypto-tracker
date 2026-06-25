<template>
  <div v-if="store.visible.length" class="announcement-stack" data-testid="announcement-stack">
    <div
      v-for="a in store.visible"
      :key="a.id"
      class="announcement"
      :class="a.level === 'ERROR' ? 'is-error' : 'is-info'"
      role="alert"
      data-testid="announcement"
    >
      <span class="msg">{{ a.message }}</span>
      <button class="close" :aria-label="$t('common.close')" data-testid="announcement-dismiss" @click="store.dismiss(a.id)">
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAnnouncementsStore } from '../stores/announcements.store'

const store = useAnnouncementsStore()
</script>

<style scoped>
/* Fixed overlay so the broadcast is visible on every screen. */
.announcement-stack {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  padding-top: env(safe-area-inset-top);
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
  background: #f1c40f;
  color: #1a1a1a;
}
.msg {
  flex: 1;
}
.close {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
</style>
