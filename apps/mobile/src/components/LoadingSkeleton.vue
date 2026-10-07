<template>
  <div class="sheet skeleton" data-testid="loading-skeleton" aria-busy="true" :aria-label="$t('ui.state.loading')">
    <div v-for="i in count" :key="i" class="row">
      <span class="main">
        <ion-skeleton-text animated class="l1" />
        <ion-skeleton-text animated class="l2" />
      </span>
      <ion-skeleton-text animated class="v" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonSkeletonText } from '@ionic/vue'

withDefaults(defineProps<{ count?: number }>(), { count: 3 })
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-space-4);
  min-height: 56px;
  padding: 0 var(--app-space-4);
  border-top: 1px solid var(--app-rule);
}
.row:first-child {
  border-top: 0;
}
.main {
  flex: 1;
}
.l1 {
  width: 40%;
  height: 14px;
}
.l2 {
  width: 62%;
  height: 11px;
}
.v {
  width: 72px;
  height: 14px;
}
</style>
