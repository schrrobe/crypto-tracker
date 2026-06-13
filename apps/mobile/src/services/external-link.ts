import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

// Externe Links (z.B. die API-Key-Anleitungen der Exchanges) öffnen:
//  - Web: neuer Tab.
//  - Nativ: In-App-Browser (Capacitor Browser), damit der Nutzer per „Fertig"
//    in die App zurückkehrt statt sie über den System-Browser zu verlassen.
export async function openExternal(url: string | undefined): Promise<void> {
  if (!url) return
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
