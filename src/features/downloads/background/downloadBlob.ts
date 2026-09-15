import browser from 'webextension-polyfill'

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob)

  try {
    await browser.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    })
  }
  finally {
    URL.revokeObjectURL(url)
  }
}
