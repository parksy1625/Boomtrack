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
const SEVERITY_BORDER: Record<Severity, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#34d399',
}
const SEVERITY_BG: Record<Severity, string> = {
  critical: 'rgba(239,68,68,0.25)',
  high:     'rgba(249,115,22,0.20)',
  medium:   'rgba(234,179,8,0.15)',
  low:      'rgba(52,211,153,0.10)',
}

const CLUSTER_DEG = 4 // ~440km grid

interface Cluster {
  lat: number; lng: number; count: number
  severity: Severity; color: string
  events: WorldEvent[]
}

function buildClusters(events: WorldEvent[]): Cluster[] {
  const cells = new Map<string, WorldEvent[]>()
  for (const e of events) {
    const key = `${Math.round(e.lat / CLUSTER_DEG)},${Math.round(e.lng / CLUSTER_DEG)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(e)
  }
  return [...cells.values()].map(group => {
    const lat = group.reduce((s, e) => s + e.lat, 0) / group.length
    const lng = group.reduce((s, e) => s + e.lng, 0) / group.length
    const top = group.reduce((b, e) => SEVERITY_RANK[e.severity] > SEVERITY_RANK[b.severity] ? e : b)
    return {
      lat, lng, count: group.length,
      severity: top.severity,
      color: TYPE_COLORS[top.type] ?? 'rgba(255,255,255,0.8)',
      events: group,
    }
  })
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

  const makeHtmlEl = useCallback((d: Cluster): HTMLElement => {
    const size = Math.max(22, Math.min(60, 18 + Math.log2(d.count + 1) * 8))
    const fontSize = size < 30 ? 9 : size < 44 ? 11 : 13
    const el = document.createElement('div')
    el.style.cssText = [
      `width:${size}px`, `height:${size}px`,
      'border-radius:50%',
      `background:${SEVERITY_BG[d.severity]}`,
      `border:2px solid ${SEVERITY_BORDER[d.severity]}`,
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer',
      `font-size:${fontSize}px`,
      'font-family:monospace', 'font-weight:700',
      'color:#fff',
      'box-shadow:0 0 8px rgba(0,0,0,0.6)',
      'transition:transform 0.15s',
      'pointer-events:auto',
      'user-select:none',
    ].join(';')
    el.textContent = d.count > 1 ? String(d.count) : ''
    el.title = d.count > 1
      ? `${d.count}개 이벤트 (최고: ${d.severity})`
      : d.events[0]?.title ?? ''
    el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.25)' })
    el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })
    el.addEventListener('click', () => {
      const top = d.events.reduce((b, e) =>
        SEVERITY_RANK[e.severity] > SEVERITY_RANK[b.severity] ? e : b
      )
      onClickRef.current?.(top)
    })
    return el
  }, [])

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
        .htmlElementsData([])
        .htmlLat('lat').htmlLng('lng')
        .htmlAltitude(0.005)
        .htmlElement((d: Cluster) => makeHtmlEl(d))
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
  }, [makeHtmlEl])

  useEffect(() => {
    if (!globeRef.current) return
    const clusters = buildClusters(events)
    globeRef.current.htmlElementsData(clusters)
    globeRef.current.ringsData(toRings(events))
  }, [events, toRings])

  return (
    <div ref={containerRef} className="w-full h-full"
      style={{ background: 'radial-gradient(ellipse at center,#000820 0%,#000010 100%)' }} />
  )
}
