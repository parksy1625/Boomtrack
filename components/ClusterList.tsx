'use client'
import { WorldEvent } from '@/lib/types'
import { TYPE_COLORS } from '@/components/Globe3D'

interface Props {
  events: WorldEvent[]
  onSelect: (e: WorldEvent) => void
  onClose: () => void
}

export default function ClusterList({ events, onSelect, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#000818] border border-cyan-900/50 rounded-t-2xl md:rounded-lg overflow-hidden flex flex-col"
        style={{ maxHeight: '65vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/30 flex-shrink-0">
          <span className="text-[11px] font-mono text-cyan-400 tracking-widest uppercase">
            이 지역 이벤트 {events.length}건
          </span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none w-6 h-6 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto">
          {events
            .sort((a, b) => {
              const sev = { critical: 3, high: 2, medium: 1, low: 0 }
              return (sev[b.severity] - sev[a.severity]) ||
                     new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            })
            .map(e => (
              <button
                key={e.id}
                onClick={() => { onSelect(e); onClose() }}
                className="w-full text-left px-4 py-3 border-b border-gray-900/60 hover:bg-white/5 active:bg-white/10 transition-colors flex items-start gap-3"
              >
                <span
                  className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: TYPE_COLORS[e.type] ?? '#888' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-200 leading-snug line-clamp-2">{e.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[9px] font-mono font-bold ${
                      e.severity === 'critical' ? 'text-red-400' :
                      e.severity === 'high'     ? 'text-orange-400' :
                      e.severity === 'medium'   ? 'text-yellow-400' : 'text-gray-500'
                    }`}>
                      {e.severity.toUpperCase()}
                    </span>
                    <span className="text-[9px] text-gray-600">{e.location}</span>
                    <span className="text-[9px] text-gray-700 truncate">{e.source.split(' · ')[0]}</span>
                  </div>
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
