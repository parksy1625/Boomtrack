'use client'

import { WorldEvent, EventType, Severity } from '@/lib/types'

const TYPE_LABELS: Record<EventType, string> = {
  earthquake: '🔴 지진',
  weather: '🔵 기상',
  conflict: '🟠 분쟁',
  political: '💙 정치',
  economic: '🟣 경제',
  health: '🩷 보건',
  disaster: '🟡 재난',
}

const TYPE_DOT_COLORS: Record<EventType, string> = {
  earthquake: '#ff3c3c',
  weather: '#28d2ff',
  conflict: '#ff6e00',
  political: '#5078ff',
  economic: '#a03cff',
  health: '#ff3cc8',
  disaster: '#ffc800',
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '심각',
  high: '높음',
  medium: '보통',
  low: '낮음',
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-emerald-400',
}

const SEVERITY_BAR_COLORS: Record<Severity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-emerald-500',
}

interface Props {
  events: WorldEvent[]
}

export default function StatsPanel({ events }: Props) {
  const byType = events.reduce(
    (acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }),
    {} as Record<string, number>
  )

  const bySeverity = events.reduce(
    (acc, e) => ({ ...acc, [e.severity]: (acc[e.severity] ?? 0) + 1 }),
    {} as Record<string, number>
  )

  const maxType = Math.max(...Object.values(byType), 1)

  return (
    <div className="p-3 space-y-3 font-mono text-xs select-none">
      {/* Title */}
      <div className="text-[10px] tracking-widest text-gray-600 uppercase pt-1">
        통계 패널
      </div>

      {/* Total */}
      <div className="border border-cyan-900/40 rounded p-3 panel-border">
        <div className="text-gray-500 text-[10px] mb-1">총 감지 이벤트</div>
        <div className="text-cyan-300 text-3xl font-bold leading-none">
          {events.length}
        </div>
        <div className="text-gray-700 text-[10px] mt-1">최근 12시간 기준</div>
      </div>

      {/* Severity */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">위험도별</div>
        {(['critical', 'high', 'medium', 'low'] as Severity[]).map(s => {
          const cnt = bySeverity[s] ?? 0
          const pct = events.length > 0 ? (cnt / events.length) * 100 : 0
          return (
            <div key={s} className="flex items-center gap-2 py-0.5">
              <span className={`w-10 ${SEVERITY_COLORS[s]}`}>
                {SEVERITY_LABELS[s]}
              </span>
              <div className="flex-1 h-1 bg-gray-900 rounded overflow-hidden">
                <div
                  className={`h-full rounded transition-all duration-700 ${SEVERITY_BAR_COLORS[s]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`w-5 text-right ${SEVERITY_COLORS[s]}`}>{cnt}</span>
            </div>
          )
        })}
      </div>

      {/* By type */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">유형별</div>
        {(Object.keys(TYPE_LABELS) as EventType[]).map(type => {
          const cnt = byType[type] ?? 0
          const pct = (cnt / maxType) * 100
          return (
            <div key={type} className="flex items-center gap-2 py-0.5">
              <span className="w-16 text-gray-400 truncate">{TYPE_LABELS[type]}</span>
              <div className="flex-1 h-1 bg-gray-900 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: TYPE_DOT_COLORS[type],
                  }}
                />
              </div>
              <span className="w-5 text-right text-gray-400">{cnt}</span>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">글로브 범례</div>
        {(Object.keys(TYPE_DOT_COLORS) as EventType[]).map(type => (
          <div key={type} className="flex items-center gap-2 py-0.5">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: TYPE_DOT_COLORS[type], boxShadow: `0 0 4px ${TYPE_DOT_COLORS[type]}` }}
            />
            <span className="text-gray-400">{TYPE_LABELS[type].slice(2)}</span>
          </div>
        ))}
        <div className="mt-2 pt-2 border-t border-gray-900 text-gray-600 text-[10px] leading-relaxed">
          점 높이 = 위험도<br />
          링 효과 = 고·심각 이벤트
        </div>
      </div>
    </div>
  )
}
