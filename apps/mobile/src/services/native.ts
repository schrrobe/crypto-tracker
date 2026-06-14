import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { Router } from 'vue-router'

// Native device integration. A no-op on web — all calls are encapsulated behind
// isNativePlatform() so that the browser build stays untouched.
export async function initNative(router: Router): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  // StatusBar follows the app theme; do not overlay the content.
  try {
    await StatusBar.setStyle({ style: Style.Default })
    await StatusBar.setOverlaysWebView({ overlay: false })
  } catch {
    /* StatusBar not available on some devices/platforms */
  }

  // Input fields: shrink the WebView along instead of covering the content.
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
  } catch {
    /* Keyboard plugin optional */
  }

  // Android hardware back: navigate, otherwise close the app.
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && router.currentRoute.value.path !== '/tabs/dashboard') {
      router.back()
    } else {
      void CapApp.exitApp()
    }
  })

  // Hide the splash only once the app is ready (no white flash).
  await SplashScreen.hide()
}
