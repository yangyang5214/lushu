import { useEffect, useState, type RefObject } from 'react'
import type { PublicConfig } from '../../shared/public-config'
import type { Lang } from './i18n'

// 地图图面只走高德 JS API 2.0（不再用 Leaflet，也没有其它底图 / 回落）。
//
// key 是「Web端(JS API)」公开 key。本地 `pnpm dev` 时 vite 从 wrangler.toml
// 的 [vars].AMAP_JS_KEY 注入；Git 部署读不到 gitignore 的 wrangler.toml，
// 所以空 key 时再向 `/api/config` 要一份（Pages secret / [vars]）。

const BAKED_JS_KEY = String(import.meta.env.VITE_AMAP_JS_KEY ?? '').trim()
const BAKED_SECURITY_CODE = String(import.meta.env.VITE_AMAP_SECURITY_CODE ?? '').trim()
const SCRIPT_URL = 'https://webapi.amap.com/maps'
const EMPTY_CONFIG: PublicConfig = { amapJsKey: '', amapSecurityCode: '' }

// ── SDK 类型（只声明用到的成员，避免引入整包类型） ──────────────────────────

export type AmapPixel = { x: number; y: number }
export type AmapLngLat = { getLng(): number; getLat(): number }

export type AmapOverlay = {
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler?: (...args: unknown[]) => void): void
}

export type AmapMap = {
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler?: (...args: unknown[]) => void): void
  add(overlay: AmapOverlay | AmapOverlay[]): void
  remove(overlay: AmapOverlay | AmapOverlay[]): void
  addControl(control: unknown): void
  destroy(): void
  resize(): void
  lngLatToContainer(position: AmapLngLat | [number, number]): AmapPixel
  containerToLngLat(pixel: AmapPixel): AmapLngLat
  setFitView(overlays?: AmapOverlay[], immediately?: boolean, avoid?: number[], maxZoom?: number): void
}

export type AmapApi = {
  Map: new (container: HTMLElement, options?: Record<string, unknown>) => AmapMap
  Marker: new (options: Record<string, unknown>) => AmapOverlay
  Polyline: new (options: Record<string, unknown>) => AmapOverlay
  Pixel: new (x: number, y: number) => AmapPixel
  LngLat: new (lng: number, lat: number) => AmapLngLat
  ToolBar: new (options?: Record<string, unknown>) => unknown
}

declare global {
  interface Window {
    AMap?: AmapApi
    _AMapSecurityConfig?: { securityJsCode?: string }
  }
}

// ── SDK 加载 ────────────────────────────────────────────────────────────────

type AmapCreds = { key: string; security: string }

let runtimeConfig: Promise<PublicConfig> | null = null

function fetchRuntimeConfig(): Promise<PublicConfig> {
  if (runtimeConfig) return runtimeConfig
  runtimeConfig = fetch('/api/config')
    .then(async (res) => {
      if (!res.ok) return EMPTY_CONFIG
      const data = (await res.json()) as Partial<PublicConfig>
      return {
        amapJsKey: String(data.amapJsKey ?? '').trim(),
        amapSecurityCode: String(data.amapSecurityCode ?? '').trim(),
      }
    })
    .catch(() => EMPTY_CONFIG)
  return runtimeConfig
}

function resolveCreds(): Promise<AmapCreds> {
  if (BAKED_JS_KEY) {
    return Promise.resolve({ key: BAKED_JS_KEY, security: BAKED_SECURITY_CODE })
  }
  return fetchRuntimeConfig().then((cfg) => ({
    key: cfg.amapJsKey,
    security: cfg.amapSecurityCode,
  }))
}

if (!BAKED_JS_KEY) void fetchRuntimeConfig()

type Loaded = { lang: Lang; promise: Promise<AmapApi> }
let loaded: Loaded | null = null

/**
 * 按需加载高德 JS API。`lang` 只能在加载时指定，所以切语言 = 换一份 SDK 重新加载，
 * 地图实例跟着重建（用 useAmapMap 不用自己管这件事）。
 */
export function loadAmap(lang: Lang): Promise<AmapApi> {
  return resolveCreds().then(({ key, security }) => {
    if (!key) return Promise.reject(new Error('amap_unconfigured'))
    if (loaded?.lang === lang) return loaded.promise
    const promise = inject(lang, key, security)
    loaded = { lang, promise }
    void promise.catch(() => {
      if (loaded?.promise === promise) loaded = null
    })
    return promise
  })
}

function inject(lang: Lang, key: string, security: string): Promise<AmapApi> {
  return new Promise<AmapApi>((resolve, reject) => {
    document.querySelectorAll('script[data-lushu-amap]').forEach((el) => el.remove())
    delete window.AMap
    if (security) window._AMapSecurityConfig = { securityJsCode: security }

    const script = document.createElement('script')
    script.dataset.lushuAmap = '1'
    script.async = true
    const params = new URLSearchParams({ v: '2.0', key, lang: lang === 'en' ? 'en' : 'zh_cn' })
    script.src = `${SCRIPT_URL}?${params.toString()}`
    script.onload = () => {
      if (window.AMap) resolve(window.AMap)
      else reject(new Error('amap_missing'))
    }
    script.onerror = () => reject(new Error('amap_load_failed'))
    document.head.appendChild(script)
  })
}

/**
 * 响应式高德地图：SDK 和实例都随 `lang` 重建，返回值（api / map）可以直接当 effect 依赖。
 * 没配 key 或脚本加载失败时 `failed` 为 true，页面其余部分照常。
 */
export function useAmapMap(hostRef: RefObject<HTMLElement | null>, lang: Lang) {
  const [api, setApi] = useState<AmapApi | null>(null)
  const [map, setMap] = useState<AmapMap | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let cancelled = false
    let instance: AmapMap | null = null
    let observer: ResizeObserver | null = null
    setApi(null)
    setMap(null)
    setFailed(false)

    void loadAmap(lang).then(
      (mod) => {
        if (cancelled) return
        instance = new mod.Map(el, {
          zoom: 6,
          center: [119.3, 30.6],
          zooms: [4, 17],
          viewMode: '2D',
          resizeEnable: true,
        })
        try {
          instance.addControl(
            new mod.ToolBar({ position: { top: '12px', right: '12px' }, liteStyle: true }),
          )
        } catch {
          /* 控件拿不到就算了，底图还能用 */
        }
        observer = new ResizeObserver(() => instance?.resize())
        observer.observe(el)
        setApi(mod)
        setMap(instance)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )

    return () => {
      cancelled = true
      observer?.disconnect()
      observer = null
      instance?.destroy()
      instance = null
    }
  }, [hostRef, lang])

  return { api, map, failed }
}

// ── 覆盖物 ──────────────────────────────────────────────────────────────────

/** 圆点标记：起点 / 终点显示文字徽标，其余显示序号。 */
export function markerHtml(label: string, color: string, active = false): string {
  return `<div class="pin${active ? ' on' : ''}" style="--ink:${color}"><span>${label}</span></div>`
}

/** 一个地点标记；坐标必须是 GCJ02（高德底图的坐标系）。 */
export function placeMarker(
  api: AmapApi,
  lng: number,
  lat: number,
  html: string,
  onClick?: () => void,
): AmapOverlay {
  const marker = new api.Marker({
    position: [lng, lat],
    content: html,
    offset: new api.Pixel(-11, -11),
    zIndex: 130,
  })
  if (onClick) marker.on('click', () => onClick())
  return marker
}

/** 一天的路线折线；路径已经是 GCJ02，直接用。 */
export function dayPolyline(api: AmapApi, path: [number, number][], color: string): AmapOverlay {
  return new api.Polyline({
    path,
    strokeColor: color,
    strokeWeight: 5.5,
    strokeOpacity: 1,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 50,
  })
}

/** 地图已经销毁时覆盖物也一起没了，移除失败不算错。 */
export function removeOverlays(map: AmapMap | null, overlays: AmapOverlay[]): void {
  if (!map || overlays.length === 0) return
  try {
    map.remove(overlays)
  } catch {
    /* 地图已销毁 */
  }
}

/** 把一组覆盖物收进视野：留一点边距，且别放到最大级别。 */
export function fitPlaces(map: AmapMap, overlays: AmapOverlay[], maxZoom = 10): void {
  if (overlays.length === 0) return
  map.setFitView(overlays, false, [60, 60, 60, 60], maxZoom)
}

// ── 方向标识 ────────────────────────────────────────────────────────────────

type RouteArrow = { lng: number; lat: number; angle: number }

/** 屏幕上两个方向标识的间距（像素）：按屏幕距离放，长线短线、几天都一个密度。 */
const ARROW_GAP_PX = 58
/** 一条线最多几个，防止极长线在低缩放下堆成一条白带。 */
const ARROW_MAX = 120

/**
 * 沿折线等距取方向标。距离按当前缩放的像素算，
 * 所以同一屏里不同长度、不同天的路线看起来密度一致；太短（不足 1.5 个间距）不放。
 */
function routeArrows(map: AmapMap, api: AmapApi, line: [number, number][]): RouteArrow[] {
  if (line.length < 2) return []
  const pts = line.map(([lng, lat]) => map.lngLatToContainer(new api.LngLat(lng, lat)))
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const total = cum[cum.length - 1]
  if (total < ARROW_GAP_PX) return []

  // 个数向下取整，再均匀分布：间距落在 GAP/2 ~ GAP 之间，不会比别的线密一截。
  const count = Math.min(ARROW_MAX, Math.max(1, Math.floor(total / ARROW_GAP_PX)))
  const out: RouteArrow[] = []
  let seg = 0
  for (let k = 1; k <= count; k += 1) {
    const target = (total * k) / (count + 1)
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg += 1
    const a = pts[seg]
    const b = pts[seg + 1]
    const len = cum[seg + 1] - cum[seg]
    const t = len > 0 ? (target - cum[seg]) / len : 0
    // 朝向跨两段取：单个极短路段的角度噪声很大。
    const from = pts[Math.max(0, seg - 1)]
    const to = pts[Math.min(pts.length - 1, seg + 2)]
    const lnglat = map.containerToLngLat(
      new api.Pixel(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
    )
    out.push({
      lng: lnglat.getLng(),
      lat: lnglat.getLat(),
      angle: (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI,
    })
  }
  return out
}

/** 路线上的方向标识：白色双尖角（《 形），尺寸压在线宽（5.5px）以内，不盖住线路。 */
function arrowHtml(angle: number): string {
  return (
    `<div class="route-arrow" style="transform:rotate(${angle.toFixed(1)}deg)">` +
    '<svg viewBox="0 0 8 8" aria-hidden="true">' +
    '<path d="M1.8 4.6 4 1.8 6.2 4.6"/>' +
    '<path d="M1.8 6.8 4 4 6.2 6.8"/>' +
    '</svg></div>'
  )
}

export type RouteArrowLayer = { set(lines: [number, number][][]): void; remove(): void }

/**
 * 方向标识图层：缩放结束后按新的像素比例重算，
 * 所以拉近拉远、换不同长度的路书，屏幕上的间距都差不多。
 */
export function createArrowLayer(map: AmapMap, api: AmapApi): RouteArrowLayer {
  let lines: [number, number][][] = []
  let markers: AmapOverlay[] = []
  let frame = 0

  const clear = () => {
    removeOverlays(map, markers)
    markers = []
  }

  const render = () => {
    clear()
    for (const line of lines) {
      for (const arrow of routeArrows(map, api, line)) {
        markers.push(
          new api.Marker({
            position: [arrow.lng, arrow.lat],
            content: arrowHtml(arrow.angle),
            offset: new api.Pixel(-4, -4),
            zIndex: 120,
            clickable: false,
          }),
        )
      }
    }
    if (markers.length) map.add(markers)
  }

  const onZoomEnd = () => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      render()
    })
  }
  map.on('zoomend', onZoomEnd)

  return {
    set(next) {
      lines = next
      render()
    },
    remove() {
      try {
        map.off('zoomend', onZoomEnd)
      } catch {
        /* 地图已销毁 */
      }
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      clear()
    },
  }
}
