import { useCallback, useEffect, useRef, useState } from 'react'
import { dayInk, toGcj } from '../lib/geo'
import {
  createArrowLayer,
  dayPolyline,
  fitPlaces,
  markerHtml,
  placeMarker,
  removeOverlays,
  useAmapMap,
  type AmapLngLat,
  type AmapOverlay,
  type RouteArrowLayer,
} from '../lib/amap'
import { useI18n } from '../lib/i18n'
import type { PoiQuery } from '../lib/poi'
import { fetchRoadLine } from '../lib/route'
import { useJourney, useLushu, useReadonly, useSelectedId } from '../store'
import { PoiPanel } from './PoiPanel'
import { SearchBox } from './SearchBox'

/** 视野自适应：别放到最大级别，四周留白由 fitPlaces 统一给。 */
const FIT_MAX_ZOOM = 10

export function MapCanvas() {
  const { lang, t } = useI18n()
  const journey = useJourney()
  const readonly = useReadonly()
  const selectedId = useSelectedId()
  const selectPlace = useLushu((s) => s.selectPlace)
  const hostRef = useRef<HTMLDivElement>(null)
  const { api, map, failed } = useAmapMap(hostRef, lang)
  // 点中的地图位置：右侧弹出那一点的高德地点卡片（只读分享里也能用）。
  const [poiQuery, setPoiQuery] = useState<PoiQuery | null>(null)
  const markersRef = useRef<AmapOverlay[]>([])
  const arrowsRef = useRef<RouteArrowLayer | null>(null)
  const journeyRef = useRef(journey)
  journeyRef.current = journey
  const routeKey = `${journey.ordered.map((p) => p.id).join(',')}|${journey.isLoop}|${journey.splitIds.join(',')}`

  // 把整条路线重新收进视野：手机上拖动地图后用来「回到全览」。
  const fitRoute = useCallback(() => {
    if (!map) return
    map.resize()
    fitPlaces(map, markersRef.current, FIT_MAX_ZOOM)
  }, [map])

  useEffect(() => {
    if (!api || !map) return
    const { ordered, days, isLoop, ready, places } = journey
    const shown = ready ? ordered : places

    // 标记点：起点 / 终点显示文字徽标，其余显示序号；点一下选中。
    const markers = shown.map((place, i) => {
      const dayIndex = days.findIndex((d, di) =>
        d.places.some((p, pi) => p.id === place.id && !(di > 0 && pi === 0)),
      )
      const [lng, lat] = toGcj(place)
      const label =
        place.id === journey.start?.id
          ? t('sidebar.startBadge')
          : place.id === journey.end?.id && !isLoop
            ? t('sidebar.endBadge')
            : String(i + 1)
      const html = markerHtml(label, dayIndex >= 0 ? dayInk(dayIndex) : '#1b1712', selectedId === place.id)
      return placeMarker(api, lng, lat, html, () => selectPlace(place.id))
    })
    markersRef.current = markers
    if (markers.length) map.add(markers)

    return () => {
      removeOverlays(map, markers)
      markersRef.current = []
    }
  }, [api, map, journey, selectedId, selectPlace, t])

  // 点地图任意一点：把那一处的 GCJ02 坐标（和当时的缩放级别）交给右侧卡片。
  useEffect(() => {
    if (!map) return
    const onClick = (event: unknown) => {
      const lnglat = (event as { lnglat?: AmapLngLat } | null)?.lnglat
      if (!lnglat) return
      setPoiQuery({ lng: lnglat.getLng(), lat: lnglat.getLat(), zoom: map.getZoom() })
    }
    map.on('click', onClick)
    return () => {
      try {
        map.off('click', onClick)
      } catch {
        /* 地图已销毁 */
      }
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    // 等一帧：底图刚建好时容器尺寸还在收敛，立刻 setFitView 会被忽略。
    const frame = window.requestAnimationFrame(() => fitRoute())
    return () => window.cancelAnimationFrame(frame)
  }, [routeKey, map, fitRoute])

  // 方向标识跟线路分开存：缩放后要按新的像素比例重算。
  useEffect(() => {
    if (!api || !map) return
    const layer = createArrowLayer(map, api)
    arrowsRef.current = layer
    return () => {
      layer.remove()
      arrowsRef.current = null
    }
  }, [api, map])

  useEffect(() => {
    if (!api || !map) return
    const current = journeyRef.current
    if (!current.ready) return
    let cancelled = false
    const drawn: AmapOverlay[] = []
    const lines: Array<[number, number][]> = current.days.map(() => [])

    // 路网回来再画；多天会合成一次批量请求。
    const draw = (i: number, path: [number, number][]) => {
      if (cancelled || path.length < 2) return
      const road = dayPolyline(api, path, dayInk(i))
      drawn.push(road)
      map.add(road)
      lines[i] = path
      arrowsRef.current?.set(lines)
    }

    current.days.forEach((day, i) => {
      void fetchRoadLine(day.places).then((line) => {
        if (cancelled || !line) return
        draw(i, line)
      })
    })

    return () => {
      cancelled = true
      arrowsRef.current?.set([])
      removeOverlays(map, drawn)
    }
  }, [api, map, routeKey])

  return (
    <div className="map-stage">
      <div ref={hostRef} className="map" />
      {failed ? <p className="map-hint">{t('map.unavailable')}</p> : null}
      {poiQuery ? (
        <PoiPanel query={poiQuery} onClose={() => setPoiQuery(null)} />
      ) : null}
      <button
        type="button"
        className="map-fit"
        onClick={() => fitRoute()}
        title={t('map.fit')}
        aria-label={t('map.fit')}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
          <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
          <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
          <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
        </svg>
      </button>
      {readonly ? null : (
        <div className="map-search">
          <SearchBox />
        </div>
      )}
    </div>
  )
}
