'use client'
import { EventType, Severity } from '@/lib/types'

export const TYPE_META: Array<{ type: EventType; label: string; color: string }> = [
  { type: 'conflict',    label: '분쟁',  color: 'rgba(255,110,0,0.95)' },
  { type: 'earthquake',  label: '지진',  color: 'rgba(255,60,60,0.95)' },
  { type: 'terrorism',   label: '테러',  color: 'rgba(255,30,30,0.95)' },
  { type: 'nuclear',     label: '핵',    color: 'rgba(0,255,100,0.95)' },
  { type: 'weather',     label: '기상',  color: 'rgba(40,210,255,0.95)' },
  { type: 'disaster',    label: '재난',  color: 'rgba(255,200,0,0.95)' },
  { type: 'health',      label: '보건',  color: 'rgba(255,60,200,0.95)' },
  { type: 'political',   label: '정치',  color: 'rgba(80,120,255,0.95)' },
  { type: 'economic',    label: '경제',  color: 'rgba(160,60,255,0.95)' },
  { type: 'migration',   label: '난민',  color: 'rgba(255,200,80,0.95)' },
  { type: 'environment', label: '환경',  color: 'rgba(80,200,80,0.95)' },
  { type: 'space',       label: '우주',  color: 'rgba(200,180,255,0.95)' },
]

const SEVERITIES: Array<{ value: Severity | 'all'; label: string; color: string }> = [
  { value: 'all',      label: '전체', color: '#9ca3af' },
  { value: 'critical', label: '위급', color: '#f87171' },
  { value: 'high',     label: '높음', color: '#fb923c' },
  { value: 'medium',   label: '보통', color: '#facc15' },
  { value: 'low',      label: '낮음', color: '#6b7280' },
]

interface Props {
  activeTypes: Set<EventType>
  activeSeverity: Severity | 'all'
  onTypeToggle: (t: EventType) => void
  onSeverityChange: (s: Severity | 'all') => void
}

export default function FilterBar({ activeTypes, activeSeverity, onTypeToggle, onSeverityChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-cyan-900/30 bg-black/70 backdrop-blur-sm">
      {/* Type filters */}
      <div className="flex flex-wrap gap-1 items-center">
        {TYPE_META.map(({ type, label, color }) => {
          const on = activeTypes.has(type)
          const dim = activeTypes.size > 0 && !on
          return (
            <button
              key={type}
              onClick={() => onTypeToggle(type)}
              className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-all ${
                on  ? 'border-current opacity-100 bg-white/5'
                : dim ? 'border-gray-800 opacity-20 hover:opacity-40'
                : 'border-gray-700 opacity-50 hover:opacity-75'
              }`}
              style={{ color: dim ? '#555' : color, borderColor: on ? color : undefined }}
            >
              {label}
            </button>
          )
        })}
        {activeTypes.size > 0 && (
          <button
            onClick={() => { const copy = new Set(activeTypes); copy.forEach(t => onTypeToggle(t)) }}
            className="px-1.5 py-0.5 text-[10px] font-mono rounded border border-gray-700 text-gray-600 hover:text-gray-300 hover:border-gray-500 transition-all"
          >
            ✕
          </button>
        )}
      </div>
      {/* Severity filter */}
      <div className="flex gap-1">
        {SEVERITIES.map(({ value, label, color }) => (
          <button
            key={value}
            onClick={() => onSeverityChange(value)}
            className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all ${
              activeSeverity === value
                ? 'border-current opacity-100 bg-white/5'
                : 'border-gray-800 opacity-35 hover:opacity-60'
            }`}
            style={{ color, borderColor: activeSeverity === value ? color : undefined }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
