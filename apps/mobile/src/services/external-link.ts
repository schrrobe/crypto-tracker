import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

// Open external links (e.g. the exchanges' API-key guides):
//  - Web: new tab.
//  - Native: in-app browser (Capacitor Browser), so the user returns to the app
//    via "Done" instead of leaving it through the system browser.
export async function openExternal(url: string | undefined): Promise<void> {
  if (!url) return
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
