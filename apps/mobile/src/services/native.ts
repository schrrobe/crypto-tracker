import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { Router } from 'vue-router'

// Native Geräte-Integration. Auf Web ein No-Op — alle Aufrufe sind hinter
// isNativePlatform() gekapselt, damit der Browser-Build unberührt bleibt.
export async function initNative(router: Router): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  // StatusBar folgt dem App-Theme; nicht über den Inhalt legen.
  try {
    await StatusBar.setStyle({ style: Style.Default })
    await StatusBar.setOverlaysWebView({ overlay: false })
  } catch {
    /* StatusBar auf manchen Geräten/Plattformen nicht verfügbar */
  }

  // Eingabefelder: WebView mitschrumpfen, statt den Inhalt zu überdecken.
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
  } catch {
    /* Keyboard-Plugin optional */
  }

  // Android-Hardware-Zurück: navigieren, sonst App schließen.
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && router.currentRoute.value.path !== '/tabs/dashboard') {
      router.back()
    } else {
      void CapApp.exitApp()
    }
  })

  // Splash erst ausblenden, wenn die App bereit ist (kein Weiß-Flash).
  await SplashScreen.hide()
}
