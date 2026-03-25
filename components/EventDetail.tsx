'use client'

import { WorldEvent, EventType, Severity } from '@/lib/types'

const TYPE_LABELS: Record<EventType, string> = {
  earthquake: '지진', weather: '기상', conflict: '분쟁',
  political: '정치', economic: '경제', health: '보건', disaster: '재난',
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '심각', high: '높음', medium: '보통', low: '낮음',
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'text-red-400 border-red-500',
  high:     'text-orange-400 border-orange-500',
  medium:   'text-yellow-400 border-yellow-600',
  low:      'text-emerald-400 border-emerald-600',
}

const SEVERITY_BG: Record<Severity, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-500',
  medium:   'bg-yellow-500',
  low:      'bg-emerald-500',
}

const TYPE_COLORS: Record<EventType, string> = {
  earthquake: 'text-red-400', weather: 'text-cyan-400',
  conflict: 'text-orange-400', political: 'text-blue-400',
  economic: 'text-purple-400', health: 'text-pink-400', disaster: 'text-yellow-400',
}

/** Returns tone label + bar width % (0-100) based on tone scale -100 to +100 */
function toneInfo(tone: number): { label: string; pct: number; color: string } {
  const pct = Math.round(((tone + 100) / 200) * 100)
  let label = '중립'
  let color = 'bg-gray-500'
  if (tone <= -15)      { label = '매우 부정적'; color = 'bg-red-600' }
  else if (tone <= -7)  { label = '부정적';       color = 'bg-orange-500' }
  else if (tone <= -3)  { label = '다소 부정적';  color = 'bg-yellow-500' }
  else if (tone <= 3)   { label = '중립';          color = 'bg-gray-400' }
  else                  { label = '긍정적';         color = 'bg-emerald-500' }
  return { label, pct, color }
}

interface Props {
  event: WorldEvent
  onClose: () => void
}

export default function EventDetail({ event, onClose }: Props) {
  const hasTone = typeof event.toneScore === 'number'
  const tone = hasTone ? toneInfo(event.toneScore!) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-gray-950 border rounded-lg max-w-md w-full mx-4 overflow-hidden shadow-2xl ${SEVERITY_COLORS[event.severity]}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Severity header stripe */}
        <div className={`h-1 w-full ${SEVERITY_BG[event.severity]}`} />

        <div className="p-5 font-mono">
          {/* Title row */}
          <div className="flex justify-between items-start gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] px-1.5 py-px rounded border ${SEVERITY_COLORS[event.severity]}`}>
                  {SEVERITY_LABELS[event.severity]}
                </span>
                <span className={`text-[10px] ${TYPE_COLORS[event.type]}`}>
                  {TYPE_LABELS[event.type]}
                </span>
              </div>
              <h2 className="text-sm text-white font-bold leading-snug">{event.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-white text-xl leading-none flex-shrink-0 transition-colors"
            >✕</button>
          </div>

          {/* Preview image */}
          {event.imageUrl && (
            <div className="mb-4 rounded overflow-hidden border border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.imageUrl}
                alt={event.title}
                className="w-full h-32 object-cover opacity-80"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}

          {/* ── Severity / Tone Analysis ── */}
          {hasTone && tone && (
            <div className="mb-4 border border-gray-800 rounded p-3 bg-gray-900/50">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">
                뉴스 감정 분석 (GDELT)
              </div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-300">{tone.label}</span>
                <span className="text-xs text-gray-500">
                  {event.toneScore!.toFixed(1)} / 100
                </span>
              </div>
              {/* Tone bar: 0% = -100 (most negative), 50% = 0 (neutral), 100% = +100 */}
              <div className="h-2 bg-gray-800 rounded overflow-hidden relative">
                {/* Neutral center mark */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
                <div
                  className={`h-full rounded transition-all duration-700 ${tone.color}`}
                  style={{ width: `${tone.pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
                <span>매우 부정</span>
                <span>중립</span>
                <span>긍정</span>
              </div>
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs mb-4">
            <div>
              <div className="text-[10px] text-gray-600 mb-0.5">위치</div>
              <div className="text-gray-300 truncate">{event.location || '알 수 없음'}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-600 mb-0.5">국가</div>
              <div className="text-gray-300">{event.country || '알 수 없음'}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-600 mb-0.5">좌표</div>
              <div className="text-gray-600 text-[10px]">
                {event.lat.toFixed(3)}°, {event.lng.toFixed(3)}°
              </div>
            </div>
            <div>
              <div className="text-[10px] text-gray-600 mb-0.5">감지 시각</div>
              <div className="text-gray-500 text-[10px]">
                {new Date(event.timestamp).toLocaleString('ko-KR')}
              </div>
            </div>
            {event.magnitude != null && (
              <div className="col-span-2">
                <div className="text-[10px] text-gray-600 mb-0.5">지진 규모</div>
                <div className="text-red-400 text-xl font-bold">
                  M {event.magnitude.toFixed(1)}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="border-t border-gray-900 pt-3 mb-3">
            <div className="text-[10px] text-gray-600 mb-1">상세 내용</div>
            <p className="text-gray-400 text-xs leading-relaxed">{event.description}</p>
          </div>

          {/* Source + news link */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-gray-700">
              출처: <span className="text-gray-500">{event.source}</span>
              {event.domain && <span className="text-gray-600"> · {event.domain}</span>}
            </div>
            {event.newsUrl && (
              <a
                href={event.newsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-cyan-500 hover:text-cyan-300 border border-cyan-900/50 hover:border-cyan-700 px-2 py-1 rounded transition-colors"
              >
                원문 보기 →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
