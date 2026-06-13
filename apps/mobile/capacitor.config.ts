import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.cryptotracker.app',
  appName: 'Crypto Tracker',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      // Splash sofort nach App-Bootstrap selbst ausblenden (SplashScreen.hide()),
      // damit kein Weiß-Flash beim Laden des WebViews entsteht.
      launchAutoHide: false,
      backgroundColor: '#1a1a2e',
    },
  },
}

export default config
