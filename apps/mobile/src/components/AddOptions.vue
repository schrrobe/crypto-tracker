<template>
  <ul class="stmt sheet add-options">
    <li v-for="o in options" :key="o.key">
      <router-link
        v-if="mode === 'link'"
        class="stmt-row add-row"
        :to="o.to"
        :data-testid="`${prefix}-${o.id}`"
      >
        <span class="glyph" aria-hidden="true"><ion-icon :icon="o.icon" /></span>
        <span class="stmt-main">
          <span class="stmt-label">{{ $t(`ui.add.${o.key}.title`) }}</span>
          <span class="stmt-sub">{{ $t(`ui.add.${o.key}.body`) }}</span>
        </span>
        <ion-icon class="chev" :icon="chevronForward" aria-hidden="true" />
      </router-link>
      <button
        v-else
        type="button"
        class="stmt-row add-row"
        :data-testid="`${prefix}-${o.id}`"
        @click="emit('chosen', o.key)"
      >
        <span class="glyph" aria-hidden="true"><ion-icon :icon="o.icon" /></span>
        <span class="stmt-main">
          <span class="stmt-label">{{ $t(`ui.add.${o.key}.title`) }}</span>
          <span class="stmt-sub">{{ $t(`ui.add.${o.key}.body`) }}</span>
        </span>
        <ion-icon class="chev" :icon="chevronForward" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue'
import { chevronForward, createOutline, documentTextOutline, keyOutline, walletOutline } from 'ionicons/icons'

export type AddKind = 'exchange' | 'wallet' | 'csv' | 'manual'

// The single "add" vocabulary: four ways in, each saying what it needs.
// link mode routes to the screen that owns the form; emit mode lets the host
// open the form in place (the add sheet on the sources tab).
withDefaults(defineProps<{ mode?: 'link' | 'emit'; prefix?: string }>(), {
  mode: 'link',
  prefix: 'onboarding',
})
const emit = defineEmits<{ chosen: [kind: AddKind] }>()

const options = [
  { key: 'exchange', id: 'connect', icon: keyOutline, to: '/tabs/sources?add=exchange' },
  { key: 'wallet', id: 'wallet', icon: walletOutline, to: '/tabs/sources?add=wallet' },
  { key: 'csv', id: 'csv', icon: documentTextOutline, to: '/tabs/sources?csv=1' },
  { key: 'manual', id: 'manual', icon: createOutline, to: '/tabs/holdings?add=1' },
] as const
</script>

<style scoped>
.add-row {
  grid-template-columns: 36px minmax(0, 1fr) 16px;
  min-height: 68px;
}
.glyph {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--app-accent-soft);
  color: var(--app-accent);
  font-size: 1.125rem;
}
.chev {
  color: var(--app-ink-3);
}
</style>
