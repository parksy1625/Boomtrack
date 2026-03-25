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

const SEVERITY_ALT: Record<Severity, number> = {
  low: 0.003, medium: 0.008, high: 0.018, critical: 0.045,
}
const SEVERITY_R: Record<Severity, number> = {
  low: 0.3, medium: 0.5, high: 0.8, critical: 1.3,
}

interface GlobePt {
  lat: number; lng: number; color: string
  altitude: number; radius: number; event: WorldEvent
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
  const globeRef = useRef<any>(null)
  const onClickRef = useRef(onEventClick)
  useEffect(() => { onClickRef.current = onEventClick }, [onEventClick])

  const toPoints = useCallback((evts: WorldEvent[]): GlobePt[] =>
    evts.map(e => ({
      lat: e.lat, lng: e.lng,
      color: TYPE_COLORS[e.type] ?? 'rgba(255,255,255,0.8)',
      altitude: SEVERITY_ALT[e.severity],
      radius: SEVERITY_R[e.severity],
      event: e,
    })), [])

  const toRings = useCallback((evts: WorldEvent[]): GlobeRing[] =>
    evts.filter(e => e.severity === 'critical' || e.severity === 'high').map(e => ({
      lat: e.lat, lng: e.lng,
      color: e.severity === 'critical'
        ? (t: number) => `rgba(255,0,0,${1 - t})`
        : (t: number) => `rgba(255,120,0,${1 - t})`,
      maxR: e.severity === 'critical' ? 5 : 3,
      propagationSpeed: e.severity === 'critical' ? 2 : 1.5,
      repeatPeriod: e.severity === 'critical' ? 800 : 1300,
    })), [])

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
        .onPointClick((pt: GlobePt) => { if (pt?.event) onClickRef.current?.(pt.event) })
        .onPointHover((pt: GlobePt | null) => { container.style.cursor = pt ? 'pointer' : 'default' })
        .ringsData([]).ringLat('lat').ringLng('lng').ringColor('color')
        .ringMaxRadius('maxR').ringPropagationSpeed('propagationSpeed').ringRepeatPeriod('repeatPeriod')
      globe.controls().autoRotate = true
      globe.controls().autoRotateSpeed = 0.35
      globe.controls().enableDamping = true
      globe.pointOfView({ altitude: 2.2 }, 0)
      globeRef.current = globe
      const obs = new ResizeObserver(() => {
        globe.width(container.clientWidth)
        globe.height(container.clientHeight)
      })
      obs.observe(container)
      return () => obs.disconnect()
    })
  }, [])

  useEffect(() => {
    if (!globeRef.current) return
    globeRef.current.pointsData(toPoints(events))
    globeRef.current.ringsData(toRings(events))
  }, [events, toPoints, toRings])

  return (
    <div ref={containerRef} className="w-full h-full"
      style={{ background: 'radial-gradient(ellipse at center,#000820 0%,#000010 100%)' }} />
  )
}
