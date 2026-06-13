import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'

import App from './App.vue'
import { router } from './router'
import { applyDetectedLocale, i18n } from './i18n'
import { preloadStorage } from './services/storage'

/* Ionic Core-Styles */
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

/* Dark Mode über CSS-Klasse (manueller Toggle + System-Default) */
import '@ionic/vue/css/palettes/dark.class.css'

import './theme/variables.css'

async function bootstrap(): Promise<void> {
  // Persistente Werte (Token, Sprache, Theme, aktives Portfolio) aus Capacitor
  // Storage in den synchronen Cache laden, bevor die App gemountet wird.
  await preloadStorage()
  applyDetectedLocale()

  const app = createApp(App).use(IonicVue).use(createPinia()).use(router).use(i18n)
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
