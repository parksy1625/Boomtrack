'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Header from '@/components/Header'
import EventFeed from '@/components/EventFeed'
import StatsPanel from '@/components/StatsPanel'
import EventDetail from '@/components/EventDetail'
import { WorldEvent, EventsResponse } from '@/lib/types'

const Globe3D = dynamic(() => import('@/components/Globe3D'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-2 border-cyan-500/40 animate-ping [animation-delay:0.3s]" />
        <div className="absolute inset-4 rounded-full border-2 border-cyan-500/60 animate-ping [animation-delay:0.6s]" />
        <div className="absolute inset-6 rounded-full bg-cyan-400/20 animate-pulse" />
      </div>
      <p className="text-cyan-500 text-xs tracking-widest animate-pulse">
        GLOBE INITIALIZING...
      </p>
    </div>
  ),
})

const REFRESH_INTERVAL = 30000

export default function Home() {
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<WorldEvent | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(new Date())

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events')
      if (!res.ok) return
      const data: EventsResponse = await res.json()
      setEvents(data.events)
      setLastUpdate(new Date())
    } catch {
      // network error — keep last state
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEvents()
    const id = setInterval(fetchEvents, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchEvents])

  const criticalCount = events.filter(e => e.severity === 'critical').length

  return (
    <main className="flex flex-col h-screen bg-[#00000f] overflow-hidden relative">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden opacity-[0.03]">
        <div className="scanline w-full h-px bg-cyan-300" />
      </div>

      <Header
        eventCount={events.length}
        lastUpdate={lastUpdate}
        isLoading={isLoading}
        criticalCount={criticalCount}
      />

      <div className="flex flex-1 min-h-0">
        {/* Left — Stats */}
        <aside className="w-60 flex-shrink-0 border-r border-cyan-900/30 overflow-y-auto bg-black/40">
          <StatsPanel events={events} />
        </aside>

        {/* Center — 3D Globe */}
        <div className="flex-1 min-w-0 relative">
          <Globe3D events={events} onEventClick={setSelectedEvent} />

          {/* Corner decorations */}
          <div className="absolute top-3 left-3 pointer-events-none">
            <div className="w-5 h-5 border-t-2 border-l-2 border-cyan-500/50" />
          </div>
          <div className="absolute top-3 right-3 pointer-events-none">
            <div className="w-5 h-5 border-t-2 border-r-2 border-cyan-500/50" />
          </div>
          <div className="absolute bottom-3 left-3 pointer-events-none">
            <div className="w-5 h-5 border-b-2 border-l-2 border-cyan-500/50" />
          </div>
          <div className="absolute bottom-3 right-3 pointer-events-none">
            <div className="w-5 h-5 border-b-2 border-r-2 border-cyan-500/50" />
          </div>

          {/* Bottom info bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="flex items-center gap-4 text-[10px] font-mono text-gray-700 bg-black/60 px-4 py-1.5 rounded border border-gray-900">
              <span>드래그: 회전</span>
              <span>스크롤: 확대/축소</span>
              <span>클릭: 이벤트 상세</span>
            </div>
          </div>
        </div>

        {/* Right — Event Feed */}
        <aside className="w-64 flex-shrink-0 border-l border-cyan-900/30 overflow-y-auto bg-black/40">
          <EventFeed events={events} onEventClick={setSelectedEvent} />
        </aside>
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </main>
  )
}
