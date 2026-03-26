'use client'

import { WorldEvent, Severity } from '@/lib/types'

const SEV_COLOR: Record<Severity, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-500',
  medium:   'bg-yellow-500',
  low:      'bg-blue-400',
}
const SEV_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

interface Props {
  events: WorldEvent[]
  onSelect: (e: WorldEvent) => void
  onClose: () => void
}

export default function ClusterList({ events, onSelect, onClose }: Props) {
  const sorted = [...events].sort((a, b) => {
    const sd = SEV_RANK[b.severity] - SEV_RANK[a.severity]
    if (sd !== 0) return sd
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[80vh] flex flex-col bg-[#050510] border border-cyan-900/60 rounded shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/40">
          <span className="text-cyan-400 text-xs font-mono tracking-widest">
            CLUSTER · {events.length}개 이벤트
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {sorted.map(e => (
            <button
              key={e.id}
              onClick={() => { onSelect(e); onClose() }}
              className="w-full text-left px-4 py-3 border-b border-cyan-900/20 hover:bg-cyan-900/10 transition-colors flex items-start gap-3"
            >
              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${SEV_COLOR[e.severity]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-gray-100 text-xs leading-snug line-clamp-2">{e.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-gray-500">{e.severity.toUpperCase()}</span>
                  {e.location && <span className="text-[10px] text-gray-600 truncate">{e.location}</span>}
                  <span className="text-[10px] text-gray-700 ml-auto flex-shrink-0">{e.source}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
