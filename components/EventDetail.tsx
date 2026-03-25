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

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '⚠ 심각',
  high: '▲ 높음',
  medium: '◆ 보통',
  low: '▼ 낮음',
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-emerald-400',
}

const TYPE_COLORS: Record<EventType, string> = {
  earthquake: 'text-red-400',
  weather: 'text-cyan-400',
  conflict: 'text-orange-400',
  political: 'text-blue-400',
  economic: 'text-purple-400',
  health: 'text-pink-400',
  disaster: 'text-yellow-400',
}

interface Props {
  event: WorldEvent
  onClose: () => void
}

export default function EventDetail({ event, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-cyan-800/50 rounded-lg p-5 max-w-sm w-full mx-4 font-mono shadow-2xl shadow-cyan-950/50"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] text-cyan-600 tracking-widest uppercase mb-1">
              이벤트 상세
            </div>
            <h2 className="text-sm text-white font-bold leading-snug">
              {event.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white text-xl leading-none ml-3 flex-shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs mb-4">
          <div>
            <div className="text-[10px] text-gray-600 mb-0.5">유형</div>
            <div className={TYPE_COLORS[event.type]}>{TYPE_LABELS[event.type]}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 mb-0.5">위험도</div>
            <div className={SEVERITY_COLORS[event.severity]}>
              {SEVERITY_LABELS[event.severity]}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 mb-0.5">위치</div>
            <div className="text-gray-300">{event.location}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 mb-0.5">국가</div>
            <div className="text-gray-300">{event.country || '알 수 없음'}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 mb-0.5">좌표</div>
            <div className="text-gray-500 text-[10px]">
              {event.lat.toFixed(3)}°N, {event.lng.toFixed(3)}°E
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 mb-0.5">감지 시각</div>
            <div className="text-gray-400 text-[10px]">
              {new Date(event.timestamp).toLocaleString('ko-KR')}
            </div>
          </div>
          {event.magnitude != null && (
            <div className="col-span-2">
              <div className="text-[10px] text-gray-600 mb-0.5">규모 (Magnitude)</div>
              <div className="text-red-400 text-lg font-bold">
                M {event.magnitude.toFixed(1)}
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="border-t border-gray-900 pt-3">
          <div className="text-[10px] text-gray-600 mb-1">상세 내용</div>
          <p className="text-gray-400 text-xs leading-relaxed">{event.description}</p>
        </div>

        {/* Source */}
        {event.source && (
          <div className="mt-3 text-[10px] text-gray-700">
            출처: {event.source}
          </div>
        )}
      </div>
    </div>
  )
}
