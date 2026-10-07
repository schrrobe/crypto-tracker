import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue, mdTransitionAnimation } from '@ionic/vue'

import App from './App.vue'
import { router } from './router'
import { applyDetectedLocale, i18n } from './i18n'
import { preloadStorage } from './services/storage'
import { initPrivacy } from './services/privacy'

/* Ionic core styles */
import '@ionic/vue/css/core.css'
import '@ionic/vue/css/normalize.css'
import '@ionic/vue/css/structure.css'
import '@ionic/vue/css/typography.css'
import '@ionic/vue/css/padding.css'
import '@ionic/vue/css/float-elements.css'
import '@ionic/vue/css/text-alignment.css'
import '@ionic/vue/css/text-transformation.css'
import '@ionic/vue/css/flex-utils.css'
import '@ionic/vue/css/display.css'

/* Dark mode via CSS class (manual toggle + system default) */
import '@ionic/vue/css/palettes/dark.class.css'

import '@fontsource-variable/golos-text/index.css'
import '@fontsource-variable/martian-mono/standard.css'

import './theme/variables.css'
import './theme/global.css'

async function bootstrap(): Promise<void> {
  // Load persistent values (token, language, theme, active portfolio) from Capacitor
  // Storage into the synchronous cache before the app is mounted.
  await preloadStorage()
  applyDetectedLocale()
  initPrivacy()

  // One design language on every device (iOS-style controls), but the short
  // Material page transition: the long iOS push/pop leaves a window in which a
  // quick second tab tap desyncs the tab stack. Reduced motion: no page animation.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const app = createApp(App)
    .use(IonicVue, {
      mode: 'ios',
      swipeBackEnabled: true,
      navAnimation: mdTransitionAnimation,
      animated: !reducedMotion,
    })
    .use(createPinia())
    .use(router)
    .use(i18n)
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
