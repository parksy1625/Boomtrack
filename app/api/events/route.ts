import { NextResponse } from 'next/server'
import { WorldEvent, EventType, Severity } from '@/lib/types'

// ─────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)
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
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`
  } catch { return new Date().toISOString() }
}

function fetchOpts(revalidate: number): RequestInit {
  return { next: { revalidate }, signal: AbortSignal.timeout(12_000) }
}

function magToSeverity(mag: number): Severity {
  if (mag >= 7) return 'critical'
  if (mag >= 5) return 'high'
  if (mag >= 3) return 'medium'
  return 'low'
}

// ─────────────────────────────────────────────────────────
// 1. USGS — Real-time earthquakes (global, last 24 h)
// ─────────────────────────────────────────────────────────

async function fetchUSGS(): Promise<WorldEvent[]> {
  const res = await fetch(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    fetchOpts(60)
  )
  const json = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.features as any[])
    .filter(f => isValidCoord(f.geometry?.coordinates?.[1], f.geometry?.coordinates?.[0]))
    .slice(0, 120)
    .map(f => {
      const mag = f.properties.mag ?? 0
      return {
        id: f.id,
        lat: f.geometry.coordinates[1] as number,
        lng: f.geometry.coordinates[0] as number,
        type: 'earthquake' as EventType,
        title: f.properties.title ?? '지진 발생',
        description: `규모 ${mag.toFixed(1)} 지진 감지 — ${f.properties.place ?? ''}`,
        severity: magToSeverity(mag),
        location: f.properties.place ?? '',
        country: '',
        timestamp: new Date(f.properties.time as number).toISOString(),
        magnitude: mag,
        source: 'USGS',
        newsUrl: f.properties.url as string | undefined,
      }
    })
}

// ─────────────────────────────────────────────────────────
// 2. EMSC — European-Mediterranean Seismological Centre
// ─────────────────────────────────────────────────────────

async function fetchEMSC(): Promise<WorldEvent[]> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const url = `https://www.seismicportal.eu/fdsnws/event/1/query?limit=100&format=json&orderby=time&starttime=${since}`
  const res = await fetch(url, fetchOpts(120))
  const json = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.features as any[])
    .filter(f => isValidCoord(f.geometry?.coordinates?.[1], f.geometry?.coordinates?.[0]))
    .slice(0, 80)
    .map(f => {
      const mag = f.properties.mag ?? 0
      return {
        id: `emsc-${f.id ?? Math.random().toString(36).slice(2)}`,
        lat: f.geometry.coordinates[1] as number,
        lng: f.geometry.coordinates[0] as number,
        type: 'earthquake' as EventType,
        title: f.properties.unid
          ? `M${mag.toFixed(1)} — ${f.properties.flynn_region ?? f.properties.place ?? ''}`
          : '지진 감지',
        description: `EMSC 기록 규모 ${mag.toFixed(1)} — ${f.properties.flynn_region ?? ''}`,
        severity: magToSeverity(mag),
        location: f.properties.flynn_region ?? f.properties.place ?? '',
        country: '',
        timestamp: (f.properties.time as string) ?? new Date().toISOString(),
        magnitude: mag,
        source: 'EMSC',
        newsUrl: f.properties.unid
          ? `https://www.seismicportal.eu/eventdetails.html?unid=${f.properties.unid}`
          : undefined,
      }
    })
}

// ─────────────────────────────────────────────────────────
// 3. NASA EONET — Natural events (wildfires, volcanoes …)
// ─────────────────────────────────────────────────────────

const EONET_MAP: Record<string, { type: EventType; severity: Severity }> = {
  wildfires:      { type: 'disaster', severity: 'high'     },
  severeStorms:   { type: 'weather',  severity: 'high'     },
  volcanoes:      { type: 'disaster', severity: 'critical' },
  floods:         { type: 'weather',  severity: 'high'     },
  earthquakes:    { type: 'earthquake', severity: 'medium' },
  drought:        { type: 'weather',  severity: 'medium'   },
  dustHaze:       { type: 'weather',  severity: 'low'      },
  manmadeHazards: { type: 'disaster', severity: 'high'     },
  snow:           { type: 'weather',  severity: 'medium'   },
  tempExtremes:   { type: 'weather',  severity: 'medium'   },
  seaLakeIce:     { type: 'weather',  severity: 'low'      },
}

async function fetchEONET(): Promise<WorldEvent[]> {
  const res = await fetch(
    'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80',
    fetchOpts(300)
  )
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
      lat, lng,
      type: mapped.type,
      title: ev.title as string,
      description: `NASA EONET 감시: ${ev.title} (${ev.categories?.[0]?.title ?? catId})`,
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
// 4. GDELT Geo API — 뉴스 기반 이벤트 (감정 지수 → 심각도)
// ─────────────────────────────────────────────────────────

async function fetchGDELT(query: string, type: EventType): Promise<WorldEvent[]> {
  const url =
    `https://api.gdeltproject.org/api/v2/geo/geo` +
    `?query=${encodeURIComponent(query)}&format=geojson&timespan=24H&maxpoints=40`
  const res = await fetch(url, fetchOpts(300))
  if (!res.ok) return []
  const json = await res.json()
  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const f of (json.features as any[]) ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? [null, null]
    if (!isValidCoord(lat, lng)) continue
    const p = f.properties ?? {}
    const tone: number = typeof p.urltone === 'number' ? p.urltone
                       : typeof p.tone    === 'number' ? p.tone : -5
    const rawDate: string = p.seendate ?? p.date ?? ''
    events.push({
      id: `gdelt-${type}-${(p.url as string | undefined)?.slice(-14) ?? Math.random().toString(36).slice(2)}`,
      lat: lat as number,
      lng: lng as number,
      type,
      title: (p.name ?? p.title ?? query) as string,
      description:
        `감정 지수 ${tone.toFixed(1)} (${tone <= -10 ? '매우 부정' : tone <= -5 ? '부정' : tone <= 0 ? '다소 부정' : '중립'}) | ${p.domain ?? ''}`,
      severity: toneToSeverity(tone),
      location: (p.name ?? '') as string,
      country: (p.countrycode ?? '') as string,
      timestamp: rawDate ? parseGdeltDate(rawDate) : new Date().toISOString(),
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
// 5. ReliefWeb (UN OCHA) — 진행 중 인도주의 재난
// ─────────────────────────────────────────────────────────

const COUNTRY_COORDS: Record<string, readonly [number, number]> = {
  Afghanistan:[33,65],Albania:[41,20],Algeria:[28,2],Angola:[-12,18],
  Argentina:[-34,-64],Armenia:[40,45],Australia:[-25,133],Austria:[47.5,14],
  Azerbaijan:[40.5,47.5],Bangladesh:[24,90],Belarus:[53,28],Belgium:[50.8,4.5],
  Bolivia:[-17,-65],Brazil:[-10,-55],Bulgaria:[43,25],Cambodia:[13,105],
  Cameroon:[6,12],Canada:[60,-96],'Central African Republic':[7,21],Chad:[15,19],
  Chile:[-30,-71],China:[35,105],Colombia:[4,-72],Congo:[-1,15],Cuba:[22,-79.5],
  'Czech Republic':[49.75,15.5],'Democratic Republic of the Congo':[-4,22],
  Denmark:[56,10],Ecuador:[-2,-77.5],Egypt:[26,30],Ethiopia:[8,38],
  Finland:[64,26],France:[46,2],Georgia:[42,43.5],Germany:[51,10],Ghana:[8,-2],
  Greece:[39,22],Guatemala:[15.5,-90.25],Guinea:[11,-10],Haiti:[19,-72.5],
  Honduras:[15,-86.5],Hungary:[47,19],India:[20,77],Indonesia:[-5,120],
  Iran:[32,53],Iraq:[33,44],Ireland:[53,-8],Israel:[31.5,34.75],Italy:[42,12.5],
  'Ivory Coast':[7.5,-5.5],Japan:[36,138],Jordan:[31,36],Kazakhstan:[48,68],
  Kenya:[1,38],Kuwait:[29.5,47.75],Laos:[18,103],Lebanon:[33.85,35.9],
  Libya:[27,17],Malaysia:[2.5,112.5],Mali:[17,-4],Mexico:[23,-102],
  Morocco:[32,-5],Mozambique:[-18,35],Myanmar:[22,96],Nepal:[28,84],
  Netherlands:[52.3,5.3],'New Zealand':[-42,174],Nicaragua:[13,-85],
  Niger:[17,8],Nigeria:[10,8],'North Korea':[40,127],Norway:[64,26],
  Pakistan:[30,70],Palestine:[31.9,35.2],Panama:[9,-80],Peru:[-10,-76],
  Philippines:[13,122],Poland:[52,20],Portugal:[39.5,-8],Romania:[46,25],
  Russia:[60,100],Rwanda:[-2,30],'Saudi Arabia':[24,45],Senegal:[14,-14],
  Serbia:[44,21],Singapore:[1.35,103.82],Somalia:[6,46],'South Africa':[-29,25],
  'South Korea':[36,128],'South Sudan':[7,30],Spain:[40,-4],'Sri Lanka':[7,81],
  Sudan:[15,30],Sweden:[60,15],Switzerland:[47,8],Syria:[35,38],Taiwan:[23.5,121],
  Tanzania:[-6,35],Thailand:[15,100],Tunisia:[34,9],Turkey:[39,35],Uganda:[1,32],
  Ukraine:[49,32],'United Arab Emirates':[24,54],'United Kingdom':[54,-2],
  'United States':[38,-97],Uruguay:[-33,-56],Uzbekistan:[41,64],
  Venezuela:[8,-66],Vietnam:[16,108],Yemen:[15.5,47.5],Zimbabwe:[-20,30],
}

const RW_TYPE: Record<string, EventType> = {
  Flood:'weather',Storm:'weather',Drought:'weather','Cold Wave':'weather',
  'Heat Wave':'weather','Tropical Cyclone':'weather',Earthquake:'earthquake',
  Tsunami:'disaster',Volcano:'disaster',Wildfire:'disaster',Landslide:'disaster',
  Epidemic:'health','Food Insecurity':'health',Conflict:'conflict',Other:'disaster',
}

async function fetchReliefWeb(): Promise<WorldEvent[]> {
  const res = await fetch(
    'https://api.reliefweb.int/v1/disasters' +
    '?appname=boomtrack&limit=30' +
    '&fields[include][]=name&fields[include][]=date.created' +
    '&fields[include][]=country&fields[include][]=primary_type&fields[include][]=status' +
    '&filter[field]=status&filter[value]=ongoing',
    fetchOpts(600)
  )
  const json = await res.json()
  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (json.data as any[]) ?? []) {
    const f = item.fields ?? {}
    const countryName: string = f.country?.[0]?.name ?? ''
    const coords = COUNTRY_COORDS[countryName]
    if (!coords) continue
    const lat = coords[0] + (Math.random() - 0.5) * 4
    const lng = coords[1] + (Math.random() - 0.5) * 4
    const typeName: string = f.primary_type?.name ?? 'Other'
    events.push({
      id: `rw-${item.id}`,
      lat, lng,
      type: RW_TYPE[typeName] ?? 'disaster',
      title: f.name as string,
      description: `ReliefWeb 진행 중 재난: ${f.name} | 유형: ${typeName} | 국가: ${countryName}`,
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
// 6. NOAA — US 활성 기상 경보 (GeoJSON polygon → centroid)
// ─────────────────────────────────────────────────────────

const NOAA_SEV: Record<string, Severity> = {
  Extreme:'critical', Severe:'high', Moderate:'medium', Minor:'low',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function polygonCentroid(geometry: any): [number, number] | null {
  if (!geometry) return null
  let ring: number[][]
  if (geometry.type === 'Polygon')      ring = geometry.coordinates[0]
  else if (geometry.type === 'MultiPolygon') ring = geometry.coordinates[0][0]
  else return null
  if (!ring?.length) return null
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
  const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
  return isValidCoord(lat, lng) ? [lat, lng] : null
}

async function fetchNOAAAlerts(): Promise<WorldEvent[]> {
  const res = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
    ...fetchOpts(180),
    headers: { 'User-Agent': 'BoomTrack/1.0', Accept: 'application/geo+json' },
  })
  const json = await res.json()
  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const feature of (json.features as any[]) ?? []) {
    const centroid = polygonCentroid(feature.geometry)
    if (!centroid) continue
    const p = feature.properties
    const sev = NOAA_SEV[p.severity] ?? 'low'
    if (sev === 'low') continue   // 경미한 것은 제외
    events.push({
      id: `noaa-${feature.id ?? Math.random().toString(36).slice(2)}`,
      lat: centroid[0], lng: centroid[1],
      type: 'weather',
      title: (p.headline ?? p.event ?? '기상 경보') as string,
      description: `${p.event} — ${p.areaDesc ?? ''}. ${(p.description as string | undefined)?.slice(0, 250) ?? ''}`,
      severity: sev,
      location: (p.areaDesc ?? '') as string,
      country: 'United States',
      timestamp: (p.effective ?? new Date().toISOString()) as string,
      source: 'NOAA',
      newsUrl: (p.web as string | undefined) ?? undefined,
    })
  }
  return events.slice(0, 60)
}

// ─────────────────────────────────────────────────────────
// 7. NOAA Space Weather — 태양폭발·지자기폭풍·방사선폭풍
// ─────────────────────────────────────────────────────────

// 오로라 타원대 좌표 (극지방) — 우주기상 이벤트 표시 위치
const AURORA_PTS: [number, number][] = [
  [72,-150],[75,-60],[70,20],[73,80],[68,130],[76,-100],[71,0],[74,60],
  [-72,-150],[-75,-60],[-70,20],[-73,80],[-68,130],[-76,-100],[-71,0],[-74,60],
]

function spaceWeatherSev(msg: string): Severity {
  const u = msg.toUpperCase()
  if (u.includes('X-CLASS') || u.includes('EXTREME') || u.includes('G5') || u.includes('S5') || u.includes('R5')) return 'critical'
  if (u.includes('M-CLASS') || u.includes('SEVERE') || u.includes('G4') || u.includes('G3') || u.includes('S4') || u.includes('R4')) return 'high'
  if (u.includes('C-CLASS') || u.includes('G2') || u.includes('G1') || u.includes('S3') || u.includes('MODERATE')) return 'medium'
  return 'low'
}

function spaceWeatherTitle(msg: string): string {
  const match = msg.match(/(ALERT|WARNING|WATCH|SUMMARY):[^\n]+/i)
  if (match) return match[0].trim().slice(0, 90)
  const first = msg.split('\n').find(l => l.trim().length > 10)
  return first?.trim().slice(0, 90) ?? '우주기상 경보'
}

async function fetchSpaceWeather(): Promise<WorldEvent[]> {
  const res = await fetch('https://services.swpc.noaa.gov/products/alerts.json', fetchOpts(600))
  const json = await res.json()
  const events: WorldEvent[] = []
  let idx = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const alert of (json as any[]).slice(0, 24)) {
    const msg: string = alert.message ?? ''
    const sev = spaceWeatherSev(msg)
    if (sev === 'low') { idx++; continue }
    const [lat, lng] = AURORA_PTS[idx % AURORA_PTS.length]
    events.push({
      id: `space-${alert.product_id ?? idx}`,
      lat, lng,
      type: 'space',
      title: spaceWeatherTitle(msg),
      description: msg.slice(0, 400),
      severity: sev,
      location: '극지방 오로라 지대',
      country: '',
      timestamp: alert.issue_datetime
        ? new Date(alert.issue_datetime as string).toISOString()
        : new Date().toISOString(),
      source: 'NOAA Space Weather',
      newsUrl: 'https://www.spaceweather.gov/',
    })
    idx++
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 8. GDACS — Global Disaster Alert & Coordination System
// ─────────────────────────────────────────────────────────

const GDACS_TYPE: Record<string, EventType> = {
  EQ:'earthquake', TC:'weather', FL:'weather',
  DR:'weather', WF:'disaster', VO:'disaster', TS:'disaster',
}
const GDACS_SEV: Record<string, Severity> = { Red:'critical', Orange:'high', Green:'medium' }

async function fetchGDACS(): Promise<WorldEvent[]> {
  // GDACS public JSON API
  const url = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS' +
    '?eventtype=&alertlevel=&fromdate=&todate=&eventid=0&episodeid=0&limit=50'
  const res = await fetch(url, fetchOpts(600))
  if (!res.ok) return []
  const json = await res.json()
  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const f of (json.features as any[]) ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? [null, null]
    if (!isValidCoord(lat, lng)) continue
    const p = f.properties ?? {}
    const evType = GDACS_TYPE[p.eventtype as string] ?? 'disaster'
    const sev = GDACS_SEV[p.alertlevel as string] ?? 'medium'
    events.push({
      id: `gdacs-${p.eventid}-${p.episodeid}`,
      lat: lat as number, lng: lng as number,
      type: evType,
      title: (p.htmldescription ?? p.name ?? 'GDACS 재난') as string,
      description: `GDACS 경보 수준: ${p.alertlevel} | ${p.eventtype} | ${p.country ?? ''}`,
      severity: sev,
      location: (p.name ?? '') as string,
      country: (p.country ?? '') as string,
      timestamp: p.fromdate
        ? new Date(p.fromdate as string).toISOString()
        : new Date().toISOString(),
      source: 'GDACS',
      newsUrl: p.url as string | undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// Main GET handler
// ─────────────────────────────────────────────────────────

const GDELT_QUERIES: Array<{ query: string; type: EventType }> = [
  { query: 'conflict war attack military assault', type: 'conflict' },
  { query: 'political crisis coup protest demonstration sanctions', type: 'political' },
  { query: 'economic crisis market crash financial bankruptcy recession', type: 'economic' },
  { query: 'epidemic virus disease outbreak pandemic health emergency', type: 'health' },
  { query: 'terrorism bomb explosion suicide attack jihad', type: 'terrorism' },
  { query: 'nuclear radiation radioactive missile warhead', type: 'nuclear' },
  { query: 'refugee migrants asylum border crossing displacement', type: 'migration' },
  { query: 'climate emergency wildfire deforestation pollution oil spill toxic', type: 'environment' },
]

export async function GET() {
  const tasks = [
    fetchUSGS(),
    fetchEMSC(),
    fetchEONET(),
    fetchNOAAAlerts(),
    fetchSpaceWeather(),
    fetchGDACS(),
    fetchReliefWeb(),
    ...GDELT_QUERIES.map(q => fetchGDELT(q.query, q.type)),
  ]

  const settled = await Promise.allSettled(tasks)

  const allEvents: WorldEvent[] = settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<WorldEvent[]>).value)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const sources: Record<string, number> = {}
  for (const e of allEvents) sources[e.source] = (sources[e.source] ?? 0) + 1

  // Log failures for debugging
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const names = ['USGS','EMSC','EONET','NOAA Alerts','Space Weather','GDACS','ReliefWeb',
        ...GDELT_QUERIES.map(q => `GDELT(${q.type})`)]
      console.warn(`[BoomTrack] ${names[i]} 실패:`, (r as PromiseRejectedResult).reason)
    }
  })

  return NextResponse.json({
    events: allEvents,
    total: allEvents.length,
    lastUpdate: new Date().toISOString(),
    sources,
  })
}
