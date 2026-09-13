import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { dayInk, toGcj } from '../lib/geo'
import { getLang, useI18n } from '../lib/i18n'
import { markerHtml, TILE_SUBDOMAINS, tileUrl } from '../lib/map'
import { fetchRoadLine } from '../lib/route'
import type { Journey } from '../types'

/**
 * 只读路线地图（后台路书详情用）：与编辑页共用同一套底图、按天着色和路网线，
 * 但不接全局 store，也没有选点 / 搜索等交互。
 */
export function RouteMap({ journey }: { journey: Journey }) {
  const { lang, t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const pinsRef = useRef<L.LayerGroup | null>(null)
  const roadsRef = useRef<L.LayerGroup | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const journeyRef = useRef(journey)
  journeyRef.current = journey
  const routeKey = `${journey.ordered.map((p) => p.id).join(',')}|${journey.isLoop}|${journey.splitIds.join(',')}`

  useEffect(() => {
    const el = hostRef.current
    if (!el || mapRef.current) return
    const map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 4,
      maxZoom: 17,
    }).setView([30.6, 119.3], 6)

    tileRef.current = L.tileLayer(tileUrl(getLang()), {
      subdomains: TILE_SUBDOMAINS,
      maxZoom: 18,
    }).addTo(map)

    L.control.zoom({ position: 'topright' }).addTo(map)
    pinsRef.current = L.layerGroup().addTo(map)
    roadsRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    setMapReady(true)

    const ro = new ResizeObserver(() => {
      map.invalidateSize()
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      pinsRef.current = null
      roadsRef.current = null
      tileRef.current = null
      setMapReady(false)
    }
  }, [])

  // 底图语言跟随界面语言。
  useEffect(() => {
    tileRef.current?.setUrl(tileUrl(lang))
  }, [lang])

  useEffect(() => {
    const group = pinsRef.current
    if (!group) return
    group.clearLayers()

    const { ordered, days, isLoop, ready, places } = journey
    const shown = ready ? ordered : places

    shown.forEach((place, i) => {
      const dayIndex = days.findIndex((d, di) =>
        d.places.some((p, pi) => p.id === place.id && !(di > 0 && pi === 0)),
      )
      const color = dayIndex >= 0 ? dayInk(dayIndex) : '#1b1712'
      const [lng, lat] = toGcj(place)
      const label =
        place.id === journey.start?.id
          ? t('sidebar.startBadge')
          : place.id === journey.end?.id && !isLoop
            ? t('sidebar.endBadge')
            : String(i + 1)
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: markerHtml(label, color),
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      L.marker([lat, lng], { icon, interactive: false }).addTo(group)
    })
  }, [journey, t])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const shown = journeyRef.current.ready ? journeyRef.current.ordered : journeyRef.current.places
    if (shown.length === 0) return
    const b = L.latLngBounds(
      shown.map((p) => {
        const [lng, lat] = toGcj(p)
        return [lat, lng] as [number, number]
      }),
    )
    map.fitBounds(b.pad(0.18), { animate: true, maxZoom: 10 })
  }, [routeKey, mapReady])

  useEffect(() => {
    const roads = roadsRef.current
    if (!roads) return
    roads.clearLayers()
    const current = journeyRef.current
    if (!current.ready) return
    const { days } = current
    let cancelled = false
    const drawn: Array<L.Polyline | null> = days.map(() => null)

    // 与编辑页一致：路网回来再画。
    const draw = (i: number, latlngs: [number, number][]) => {
      const host = roadsRef.current
      if (cancelled || !host || latlngs.length < 2) return
      drawn[i]?.remove()
      drawn[i] = L.polyline(latlngs, {
        color: dayInk(i),
        weight: 5.5,
        opacity: 1,
        lineJoin: 'round',
      }).addTo(host)
    }

    days.forEach((day, i) => {
      void fetchRoadLine(day.places).then((line) => {
        if (cancelled || !line) return
        draw(
          i,
          line.map(([lng, lat]) => [lat, lng] as [number, number]),
        )
      })
    })

    return () => {
      cancelled = true
    }
  }, [routeKey, mapReady])

  return <div ref={hostRef} className="route-map" />
}
