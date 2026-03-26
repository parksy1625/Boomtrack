import { WorldEvent, Severity } from './types'

const SEV_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

function jaccard(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  if (wa.size === 0 && wb.size === 0) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}

/** 유사 이벤트를 합침: 같은 타입 + 12h 이내 + 좌표 1.5° 이내 + 제목 유사도 35%+ */
export function dedup(events: WorldEvent[]): WorldEvent[] {
  const out: WorldEvent[] = []
  for (const e of events) {
    const dup = out.find(o =>
      o.type === e.type &&
      Math.abs(o.lat - e.lat) < 1.5 &&
      Math.abs(o.lng - e.lng) < 1.5 &&
      Math.abs(new Date(o.timestamp).getTime() - new Date(e.timestamp).getTime()) < 43_200_000 &&
      jaccard(o.title, e.title) > 0.35
    )
    if (dup) {
      if (SEV_RANK[e.severity] > SEV_RANK[dup.severity]) {
        dup.severity  = e.severity
        dup.title     = e.title
        dup.description = e.description
      }
      if (!dup.source.includes(e.source))
        dup.source += ' · ' + e.source
    } else {
      out.push({ ...e })
    }
  }
  return out
}
