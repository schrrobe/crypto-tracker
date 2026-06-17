import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { AppConfigDto } from '@crypto-tracker/shared'
import { api, isNativePlatform } from './api.client'
import { compareVersions } from './version'

// Global force-update state — set by checkClientVersion() on native startup,
// rendered in App.vue via UpdateGateModal (non-dismissable, blocks the app).
export const updateRequired = ref(false)
export const storeUrl = ref<string | null>(null)

// Native-only: compare the running app version against the server minimum.
// Fail-open everywhere — a network/parse error or unset minimum must never
// accidentally lock the user out.
export async function checkClientVersion(): Promise<void> {
  if (!isNativePlatform) return
  try {
    const cfg = await api.get<AppConfigDto>('/app/config')
    const platform = Capacitor.getPlatform() // 'ios' | 'android'
    const min = platform === 'ios' ? cfg.minClientVersionIos : cfg.minClientVersionAndroid
    const url = platform === 'ios' ? cfg.storeUrlIos : cfg.storeUrlAndroid
    if (!min) return // gate inactive

    const info = await App.getInfo()
    if (compareVersions(info.version, min) < 0) {
      storeUrl.value = url
      updateRequired.value = true
    }
  } catch {
    // fail-open: do not block on errors
  }
}
