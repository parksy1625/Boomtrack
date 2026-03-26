'use client'

import { useEffect, useRef, useCallback } from 'react'
import { WorldEvent, EventType, Severity } from '@/lib/types'

export const TYPE_COLORS: Record<EventType, string> = {
  earthquake:  'rgba(255, 60,  60,  0.95)',
  weather:     'rgba(40,  210, 255, 0.95)',
  conflict:    'rgba(255, 110, 0,   0.95)',
  political:   'rgba(80,  120, 255, 0.95)',
  economic:    'rgba(160, 60,  255, 0.95)',
  health:      'rgba(255, 60,  200, 0.95)',
  disaster:    'rgba(255, 200, 0,   0.95)',
  space:       'rgba(200, 180, 255, 0.95)',
  terrorism:   'rgba(255, 30,  30,  0.95)',
  nuclear:     'rgba(0,   255, 100, 0.95)',
  migration:   'rgba(255, 200, 80,  0.95)',
  environment: 'rgba(80,  200, 80,  0.95)',
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }
const SEVERITY_ALT: Record<Severity, number> = {
  low: 0.003, medium: 0.008, high: 0.018, critical: 0.045,
}
const SEVERITY_R: Record<Severity, number> = {
  low: 0.3, medium: 0.5, high: 0.8, critical: 1.3,
}

/** Grid size (degrees) and radius scale based on camera altitude */
function getZoomParams(altitude: number): { gridDeg: number; rScale: number } {
  if (altitude > 2.5) return { gridDeg: 10,  rScale: 1.00 }
  if (altitude > 2.0) return { gridDeg: 7,   rScale: 0.90 }
  if (altitude > 1.6) return { gridDeg: 5,   rScale: 0.78 }
  if (altitude > 1.2) return { gridDeg: 3.5, rScale: 0.65 }
  if (altitude > 0.9) return { gridDeg: 2.5, rScale: 0.55 }
  if (altitude > 0.6) return { gridDeg: 1.5, rScale: 0.45 }
  if (altitude > 0.4) return { gridDeg: 1.0, rScale: 0.36 }
  if (altitude > 0.25)return { gridDeg: 0.5, rScale: 0.27 }
  if (altitude > 0.15)return { gridDeg: 0.2, rScale: 0.20 }
  return                     { gridDeg: 0.1, rScale: 0.14 }
}

interface Cluster {
  lat: number; lng: number; count: number
  severity: Severity; type: EventType
  events: WorldEvent[]
}

function buildClusters(events: WorldEvent[], gridDeg: number): Cluster[] {
  const cells = new Map<string, WorldEvent[]>()
  for (const e of events) {
    const key = `${Math.round(e.lat / gridDeg)},${Math.round(e.lng / gridDeg)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(e)
  }
  return [...cells.values()].map(group => {
    const lat = group.reduce((s, e) => s + e.lat, 0) / group.length
    const lng = group.reduce((s, e) => s + e.lng, 0) / group.length
    const top = group.reduce((b, e) => SEVERITY_RANK[e.severity] > SEVERITY_RANK[b.severity] ? e : b)
    return { lat, lng, count: group.length, severity: top.severity, type: top.type, events: group }
  })
}

interface GlobePt {
  lat: number; lng: number; color: string
  altitude: number; radius: number; cluster: Cluster
}
interface GlobeRing {
  lat: number; lng: number
  color: (t: number) => string
  maxR: number; propagationSpeed: number; repeatPeriod: number
}

interface Props {
  events: WorldEvent[]
  onEventClick?: (e: WorldEvent) => void
}

export default function Globe3D({ events, onEventClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef    = useRef<any>(null)
  const eventsRef   = useRef<WorldEvent[]>(events)
  const onClickRef  = useRef(onEventClick)

  useEffect(() => { onClickRef.current = onEventClick }, [onEventClick])
  useEffect(() => { eventsRef.current = events },         [events])

  const toPoints = useCallback((clusters: Cluster[], rScale: number): GlobePt[] =>
    clusters.map(c => {
      const baseAlt = SEVERITY_ALT[c.severity]
      const baseR   = SEVERITY_R[c.severity]
      const cScale  = c.count === 1 ? 1 : Math.min(5, 1 + Math.log2(c.count) * 0.9)
      return {
        lat: c.lat, lng: c.lng,
        color:    TYPE_COLORS[c.type] ?? 'rgba(255,255,255,0.8)',
        altitude: Math.min(baseAlt * cScale, 0.35),
        radius:   Math.min(baseR * cScale * rScale, 4.0),
        cluster: c,
      }
    }), [])

  const toRings = useCallback((evts: WorldEvent[]): GlobeRing[] =>
    evts.filter(e => e.severity === 'critical' || e.severity === 'high').map(e => ({
      lat: e.lat, lng: e.lng,
      color: e.severity === 'critical'
        ? (t: number) => `rgba(255,0,0,${1 - t})`
        : (t: number) => `rgba(255,120,0,${1 - t})`,
      maxR: e.severity === 'critical' ? 5 : 3,
      propagationSpeed: e.severity === 'critical' ? 2 : 1.5,
      repeatPeriod:     e.severity === 'critical' ? 800 : 1300,
    })), [])

  // Re-cluster whenever altitude or events change
  const recluster = useCallback((globe: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globe as any
    const { altitude } = g.pointOfView()
    const { gridDeg, rScale } = getZoomParams(altitude)
    const clusters = buildClusters(eventsRef.current, gridDeg)
    g.pointsData(toPoints(clusters, rScale))
  }, [toPoints])

  useEffect(() => {
    const container = containerRef.current
    if (!container || globeRef.current) return
    import('globe.gl').then(mod => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Globe = (mod as any).default ?? mod
      const globe = Globe({ animateIn: true })(container)
      globe
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
        .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
        .atmosphereColor('#00aadd')
        .atmosphereAltitude(0.13)
        .pointsData([]).pointLat('lat').pointLng('lng')
        .pointColor('color').pointAltitude('altitude').pointRadius('radius')
        .pointsMerge(false)
        .onPointClick((pt: GlobePt) => {
          if (!pt?.cluster) return
          const top = pt.cluster.events.reduce((b, e) =>
            SEVERITY_RANK[e.severity] > SEVERITY_RANK[b.severity] ? e : b
          )
          onClickRef.current?.(top)
        })
        .onPointHover((pt: GlobePt | null) => {
          container.style.cursor = pt ? 'pointer' : 'default'
        })
        .ringsData([]).ringLat('lat').ringLng('lng').ringColor('color')
        .ringMaxRadius('maxR').ringPropagationSpeed('propagationSpeed').ringRepeatPeriod('repeatPeriod')

      globe.controls().autoRotate = true
      globe.controls().autoRotateSpeed = 0.35
      globe.controls().enableDamping = true
      globe.pointOfView({ altitude: 2.2 }, 0)
      globeRef.current = globe

      // Re-cluster on zoom
      let debounce: ReturnType<typeof setTimeout>
      globe.controls().addEventListener('change', () => {
        clearTimeout(debounce)
        debounce = setTimeout(() => recluster(globe), 30)
      })

      const obs = new ResizeObserver(() => {
        globe.width(container.clientWidth)
        globe.height(container.clientHeight)
      })
      obs.observe(container)
      return () => { obs.disconnect(); clearTimeout(debounce) }
    })
  }, [recluster])

  useEffect(() => {
    if (!globeRef.current) return
    recluster(globeRef.current)
    globeRef.current.ringsData(toRings(events))
  }, [events, recluster, toRings])

  return (
    <div ref={containerRef} className="w-full h-full"
      style={{ background: 'radial-gradient(ellipse at center,#000820 0%,#000010 100%)' }} />
  )
}
