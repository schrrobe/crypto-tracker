import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

// File export that works on web as well as native:
//  - Web: classic blob download via a synthetic anchor.
//  - Native (iOS/Android): there is no download dialog in the WebView. Write the
//    file to the cache and offer it via the system share sheet (Save,
//    Mail, Files app …).

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      // data:<mime>;base64,<DATA> → only the part after the comma
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
