<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    @click.self="$emit('cancel')"
    @keydown.esc="$emit('cancel')"
  >
    <div
      ref="dialogEl"
      class="bg-white rounded-lg shadow-xl w-full max-w-md p-5"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
    >
      <h2 :id="titleId" class="text-lg font-semibold text-slate-800 mb-2">{{ title }}</h2>
      <div class="text-sm text-slate-600 mb-5 whitespace-pre-line">
        <slot>{{ message }}</slot>
      </div>
      <div class="flex justify-end gap-2">
        <button
          ref="cancelEl"
          class="rounded border border-slate-300 text-sm px-3 py-2 text-slate-700 hover:bg-slate-50"
          @click="$emit('cancel')"
        >
          Abbrechen
        </button>
        <button
          class="rounded text-white text-sm px-3 py-2"
          :class="danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'"
          @click="$emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

withDefaults(
  defineProps<{
    title: string
    message?: string
    confirmLabel: string
    danger?: boolean
  }>(),
  { message: '', danger: false },
)

defineEmits<{ confirm: []; cancel: [] }>()

// Stable, unique id so the heading can name the dialog via aria-labelledby.
const titleId = `confirm-dialog-title-${Math.random().toString(36).slice(2, 9)}`

const dialogEl = ref<HTMLElement | null>(null)
const cancelEl = ref<HTMLButtonElement | null>(null)

// Move focus into the dialog on mount so keyboard users land inside the overlay
// (Escape to cancel is wired via @keydown.esc on the container).
onMounted(() => {
  ;(cancelEl.value ?? dialogEl.value)?.focus()
})
</script>
