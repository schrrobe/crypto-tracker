import { env } from './config/env'
import { createApp } from './app'

const app = createApp()

app.listen(env.PORT, () => {
  console.log(`API läuft auf http://localhost:${env.PORT}/api/v1 (APP_ENV=${env.APP_ENV})`)
})
