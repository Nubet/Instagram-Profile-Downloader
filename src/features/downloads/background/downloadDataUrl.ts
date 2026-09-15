import browser from 'webextension-polyfill'

export async function downloadDataUrl(url: string, filename: string): Promise<void> {
  await browser.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  })
}
