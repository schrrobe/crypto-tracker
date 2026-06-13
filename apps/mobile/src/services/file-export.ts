import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

// Datei-Export, der im Web wie nativ funktioniert:
//  - Web: klassischer Blob-Download über einen synthetischen Anchor.
//  - Nativ (iOS/Android): es gibt keinen Download-Dialog im WebView. Datei in
//    den Cache schreiben und über das System-Share-Sheet anbieten (Speichern,
//    Mail, Dateien-App …).

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      // data:<mime>;base64,<DATA> → nur den Teil nach dem Komma
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export async function saveOrShareFile(filename: string, blob: Blob): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    return
  }

  const data = await blobToBase64(blob)
  await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  await Share.share({ title: filename, files: [uri] })
}
