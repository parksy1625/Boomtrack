'use client'

import { WorldEvent, EventType, Severity } from '@/lib/types'

const TYPE_LABELS: Record<EventType, string> = {
  earthquake: '지진',
  weather: '기상',
  conflict: '분쟁',
  political: '정치',
  economic: '경제',
  health: '보건',
  disaster: '재난',
}

const TYPE_BADGE: Record<EventType, string> = {
  earthquake: 'bg-red-900/50 text-red-300 border border-red-800/50',
  weather: 'bg-cyan-900/50 text-cyan-300 border border-cyan-800/50',
  conflict: 'bg-orange-900/50 text-orange-300 border border-orange-800/50',
  political: 'bg-blue-900/50 text-blue-300 border border-blue-800/50',
  economic: 'bg-purple-900/50 text-purple-300 border border-purple-800/50',
  health: 'bg-pink-900/50 text-pink-300 border border-pink-800/50',
  disaster: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800/50',
}

const SEVERITY_BORDER: Record<Severity, string> = {
  critical: 'border-l-red-500 bg-red-950/20',
  high: 'border-l-orange-500 bg-orange-950/15',
  medium: 'border-l-yellow-600 bg-yellow-950/10',
  low: 'border-l-emerald-700 bg-emerald-950/10',
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-red-500 animate-pulse',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-emerald-500',
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

interface Props {
  events: WorldEvent[]
  onEventClick?: (event: WorldEvent) => void
}

export default function EventFeed({ events, onEventClick }: Props) {
  const shown = events.slice(0, 60)

  return (
    <div className="p-3 font-mono">
      <div className="flex items-center gap-2 text-[10px] text-gray-600 mb-3 uppercase tracking-widest">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        실시간 이벤트 피드
      </div>

      <div className="space-y-1.5">
        {shown.map((event, idx) => (
          <div
            key={event.id}
            className={`border-l-2 rounded-r pl-2 pr-2 py-1.5 cursor-pointer hover:opacity-75 active:opacity-50 transition-opacity event-item ${SEVERITY_BORDER[event.severity]}`}
            style={{ animationDelay: `${Math.min(idx * 15, 400)}ms` }}
            onClick={() => onEventClick?.(event)}
          >
            <div className="flex items-start justify-between gap-1 mb-0.5">
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${SEVERITY_DOT[event.severity]}`} />
                <span
                  className={`text-[10px] px-1 py-px rounded leading-none ${TYPE_BADGE[event.type]}`}
                >
                  {TYPE_LABELS[event.type]}
                </span>
              </div>
              <span className="text-[10px] text-gray-700 whitespace-nowrap flex-shrink-0">
                {timeAgo(event.timestamp)}
              </span>
            </div>
            <div className="text-xs text-gray-300 leading-snug line-clamp-2">
              {event.title}
            </div>
            <div className="text-[10px] text-gray-600 mt-0.5 truncate">
              {event.country ? `${event.country} · ` : ''}{event.location}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
