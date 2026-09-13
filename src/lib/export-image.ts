import { toPng } from 'html-to-image'
import { isUntitledTitle, t } from './i18n'
import { fitMapPlaces } from './map-view'

function fileName(title: string): string {
  const raw = isUntitledTitle(title) ? t('common.untitled') : title.trim()
  const safe = raw.replace(/[\\/:*?"<>|]/g, '').slice(0, 80).trim()
  return `${safe || 'lushu'}.png`
}

/** 地图居中后，把当前路书页收成 PNG 下载。 */
export async function downloadJourneyImage(title: string): Promise<void> {
  await fitMapPlaces()
  const node = document.querySelector('.app')
  if (!(node instanceof HTMLElement)) throw new Error('no app')
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    filter: (el) => !(el instanceof HTMLElement && el.classList.contains('export-loading')),
  })
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName(title)
  a.click()
}
