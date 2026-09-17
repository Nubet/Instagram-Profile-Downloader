import browser from 'webextension-polyfill'

const id = new URLSearchParams(location.search).get('id')

if (id) {
  void download()
}

async function download() {
  try {
    const request = await browser.runtime.sendMessage({ type: 'download-ready', id }) as {
      filename: string
      mimeType: string
      value: BlobPart
    }
    const url = URL.createObjectURL(new Blob([request.value], { type: request.mimeType }))
    const anchor = document.createElement('a')
    anchor.href = url
    // Firefox's download attribute cannot create subfolders; keep the path in the filename
    anchor.download = request.filename.replace(/[\\/]/g, '_')
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    // Let Firefox start the transfer before revoking the URL and closing the tab
    await new Promise(resolve => setTimeout(resolve, 500))
    URL.revokeObjectURL(url)
    await browser.runtime.sendMessage({ type: 'download-complete', id })
  }
  catch (error) {
    await browser.runtime.sendMessage({
      type: 'download-error',
      id,
      message: error instanceof Error ? error.message : 'Unknown Firefox download error.',
    })
  }
}
