import { NextResponse } from 'next/server'
import { WorldEvent, EventType, Severity } from '@/lib/types'

// ─────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────

function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(Math.abs(lat as number) < 0.001 && Math.abs(lng as number) < 0.001)
  )
}

/** GDELT tone (-100~+100) → Severity */
function toneToSeverity(tone: number): Severity {
  if (tone <= -15) return 'critical'
  if (tone <= -7)  return 'high'
  if (tone <= -3)  return 'medium'
  return 'low'
}

/** "20240101T120000Z" → ISO string */
function parseGdeltDate(raw: string): string {
  try {
    const s = raw.replace(/[TZ]/g, '')
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`
  } catch {
    return new Date().toISOString()
  }
}

const FETCH_OPTS = (revalidate: number): RequestInit => ({
  next: { revalidate },
  headers: { 'User-Agent': 'BoomTrack/1.0' },
  signal: AbortSignal.timeout(10_000),
})

// ─────────────────────────────────────────────────────────
// 1. USGS — Real-time earthquakes
// ─────────────────────────────────────────────────────────

function magToSeverity(mag: number): Severity {
  if (mag >= 7) return 'critical'
  if (mag >= 5) return 'high'
  if (mag >= 3) return 'medium'
  return 'low'
}

async function fetchUSGS(): Promise<WorldEvent[]> {
  const url =
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
  const res = await fetch(url, FETCH_OPTS(60))
  const json = await res.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.features as any[])
    .filter(f =>
      isValidCoord(f.geometry?.coordinates?.[1], f.geometry?.coordinates?.[0])
    )
    .slice(0, 100)
    .map(f => {
      const mag = f.properties.mag ?? 0
      return {
        id: f.id,
        lat: f.geometry.coordinates[1] as number,
        lng: f.geometry.coordinates[0] as number,
        type: 'earthquake' as EventType,
        title: f.properties.title ?? '지진 발생',
        description: `규모 ${mag.toFixed(1)} 지진 감지. ${f.properties.place ?? ''}`,
        severity: magToSeverity(mag),
        location: f.properties.place ?? '',
        country: '',
        timestamp: new Date(f.properties.time as number).toISOString(),
        magnitude: mag,
        source: 'USGS',
        newsUrl: f.properties.url ?? undefined,
      }
    })
}

// ─────────────────────────────────────────────────────────
// 2. NASA EONET — Natural disasters (wildfires, volcanoes…)
// ─────────────────────────────────────────────────────────

const EONET_MAP: Record<string, { type: EventType; severity: Severity }> = {
  wildfires:     { type: 'disaster', severity: 'high' },
  severeStorms:  { type: 'weather',  severity: 'high' },
  volcanoes:     { type: 'disaster', severity: 'critical' },
  floods:        { type: 'weather',  severity: 'high' },
  earthquakes:   { type: 'earthquake', severity: 'medium' },
  drought:       { type: 'weather',  severity: 'medium' },
  dustHaze:      { type: 'weather',  severity: 'low' },
  manmadeHazards:{ type: 'disaster', severity: 'high' },
  snow:          { type: 'weather',  severity: 'medium' },
  tempExtremes:  { type: 'weather',  severity: 'medium' },
  seaLakeIce:    { type: 'weather',  severity: 'low' },
  waterColor:    { type: 'disaster', severity: 'low' },
}

async function fetchEONET(): Promise<WorldEvent[]> {
  const url = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60'
  const res = await fetch(url, FETCH_OPTS(300))
  const json = await res.json()

  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of (json.events as any[]) ?? []) {
    if (!ev.geometry?.length) continue
    const geo = ev.geometry[ev.geometry.length - 1]
    if (geo.type !== 'Point') continue
    const [lng, lat] = geo.coordinates as [number, number]
    if (!isValidCoord(lat, lng)) continue

    const catId = ev.categories?.[0]?.id ?? ''
    const mapped = EONET_MAP[catId] ?? { type: 'disaster' as EventType, severity: 'medium' as Severity }

    events.push({
      id: `eonet-${ev.id}`,
      lat,
      lng,
      type: mapped.type,
      title: ev.title as string,
      description: `NASA EONET 감시 중: ${ev.title}. 분류: ${ev.categories?.[0]?.title ?? '알 수 없음'}`,
      severity: mapped.severity,
      location: ev.title as string,
      country: '',
      timestamp: (geo.date as string) ?? new Date().toISOString(),
      source: 'NASA EONET',
      newsUrl: ev.sources?.[0]?.url as string | undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 3. GDELT — Global news events with tone/severity analysis
// ─────────────────────────────────────────────────────────

/**
 * GDELT GEO API: returns GeoJSON with one point per article,
 * coordinates = where the article is geographically about.
 * Properties include urltone (sentiment), url, domain, seendate.
 */
async function fetchGDELT(query: string, type: EventType): Promise<WorldEvent[]> {
  const url =
    `https://api.gdeltproject.org/api/v2/geo/geo` +
    `?query=${encodeURIComponent(query)}` +
    `&format=geojson&timespan=24H&maxpoints=40`

  const res = await fetch(url, FETCH_OPTS(300))
  if (!res.ok) return []
  const json = await res.json()

  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const f of (json.features as any[]) ?? []) {
    const coords = f.geometry?.coordinates
    if (!Array.isArray(coords)) continue
    const lng = coords[0] as number
    const lat = coords[1] as number
    if (!isValidCoord(lat, lng)) continue

    const p = f.properties ?? {}
    const tone: number = typeof p.urltone === 'number' ? p.urltone
                       : typeof p.tone    === 'number' ? p.tone
                       : -5

    const rawDate: string = p.seendate ?? p.date ?? ''
    const timestamp = rawDate ? parseGdeltDate(rawDate) : new Date().toISOString()

    events.push({
      id: `gdelt-${type}-${(p.url as string | undefined)?.slice(-16) ?? Math.random().toString(36).slice(2)}`,
      lat,
      lng,
      type,
      title: (p.name ?? p.title ?? query) as string,
      description:
        `뉴스 감정 지수: ${tone.toFixed(1)} (${tone <= -10 ? '매우 부정' : tone <= -5 ? '부정' : tone <= 0 ? '다소 부정' : '중립/긍정'}) | 출처: ${p.domain ?? '알 수 없음'}`,
      severity: toneToSeverity(tone),
      location: (p.name ?? '') as string,
      country: (p.countrycode ?? '') as string,
      timestamp,
      source: 'GDELT',
      newsUrl: p.url as string | undefined,
      toneScore: tone,
      imageUrl: p.socialimage as string | undefined,
      domain: p.domain as string | undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 4. ReliefWeb — Humanitarian crises
// ─────────────────────────────────────────────────────────

/** Country name → approximate center coordinates */
const COUNTRY_COORDS: Record<string, readonly [number, number]> = {
  Afghanistan: [33.0, 65.0], Albania: [41.0, 20.0], Algeria: [28.0, 2.0],
  Angola: [-12.0, 18.0], Argentina: [-34.0, -64.0], Armenia: [40.0, 45.0],
  Australia: [-25.0, 133.0], Austria: [47.5, 14.0], Azerbaijan: [40.5, 47.5],
  Bangladesh: [24.0, 90.0], Belarus: [53.0, 28.0], Belgium: [50.8, 4.5],
  Bolivia: [-17.0, -65.0], Brazil: [-10.0, -55.0], Bulgaria: [43.0, 25.0],
  Cambodia: [13.0, 105.0], Cameroon: [6.0, 12.0], Canada: [60.0, -96.0],
  'Central African Republic': [7.0, 21.0], Chad: [15.0, 19.0],
  Chile: [-30.0, -71.0], China: [35.0, 105.0], Colombia: [4.0, -72.0],
  Congo: [-1.0, 15.0], Cuba: [22.0, -79.5], 'Czech Republic': [49.75, 15.5],
  'Democratic Republic of the Congo': [-4.0, 22.0],
  Denmark: [56.0, 10.0], Ecuador: [-2.0, -77.5], Egypt: [26.0, 30.0],
  Ethiopia: [8.0, 38.0], Finland: [64.0, 26.0], France: [46.0, 2.0],
  Georgia: [42.0, 43.5], Germany: [51.0, 10.0], Ghana: [8.0, -2.0],
  Greece: [39.0, 22.0], Guatemala: [15.5, -90.25], Guinea: [11.0, -10.0],
  Haiti: [19.0, -72.5], Honduras: [15.0, -86.5], Hungary: [47.0, 19.0],
  India: [20.0, 77.0], Indonesia: [-5.0, 120.0], Iran: [32.0, 53.0],
  Iraq: [33.0, 44.0], Ireland: [53.0, -8.0], Israel: [31.5, 34.75],
  Italy: [42.0, 12.5], 'Ivory Coast': [7.5, -5.5], Japan: [36.0, 138.0],
  Jordan: [31.0, 36.0], Kazakhstan: [48.0, 68.0], Kenya: [1.0, 38.0],
  Kuwait: [29.5, 47.75], Laos: [18.0, 103.0], Lebanon: [33.85, 35.9],
  Libya: [27.0, 17.0], Malaysia: [2.5, 112.5], Mali: [17.0, -4.0],
  Mexico: [23.0, -102.0], Morocco: [32.0, -5.0], Mozambique: [-18.0, 35.0],
  Myanmar: [22.0, 96.0], Nepal: [28.0, 84.0], Netherlands: [52.3, 5.3],
  'New Zealand': [-42.0, 174.0], Nicaragua: [13.0, -85.0],
  Niger: [17.0, 8.0], Nigeria: [10.0, 8.0], 'North Korea': [40.0, 127.0],
  Norway: [64.0, 26.0], Pakistan: [30.0, 70.0], Palestine: [31.9, 35.2],
  Panama: [9.0, -80.0], Peru: [-10.0, -76.0], Philippines: [13.0, 122.0],
  Poland: [52.0, 20.0], Portugal: [39.5, -8.0], Romania: [46.0, 25.0],
  Russia: [60.0, 100.0], Rwanda: [-2.0, 30.0], 'Saudi Arabia': [24.0, 45.0],
  Senegal: [14.0, -14.0], Serbia: [44.0, 21.0], Singapore: [1.35, 103.82],
  Somalia: [6.0, 46.0], 'South Africa': [-29.0, 25.0],
  'South Korea': [36.0, 128.0], 'South Sudan': [7.0, 30.0],
  Spain: [40.0, -4.0], 'Sri Lanka': [7.0, 81.0], Sudan: [15.0, 30.0],
  Sweden: [60.0, 15.0], Switzerland: [47.0, 8.0], Syria: [35.0, 38.0],
  Taiwan: [23.5, 121.0], Tanzania: [-6.0, 35.0], Thailand: [15.0, 100.0],
  Tunisia: [34.0, 9.0], Turkey: [39.0, 35.0], Uganda: [1.0, 32.0],
  Ukraine: [49.0, 32.0], 'United Arab Emirates': [24.0, 54.0],
  'United Kingdom': [54.0, -2.0], 'United States': [38.0, -97.0],
  Uruguay: [-33.0, -56.0], Uzbekistan: [41.0, 64.0],
  Venezuela: [8.0, -66.0], Vietnam: [16.0, 108.0],
  Yemen: [15.5, 47.5], Zimbabwe: [-20.0, 30.0],
}

const RELIEFWEB_TYPE: Record<string, EventType> = {
  Flood: 'weather', Storm: 'weather', Drought: 'weather',
  'Cold Wave': 'weather', 'Heat Wave': 'weather', 'Tropical Cyclone': 'weather',
  Earthquake: 'earthquake', Tsunami: 'disaster', Volcano: 'disaster',
  Wildfire: 'disaster', Landslide: 'disaster', Avalanche: 'disaster',
  'Flash Flood': 'weather', Epidemic: 'health', 'Food Insecurity': 'health',
  Conflict: 'conflict', Other: 'disaster',
}

async function fetchReliefWeb(): Promise<WorldEvent[]> {
  const url =
    'https://api.reliefweb.int/v1/disasters' +
    '?appname=boomtrack' +
    '&limit=30' +
    '&fields[include][]=name' +
    '&fields[include][]=date.created' +
    '&fields[include][]=country' +
    '&fields[include][]=primary_type' +
    '&fields[include][]=status' +
    '&filter[field]=status&filter[value]=ongoing'

  const res = await fetch(url, FETCH_OPTS(600))
  const json = await res.json()

  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (json.data as any[]) ?? []) {
    const f = item.fields ?? {}
    const countryName: string = f.country?.[0]?.name ?? ''
    const coords = COUNTRY_COORDS[countryName]
    if (!coords) continue

    const [baseLat, baseLng] = coords
    // Slight random spread within country
    const lat = baseLat + (Math.random() - 0.5) * 4
    const lng = baseLng + (Math.random() - 0.5) * 4

    const typeName: string = f.primary_type?.name ?? 'Other'
    const type: EventType = RELIEFWEB_TYPE[typeName] ?? 'disaster'

    events.push({
      id: `reliefweb-${item.id}`,
      lat,
      lng,
      type,
      title: f.name as string,
      description: `ReliefWeb 진행 중 재난: ${f.name} (${typeName}) — ${countryName}`,
      severity: 'high',
      location: countryName,
      country: countryName,
      timestamp: (f.date?.created as string | undefined) ?? new Date().toISOString(),
      source: 'ReliefWeb',
      newsUrl: `https://reliefweb.int/disaster/${item.id}`,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// Main GET handler
// ─────────────────────────────────────────────────────────

export async function GET() {
  const settled = await Promise.allSettled([
    fetchUSGS(),
    fetchEONET(),
    fetchGDELT('conflict war attack explosion military assault', 'conflict'),
    fetchGDELT('political crisis coup protest demonstration sanctions', 'political'),
    fetchGDELT('economic crisis market crash financial bankruptcy recession', 'economic'),
    fetchGDELT('epidemic virus disease outbreak pandemic health emergency', 'health'),
    fetchReliefWeb(),
  ])

  const allEvents: WorldEvent[] = settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<WorldEvent[]>).value)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const sources: Record<string, number> = {}
  for (const e of allEvents) {
    sources[e.source] = (sources[e.source] ?? 0) + 1
  }

  // Log which sources failed
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const names = ['USGS', 'EONET', 'GDELT-conflict', 'GDELT-political', 'GDELT-economic', 'GDELT-health', 'ReliefWeb']
      console.warn(`[BoomTrack] ${names[i]} failed:`, r.reason)
    }
  })

  return NextResponse.json({
    events: allEvents,
    total: allEvents.length,
    lastUpdate: new Date().toISOString(),
    sources,
  })
}
