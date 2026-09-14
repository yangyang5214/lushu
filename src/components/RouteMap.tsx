import { useCallback, useEffect, useRef } from 'react'
import {
  createArrowLayer,
  dayPolyline,
  fitPlaces,
  markerHtml,
  placeMarker,
  removeOverlays,
  useAmapMap,
  type AmapOverlay,
  type RouteArrowLayer,
} from '../lib/amap'
import { dayInk, toGcj } from '../lib/geo'
import { useI18n } from '../lib/i18n'
import { fetchRoadLine } from '../lib/route'
import type { Journey } from '../types'

/** 视野自适应：别放到最大级别。 */
const FIT_MAX_ZOOM = 10

/**
 * 只读路线地图（后台路书详情用）：与编辑页共用同一套高德底图、按天着色和路网线，
 * 但不接全局 store，也没有选点 / 搜索等交互。
 */
export function RouteMap({ journey }: { journey: Journey }) {
  const { lang, t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const { api, map, failed } = useAmapMap(hostRef, lang)
  const markersRef = useRef<AmapOverlay[]>([])
  const arrowsRef = useRef<RouteArrowLayer | null>(null)
  const journeyRef = useRef(journey)
  journeyRef.current = journey
  const routeKey = `${journey.ordered.map((p) => p.id).join(',')}|${journey.isLoop}|${journey.splitIds.join(',')}`

  const fitRoute = useCallback(() => {
    if (!map) return
    map.resize()
    fitPlaces(map, markersRef.current, FIT_MAX_ZOOM)
  }, [map])

  useEffect(() => {
    if (!api || !map) return
    const { ordered, days, isLoop, ready, places } = journey
    const shown = ready ? ordered : places

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
      const html = markerHtml(label, dayIndex >= 0 ? dayInk(dayIndex) : '#1b1712')
      return placeMarker(api, lng, lat, html)
    })
    markersRef.current = markers
    if (markers.length) map.add(markers)

    return () => {
      removeOverlays(map, markers)
      markersRef.current = []
    }
  }, [api, map, journey, t])

  useEffect(() => {
    if (!map) return
    // 等一帧：底图刚建好时容器尺寸还在收敛，立刻 setFitView 会被忽略。
    const frame = window.requestAnimationFrame(() => fitRoute())
    return () => window.cancelAnimationFrame(frame)
  }, [routeKey, map, fitRoute])

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

    // 与编辑页一致：路网回来再画。
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
    <div className="route-map-stage">
      <div ref={hostRef} className="route-map" />
      {failed ? <p className="map-hint">{t('map.unavailable')}</p> : null}
    </div>
  )
}
