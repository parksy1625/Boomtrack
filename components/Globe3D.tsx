'use client'

import { useEffect, useRef, useCallback } from 'react'
import { WorldEvent, EventType, Severity } from '@/lib/types'

const TYPE_COLORS: Record<EventType, string> = {
  earthquake: 'rgba(255, 60, 60, 0.95)',
  weather: 'rgba(40, 210, 255, 0.95)',
  conflict: 'rgba(255, 110, 0, 0.95)',
  political: 'rgba(80, 120, 255, 0.95)',
  economic: 'rgba(160, 60, 255, 0.95)',
  health: 'rgba(255, 60, 200, 0.95)',
  disaster: 'rgba(255, 200, 0, 0.95)',
}

const RING_COLORS: Record<string, string> = {
  critical: 'rgba(255, 0, 0, #alpha#)',
  high: 'rgba(255, 100, 0, #alpha#)',
}

const SEVERITY_ALTITUDE: Record<Severity, number> = {
  low: 0.003,
  medium: 0.008,
  high: 0.018,
  critical: 0.04,
}

const SEVERITY_RADIUS: Record<Severity, number> = {
  low: 0.35,
  medium: 0.55,
  high: 0.8,
  critical: 1.2,
}

interface GlobePoint {
  lat: number
  lng: number
  color: string
  altitude: number
  radius: number
  event: WorldEvent
}

interface GlobeRing {
  lat: number
  lng: number
  color: (t: number) => string
  maxR: number
  propagationSpeed: number
  repeatPeriod: number
}

interface Props {
  events: WorldEvent[]
  onEventClick?: (event: WorldEvent) => void
}

export default function Globe3D({ events, onEventClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null)
  const onClickRef = useRef(onEventClick)

  useEffect(() => {
    onClickRef.current = onEventClick
  }, [onEventClick])

  const toPoints = useCallback((evts: WorldEvent[]): GlobePoint[] =>
    evts.map(e => ({
      lat: e.lat,
      lng: e.lng,
      color: TYPE_COLORS[e.type] ?? 'rgba(255,255,255,0.8)',
      altitude: SEVERITY_ALTITUDE[e.severity],
      radius: SEVERITY_RADIUS[e.severity],
      event: e,
    })), [])

  const toRings = useCallback((evts: WorldEvent[]): GlobeRing[] =>
    evts
      .filter(e => e.severity === 'critical' || e.severity === 'high')
      .map(e => ({
        lat: e.lat,
        lng: e.lng,
        color:
          e.severity === 'critical'
            ? (t: number) => `rgba(255,0,0,${1 - t})`
            : (t: number) => `rgba(255,120,0,${1 - t})`,
        maxR: e.severity === 'critical' ? 5 : 3,
        propagationSpeed: e.severity === 'critical' ? 2 : 1.5,
        repeatPeriod: e.severity === 'critical' ? 800 : 1200,
      })), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || globeRef.current) return

    import('globe.gl').then(mod => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Globe = (mod as any).default ?? mod
      const globe = Globe({ animateIn: true })(container)

      globe
        .globeImageUrl(
          'https://unpkg.com/three-globe/example/img/earth-night.jpg'
        )
        .backgroundImageUrl(
          'https://unpkg.com/three-globe/example/img/night-sky.png'
        )
        .atmosphereColor('#00aadd')
        .atmosphereAltitude(0.13)
        // Points
        .pointsData([])
        .pointLat('lat')
        .pointLng('lng')
        .pointColor('color')
        .pointAltitude('altitude')
        .pointRadius('radius')
        .pointsMerge(false)
        .onPointClick((point: GlobePoint) => {
          if (onClickRef.current && point?.event) {
            onClickRef.current(point.event)
          }
        })
        .onPointHover((point: GlobePoint | null) => {
          container.style.cursor = point ? 'pointer' : 'default'
        })
        // Rings for high/critical
        .ringsData([])
        .ringLat('lat')
        .ringLng('lng')
        .ringColor('color')
        .ringMaxRadius('maxR')
        .ringPropagationSpeed('propagationSpeed')
        .ringRepeatPeriod('repeatPeriod')

      globe.controls().autoRotate = true
      globe.controls().autoRotateSpeed = 0.35
      globe.controls().enableDamping = true
      globe.pointOfView({ altitude: 2.2 }, 0)

      globeRef.current = globe

      const observer = new ResizeObserver(() => {
        globe.width(container.clientWidth)
        globe.height(container.clientHeight)
      })
      observer.observe(container)

      return () => observer.disconnect()
    })
  }, [])

  useEffect(() => {
    if (!globeRef.current) return
    globeRef.current.pointsData(toPoints(events))
    globeRef.current.ringsData(toRings(events))
  }, [events, toPoints, toRings])

  // Suppress unused variable warning for RING_COLORS
  void RING_COLORS

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: 'radial-gradient(ellipse at center, #000820 0%, #000010 100%)' }}
    />
  )
}
