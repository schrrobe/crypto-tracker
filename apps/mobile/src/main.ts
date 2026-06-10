import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'

import App from './App.vue'
import { router } from './router'

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

const app = createApp(App).use(IonicVue).use(createPinia()).use(router)

router.isReady().then(() => {
  app.mount('#app')
})
