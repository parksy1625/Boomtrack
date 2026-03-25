'use client'

import { WorldEvent, EventType, Severity } from '@/lib/types'

const TYPE_LABELS: Record<EventType, string> = {
  earthquake: '지진', weather: '기상', conflict: '분쟁',
  political: '정치', economic: '경제', health: '보건', disaster: '재난',
}

const TYPE_DOT: Record<EventType, string> = {
  earthquake: '#ff3c3c', weather: '#28d2ff', conflict: '#ff6e00',
  political:  '#5078ff', economic: '#a03cff', health: '#ff3cc8', disaster: '#ffc800',
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '심각', high: '높음', medium: '보통', low: '낮음',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-red-400', high: 'text-orange-400',
  medium: 'text-yellow-400', low: 'text-emerald-400',
}

const SEVERITY_BAR: Record<Severity, string> = {
  critical: 'bg-red-500', high: 'bg-orange-500',
  medium: 'bg-yellow-500', low: 'bg-emerald-500',
}

const SOURCE_COLORS: Record<string, string> = {
  'USGS':      'text-red-400',
  'NASA EONET':'text-orange-400',
  'GDELT':     'text-cyan-400',
  'ReliefWeb': 'text-purple-400',
}

interface Props {
  events: WorldEvent[]
  sources: Record<string, number>
}

export default function StatsPanel({ events, sources }: Props) {
  const byType = events.reduce(
    (acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }),
    {} as Record<string, number>
  )
  const bySeverity = events.reduce(
    (acc, e) => ({ ...acc, [e.severity]: (acc[e.severity] ?? 0) + 1 }),
    {} as Record<string, number>
  )
  const maxType = Math.max(...Object.values(byType), 1)

  // Avg tone for GDELT events
  const gdeltEvents = events.filter(e => typeof e.toneScore === 'number')
  const avgTone = gdeltEvents.length
    ? gdeltEvents.reduce((s, e) => s + e.toneScore!, 0) / gdeltEvents.length
    : null

  return (
    <div className="p-3 space-y-3 font-mono text-xs select-none">
      <div className="text-[10px] tracking-widest text-gray-600 uppercase pt-1">
        통계 패널
      </div>

      {/* Total */}
      <div className="border border-cyan-900/40 rounded p-3 panel-border">
        <div className="text-gray-500 text-[10px] mb-1">총 감지 이벤트</div>
        <div className="text-cyan-300 text-3xl font-bold leading-none">{events.length}</div>
        <div className="text-gray-700 text-[10px] mt-1">실시간 전세계 집계</div>
      </div>

      {/* Global sentiment (GDELT avg tone) */}
      {avgTone !== null && (
        <div className="border border-cyan-900/40 rounded p-3">
          <div className="text-gray-500 text-[10px] mb-2">전세계 뉴스 감정 지수</div>
          <div className={`text-lg font-bold mb-1 ${avgTone <= -10 ? 'text-red-400' : avgTone <= -5 ? 'text-orange-400' : avgTone <= 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
            {avgTone.toFixed(1)}
            <span className="text-[10px] text-gray-600 ml-1 font-normal">
              {avgTone <= -10 ? '매우 부정' : avgTone <= -5 ? '부정' : avgTone <= 0 ? '다소 부정' : '중립'}
            </span>
          </div>
          <div className="h-1.5 bg-gray-900 rounded overflow-hidden relative">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
            <div
              className={`h-full rounded ${avgTone <= -10 ? 'bg-red-500' : avgTone <= -5 ? 'bg-orange-500' : avgTone <= 0 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.round(((avgTone + 100) / 200) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
            <span>-100</span><span>0</span><span>+100</span>
          </div>
          <div className="text-[9px] text-gray-700 mt-1">
            {gdeltEvents.length}개 GDELT 기사 기반
          </div>
        </div>
      )}

      {/* Severity */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">위험도별</div>
        {(['critical', 'high', 'medium', 'low'] as Severity[]).map(s => {
          const cnt = bySeverity[s] ?? 0
          const pct = events.length > 0 ? (cnt / events.length) * 100 : 0
          return (
            <div key={s} className="flex items-center gap-2 py-0.5">
              <span className={`w-9 ${SEVERITY_TEXT[s]}`}>{SEVERITY_LABELS[s]}</span>
              <div className="flex-1 h-1 bg-gray-900 rounded overflow-hidden">
                <div className={`h-full rounded transition-all duration-700 ${SEVERITY_BAR[s]}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={`w-5 text-right ${SEVERITY_TEXT[s]}`}>{cnt}</span>
            </div>
          )
        })}
      </div>

      {/* By type */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">유형별</div>
        {(Object.keys(TYPE_LABELS) as EventType[]).map(type => {
          const cnt = byType[type] ?? 0
          return (
            <div key={type} className="flex items-center gap-2 py-0.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TYPE_DOT[type] }} />
              <span className="w-10 text-gray-400">{TYPE_LABELS[type]}</span>
              <div className="flex-1 h-1 bg-gray-900 rounded overflow-hidden">
                <div className="h-full rounded transition-all duration-700" style={{ width: `${(cnt / maxType) * 100}%`, backgroundColor: TYPE_DOT[type] }} />
              </div>
              <span className="w-5 text-right text-gray-500">{cnt}</span>
            </div>
          )
        })}
      </div>

      {/* Data sources */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">데이터 소스</div>
        {Object.entries(sources).map(([src, cnt]) => (
          <div key={src} className="flex justify-between items-center py-0.5">
            <span className={`${SOURCE_COLORS[src] ?? 'text-gray-400'}`}>{src}</span>
            <span className="text-gray-600">{cnt}건</span>
          </div>
        ))}
        {Object.keys(sources).length === 0 && (
          <div className="text-gray-700 text-[10px]">로딩 중...</div>
        )}
      </div>

      {/* Legend */}
      <div className="border border-cyan-900/40 rounded p-3">
        <div className="text-gray-500 text-[10px] mb-2">글로브 범례</div>
        {(Object.keys(TYPE_DOT) as EventType[]).map(type => (
          <div key={type} className="flex items-center gap-2 py-px">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TYPE_DOT[type], boxShadow: `0 0 4px ${TYPE_DOT[type]}` }} />
            <span className="text-gray-500">{TYPE_LABELS[type]}</span>
          </div>
        ))}
        <div className="mt-2 pt-2 border-t border-gray-900 text-[9px] text-gray-700 leading-relaxed">
          점 높이 = 위험도 · 링 = 고위험
        </div>
      </div>
    </div>
  )
}
