'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Header from '@/components/Header'
import EventFeed from '@/components/EventFeed'
import StatsPanel from '@/components/StatsPanel'
import EventDetail from '@/components/EventDetail'
import FilterBar from '@/components/FilterBar'
import ClusterList from '@/components/ClusterList'
import { WorldEvent, EventType, Severity } from '@/lib/types'
import { dedup } from '@/lib/dedup'

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
      <p className="text-cyan-500 text-xs tracking-widest animate-pulse font-mono">
        GLOBE INITIALIZING...
      </p>
    </div>
  ),
})

const REFRESH_INTERVAL = 60_000

type MobileTab = 'globe' | 'stats' | 'feed'

const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'stats', label: '통계', icon: '≡' },
  { id: 'globe', label: '지구본', icon: '◉' },
  { id: 'feed', label: '피드', icon: '☰' },
]

export default function Home() {
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [sources, setSources] = useState<Record<string, number>>({})
  const [selectedEvent, setSelectedEvent] = useState<WorldEvent | null>(null)
  const [clusterEvents, setClusterEvents] = useState<WorldEvent[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [mobileTab, setMobileTab] = useState<MobileTab>('globe')
  const [filterTypes, setFilterTypes] = useState<Set<EventType>>(new Set())
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all')

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events')
      if (!res.ok) return
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const merged: WorldEvent[] = []
      const srcCount: Record<string, number> = {}

      setIsLoading(false)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const chunk = JSON.parse(line) as { events: WorldEvent[]; source: string }
            for (const e of chunk.events) {
              merged.push(e)
              srcCount[e.source] = (srcCount[e.source] ?? 0) + 1
            }
          } catch { /* 불완전한 청크 무시 */ }
        }
        const sorted = [...merged].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        setEvents(sorted)
        setSources({ ...srcCount })
      }
      // 스트리밍 완료 후 dedup 적용
      setEvents(prev => dedup(prev))
      setLastUpdate(new Date())
    } catch {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEvents()
    const id = setInterval(fetchEvents, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchEvents])

  const criticalCount = events.filter(e => e.severity === 'critical').length

  const handleTypeToggle = useCallback((t: EventType) => {
    setFilterTypes(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }, [])

  const filteredEvents = useMemo(() =>
    events.filter(e =>
      (filterTypes.size === 0 || filterTypes.has(e.type)) &&
      (filterSeverity === 'all' || e.severity === filterSeverity)
    ), [events, filterTypes, filterSeverity])

  const handleEventClick = (event: WorldEvent) => {
    setSelectedEvent(event)
    setMobileTab('globe')
  }

  const handleClusterClick = (evts: WorldEvent[]) => {
    setClusterEvents(evts)
  }

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

      {/* ── Desktop layout (md+) ── */}
      <div className="hidden md:flex flex-1 min-h-0">
        {/* Left — Stats */}
        <aside className="w-60 flex-shrink-0 border-r border-cyan-900/30 overflow-y-auto bg-black/40">
          <StatsPanel events={events} sources={sources} />
        </aside>

        {/* Center — 3D Globe */}
        <div className="flex-1 min-w-0 relative flex flex-col">
          <FilterBar
            activeTypes={filterTypes}
            activeSeverity={filterSeverity}
            onTypeToggle={handleTypeToggle}
            onSeverityChange={setFilterSeverity}
          />
          <div className="flex-1 min-h-0 relative">
            <Globe3D events={filteredEvents} onEventClick={setSelectedEvent} onClusterClick={handleClusterClick} />

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

            {/* Bottom hint */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="flex items-center gap-4 text-[10px] font-mono text-gray-700 bg-black/60 px-4 py-1.5 rounded border border-gray-900">
                <span>드래그: 회전</span>
                <span>스크롤: 확대/축소</span>
                <span>점 클릭: 상세보기</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right — Event Feed */}
        <aside className="w-64 flex-shrink-0 border-l border-cyan-900/30 overflow-y-auto bg-black/40">
          <EventFeed events={filteredEvents} onEventClick={setSelectedEvent} />
        </aside>
      </div>

      {/* ── Mobile layout (< md) ── */}
      <div className="flex md:hidden flex-1 min-h-0 relative">
        {/* Globe — always mounted, visibility controlled by CSS */}
        <div
          className="absolute inset-0"
          style={{
            opacity: mobileTab === 'globe' ? 1 : 0,
            pointerEvents: mobileTab === 'globe' ? 'auto' : 'none',
          }}
        >
          <Globe3D events={filteredEvents} onEventClick={setSelectedEvent} onClusterClick={handleClusterClick} />
          {mobileTab === 'globe' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="text-[10px] font-mono text-gray-700 bg-black/60 px-3 py-1 rounded border border-gray-900 whitespace-nowrap">
                드래그: 회전 · 핀치: 확대 · 탭: 상세보기
              </div>
            </div>
          )}
        </div>

        {/* Stats panel */}
        {mobileTab === 'stats' && (
          <div className="absolute inset-0 overflow-y-auto bg-black/40">
            <StatsPanel events={events} sources={sources} />
          </div>
        )}

        {/* Event feed */}
        {mobileTab === 'feed' && (
          <div className="absolute inset-0 overflow-y-auto bg-black/40">
            <FilterBar
              activeTypes={filterTypes}
              activeSeverity={filterSeverity}
              onTypeToggle={handleTypeToggle}
              onSeverityChange={setFilterSeverity}
            />
            <EventFeed events={filteredEvents} onEventClick={handleEventClick} />
          </div>
        )}

        {/* Bottom tab bar */}
        <nav className="absolute bottom-0 left-0 right-0 flex border-t border-cyan-900/40 bg-black/90 backdrop-blur-sm z-20">
          {MOBILE_TABS.map(tab => {
            const isActive = mobileTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setMobileTab(tab.id)}
                className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors relative ${
                  isActive
                    ? 'text-cyan-400'
                    : 'text-gray-600 active:text-gray-400'
                }`}
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-px bg-cyan-400" />
                )}
                <span className="text-base leading-none">{tab.icon}</span>
                <span className="text-[10px] font-mono tracking-wide">{tab.label}</span>
                {tab.id === 'feed' && criticalCount > 0 && (
                  <span className="absolute top-1.5 right-[calc(50%-16px)] bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 leading-none">
                    {criticalCount > 99 ? '99+' : criticalCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Cluster list modal */}
      {clusterEvents && (
        <ClusterList
          events={clusterEvents}
          onSelect={e => { setSelectedEvent(e); setClusterEvents(null) }}
          onClose={() => setClusterEvents(null)}
        />
      )}

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
