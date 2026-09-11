import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { dayInk, toGcj } from '../lib/geo'
import { fetchRoadLine } from '../lib/route'
import { useJourney, useLushu, useSelectedId } from '../store'
import { SearchBox } from './SearchBox'

function markerHtml(label: string, color: string, active: boolean): string {
  return `<div class="pin${active ? ' on' : ''}" style="--ink:${color}"><span>${label}</span></div>`
}

export function MapCanvas() {
  const journey = useJourney()
  const selectedId = useSelectedId()
  const selectPlace = useLushu((s) => s.selectPlace)
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const roadsRef = useRef<L.LayerGroup | null>(null)
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

    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: '1234', maxZoom: 18 },
    ).addTo(map)

    L.control.zoom({ position: 'topright' }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
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
      layerRef.current = null
      roadsRef.current = null
      setMapReady(false)
    }
  }, [selectPlace])

  useEffect(() => {
    const map = mapRef.current
    const group = layerRef.current
    if (!map || !group) return
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
        place.id === journey.start?.id ? '起' : place.id === journey.end?.id && !isLoop ? '终' : String(i + 1)
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: markerHtml(label, color, selectedId === place.id),
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      L.marker([lat, lng], { icon })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          selectPlace(place.id)
        })
        .addTo(group)
    })
  }, [journey, selectedId, selectPlace])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const current = journeyRef.current
    const shown = current.ready ? current.ordered : current.places
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
    void Promise.all(days.map((day) => fetchRoadLine(day.places))).then((lines) => {
      if (cancelled || !roadsRef.current) return
      roadsRef.current.clearLayers()
      lines.forEach((line, i) => {
        const day = days[i]
        const latlngs =
          line?.map(([lng, lat]) => [lat, lng] as [number, number]) ??
          day.places.map((p) => {
            const [lng, lat] = toGcj(p)
            return [lat, lng] as [number, number]
          })
        if (latlngs.length < 2) return
        L.polyline(latlngs, {
          color: dayInk(i),
          weight: 5.5,
          opacity: 1,
          lineJoin: 'round',
        }).addTo(roadsRef.current!)
      })
    })
    return () => {
      cancelled = true
    }
  }, [routeKey, mapReady])

  return (
    <div className="map-stage">
      <div ref={hostRef} className="map" />
      <div className="map-search">
        <SearchBox />
      </div>
    </div>
  )
}
