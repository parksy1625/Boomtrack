import { NextResponse } from 'next/server'
import { WorldEvent, EventType, Severity } from '@/lib/types'
import { parseRSSItems } from '@/lib/rssParser'

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
// 4. 국제 뉴스 RSS — Reuters / BBC / Al Jazeera / DW
//    (GDELT 대체: IP 차단 없는 공개 RSS 피드)
// ─────────────────────────────────────────────────────────

/** 기사 텍스트에서 이벤트 유형 자동 분류 */
function typeFromText(text: string): EventType {
  const u = text.toUpperCase()
  if (/EARTHQUAKE|QUAKE|SEISMIC|TREMOR/.test(u))             return 'earthquake'
  if (/FLOOD|HURRICANE|TYPHOON|CYCLONE|STORM|DROUGHT/.test(u)) return 'weather'
  if (/DISEASE|OUTBREAK|EPIDEMIC|PANDEMIC|VIRUS|HEALTH EMERGENCY/.test(u)) return 'health'
  if (/NUCLEAR|RADIATION|REACTOR|RADIOACTIVE/.test(u))       return 'nuclear'
  if (/TERROR|BOMB|BLAST|EXPLOSION|ATTACK|JIHAD/.test(u))    return 'terrorism'
  if (/ECONOMY|MARKET CRASH|FINANCIAL CRISIS|RECESSION|BANKRUPT/.test(u)) return 'economic'
  if (/CLIMATE|POLLUTION|OIL SPILL|DEFORESTATION|WILDFIRE/.test(u)) return 'environment'
  if (/REFUGEE|MIGRANT|ASYLUM|DISPLACEMENT/.test(u))         return 'migration'
  if (/WAR|CONFLICT|MILITARY|TROOPS|INVASION|BATTLE/.test(u)) return 'conflict'
  if (/COUP|PROTEST|SANCTION|ELECTION FRAUD/.test(u))        return 'political'
  return 'political'
}

const NEWS_FEEDS: Array<{ url: string; name: string }> = [
  // ── 서유럽·미국 ──────────────────────────────────────────
  { url: 'https://feeds.reuters.com/Reuters/worldNews',                name: 'Reuters' },
  { url: 'https://feeds.reuters.com/reuters/businessNews',             name: 'Reuters Business' },
  { url: 'https://feeds.reuters.com/reuters/healthNews',               name: 'Reuters Health' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',               name: 'BBC' },
  { url: 'https://www.theguardian.com/world/rss',                      name: 'Guardian' },
  { url: 'https://rss.dw.com/xml/rss-en-world',                        name: 'DW' },
  { url: 'https://www.euronews.com/rss?format=mrss',                   name: 'Euronews' },
  { url: 'https://www.france24.com/en/rss',                            name: 'France 24' },
  // ── 북미 ─────────────────────────────────────────────────
  { url: 'https://www.cbc.ca/cmlink/rss-world',                        name: 'CBC Canada' },
  // ── 중동·아랍 ────────────────────────────────────────────
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',                  name: 'Al Jazeera' },
  { url: 'https://www.arabnews.com/rss.xml',                           name: 'Arab News' },
  { url: 'https://www.trtworld.com/rss',                               name: 'TRT World' },
  // ── 아시아·태평양 ────────────────────────────────────────
  { url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/rss.xml',      name: 'NHK World' },
  { url: 'https://japantimes.co.jp/rss.xml',                           name: 'Japan Times' },
  { url: 'https://en.yna.co.kr/RSS/news.xml',                          name: 'Yonhap' },
  { url: 'https://www.abc.net.au/news/feed/51120/rss.xml',             name: 'ABC Australia' },
  { url: 'https://www.bangkokpost.com/rss/data/world.xml',             name: 'Bangkok Post' },
  // ── 남아시아 ─────────────────────────────────────────────
  { url: 'https://www.thehindu.com/news/international/?service=rss',   name: 'The Hindu' },
  { url: 'https://timesofindia.indiatimes.com/rss/world.cms',          name: 'Times of India' },
  { url: 'https://www.dawn.com/feeds/latest-news',                     name: 'Dawn' },
  // ── 아프리카 ─────────────────────────────────────────────
  { url: 'https://allafrica.com/tools/headlines/rss/latest/full.rss',  name: 'AllAfrica' },
  // ── 국제기구 ─────────────────────────────────────────────
  { url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',     name: 'UN News' },
  // ── 북미·중남미 ──────────────────────────────────────────
  { url: 'https://feeds.npr.org/1004/rss.xml',                         name: 'NPR' },
  { url: 'https://en.mercopress.com/rss',                              name: 'Mercopress' },
  // ── 유럽 ─────────────────────────────────────────────────
  { url: 'https://www.spiegel.de/international/index.rss',             name: 'Der Spiegel' },
  { url: 'https://www.politico.eu/feed/',                              name: 'Politico Europe' },
  { url: 'https://www.kyivindependent.com/feed/',                      name: 'Kyiv Independent' },
  { url: 'https://www.ukrinform.net/rss/block-lastnews',               name: 'Ukrinform' },
  { url: 'https://tass.com/rss/v2.xml',                                name: 'TASS' },
  // ── 중동 ─────────────────────────────────────────────────
  { url: 'https://www.jpost.com/Rss/RssFeedsHeadlines.aspx',          name: 'Jerusalem Post' },
  { url: 'https://www.thenationalnews.com/rss',                        name: 'The National' },
  { url: 'https://www.middleeasteye.net/rss',                          name: 'Middle East Eye' },
  // ── 동남아시아 ───────────────────────────────────────────
  { url: 'https://www.channelnewsasia.com/rss/latest_news',            name: 'CNA' },
  { url: 'https://www.straitstimes.com/news/world/rss.xml',            name: 'Straits Times' },
  { url: 'https://asiatimes.com/feed/',                                name: 'Asia Times' },
  // ── 동북아시아 ───────────────────────────────────────────
  { url: 'https://english.kyodonews.net/rss/news.xml',                 name: 'Kyodo News' },
  { url: 'https://www.koreaherald.com/rss/index.htm',                  name: 'Korea Herald' },
  { url: 'https://www.scmp.com/rss/91/feed',                           name: 'SCMP' },
  // ── 오세아니아 ───────────────────────────────────────────
  { url: 'https://www.rnz.co.nz/rss/world.xml',                        name: 'RNZ' },
  // ── 아프리카 (추가) ──────────────────────────────────────
  { url: 'https://www.premiumtimesng.com/feed',                        name: 'Premium Times' },
  // ── 추가 언론사 ──────────────────────────────────────────
  { url: 'https://www.voanews.com/api/zivqrkrvil',                     name: 'VOA News' },
  { url: 'https://www.rferl.org/api/epiqxqim',                        name: 'RFE/RL' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',              name: 'Sky News' },
  { url: 'https://english.alaraby.co.uk/rss.xml',                     name: 'The New Arab' },
  { url: 'https://www.aa.com.tr/en/rss/default?cat=world',             name: 'Anadolu Agency' },
  { url: 'https://www.globaltimes.cn/rss/world.xml',                   name: 'Global Times' },
  { url: 'https://www.thenewhumanitarian.org/rss.xml',                 name: 'New Humanitarian' },
  { url: 'https://thediplomat.com/feed/',                              name: 'The Diplomat' },
  { url: 'https://www.thehindu.com/sci-tech/health/feeder/default.rss', name: 'The Hindu Health' },
  { url: 'https://tribune.com.pk/feed',                                name: 'Express Tribune' },
]

async function fetchNewsFeed(feedUrl: string, sourceName: string): Promise<WorldEvent[]> {
  const res = await fetch(feedUrl, {
    ...fetchOpts(300),
    headers: { 'User-Agent': 'BoomTrack/1.0', Accept: 'application/rss+xml, application/xml, text/xml' },
  })
  if (!res.ok) return []
  const xml = await res.text()
  const items = parseRSSItems(xml)
  const events: WorldEvent[] = []
  for (const item of items.slice(0, 20)) {
    const text = item.title + ' ' + item.description
    // geo 태그 우선, 없으면 텍스트에서 국가 추출
    let lat = item.geoLat
    let lng = item.geoLng
    let country = ''
    if (!lat || !lng || !isValidCoord(lat, lng)) {
      const found = coordsFromText(text)
      if (!found) continue
      lat = found[0] + (Math.random() - 0.5) * found[3]
      lng = found[1] + (Math.random() - 0.5) * found[3]
      country = found[2]
    }
    if (!isValidCoord(lat, lng)) continue
    const type = typeFromText(text)
    events.push({
      id: `news-${sourceName.toLowerCase().replace(/\s/g,'-')}-${(item.link ?? '').slice(-16) || Math.random().toString(36).slice(2)}`,
      lat, lng,
      type,
      title: item.title || `${sourceName} 뉴스`,
      description: item.description.slice(0, 300),
      severity: 'medium',
      location: country,
      country,
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      source: sourceName,
      newsUrl: item.link || undefined,
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
  // 복잡한 필터 제거 → 단순 최신순 조회 (GET)
  const url =
    'https://api.reliefweb.int/v1/disasters' +
    '?appname=boomtrack&limit=30&sort[]=date:desc' +
    '&fields[include][]=name&fields[include][]=date.created' +
    '&fields[include][]=country&fields[include][]=primary_type'
  const res = await fetch(url, {
    ...fetchOpts(600),
    headers: { 'User-Agent': 'BoomTrack/1.0', Accept: 'application/json' },
  })
  if (!res.ok) return []
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
  // GDACS RSS feed (JSON API보다 안정적)
  const res = await fetch('https://www.gdacs.org/xml/rss.xml', {
    ...fetchOpts(600),
    headers: { 'User-Agent': 'BoomTrack/1.0' },
  })
  if (!res.ok) return []
  const xml = await res.text()
  const items = parseRSSItems(xml)
  const events: WorldEvent[] = []
  for (const item of items.slice(0, 40)) {
    if (!item.geoLat || !item.geoLng || !isValidCoord(item.geoLat, item.geoLng)) continue
    const upper = (item.title + ' ' + item.description).toUpperCase()
    let evType: EventType = 'disaster'
    if (upper.includes('EARTHQUAKE')) evType = 'earthquake'
    else if (upper.includes('FLOOD') || upper.includes('CYCLONE') || upper.includes('TROPICAL') || upper.includes('HURRICANE')) evType = 'weather'
    const sev: Severity =
      upper.includes('RED')    ? 'critical' :
      upper.includes('ORANGE') ? 'high'     : 'medium'
    // GDACS_TYPE 재활용 (기존 키워드 기반)
    const typeFromTitle = Object.entries(GDACS_TYPE).find(([k]) =>
      upper.includes(k.toUpperCase())
    )
    if (typeFromTitle) evType = typeFromTitle[1]
    events.push({
      id: `gdacs-${(item.link ?? '').slice(-24) || Math.random().toString(36).slice(2)}`,
      lat: item.geoLat, lng: item.geoLng,
      type: evType,
      title: item.title || 'GDACS 재난',
      description: item.description.slice(0, 300),
      severity: sev,
      location: '',
      country: '',
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      source: 'GDACS',
      newsUrl: item.link || undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 9. FEMA — 미국 연방재난관리청 재난선포
// ─────────────────────────────────────────────────────────

const US_STATE_COORDS: Record<string, readonly [number, number]> = {
  AL:[32.8,-86.8], AK:[64.2,-153], AZ:[34.3,-111.1], AR:[34.8,-92.2],
  CA:[36.8,-119.4], CO:[39.0,-105.5], CT:[41.6,-72.7], DE:[38.9,-75.5],
  FL:[27.8,-81.6], GA:[32.2,-83.4], HI:[20.1,-156.3], ID:[44.2,-114.5],
  IL:[40.3,-89.0], IN:[39.8,-86.1], IA:[41.9,-93.3], KS:[38.5,-98.4],
  KY:[37.5,-85.3], LA:[31.2,-92.1], ME:[45.3,-69.2], MD:[38.9,-76.7],
  MA:[42.2,-71.5], MI:[44.3,-85.4], MN:[46.4,-93.1], MS:[32.7,-89.7],
  MO:[38.4,-92.5], MT:[46.9,-110.5], NE:[41.5,-99.9], NV:[39.5,-116.9],
  NH:[43.7,-71.6], NJ:[40.1,-74.5], NM:[34.5,-106.1], NY:[42.9,-75.5],
  NC:[35.5,-79.8], ND:[47.5,-100.5], OH:[40.2,-82.8], OK:[35.6,-97.5],
  OR:[44.1,-120.5], PA:[40.9,-77.8], RI:[41.7,-71.5], SC:[33.9,-80.9],
  SD:[44.4,-100.2], TN:[35.9,-86.5], TX:[31.5,-99.3], UT:[39.4,-111.1],
  VT:[44.1,-72.7], VA:[37.8,-79.5], WA:[47.4,-120.5], WV:[38.7,-80.6],
  WI:[44.3,-89.8], WY:[43.0,-107.6],
}

const FEMA_TYPE: Record<string, EventType> = {
  Flood:'weather', Hurricane:'weather', Tornado:'weather', 'Winter Storm':'weather',
  'Severe Storm':'weather', Drought:'weather', Fire:'disaster', Earthquake:'earthquake',
  Tsunami:'disaster', Biological:'health', Chemical:'disaster', Explosion:'terrorism',
  'Snow':'weather', 'Coastal Storm':'weather', 'Typhoon':'weather',
}

async function fetchFEMA(): Promise<WorldEvent[]> {
  // $select 제거 — 파라미터 인코딩 문제 방지
  const url =
    'https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries' +
    '?%24orderby=declarationDate%20desc&%24top=20&%24format=json'
  const res = await fetch(url, {
    ...fetchOpts(600),
    headers: { 'User-Agent': 'BoomTrack/1.0', Accept: 'application/json' },
  })
  if (!res.ok) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json() as any
  const events: WorldEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (json.DisasterDeclarationsSummaries as any[]) ?? []) {
    const coords = US_STATE_COORDS[item.state as string]
    if (!coords) continue
    const lat = coords[0] + (Math.random() - 0.5) * 2
    const lng = coords[1] + (Math.random() - 0.5) * 2
    const incType: string = item.incidentType ?? 'Other'
    events.push({
      id: `fema-${item.disasterNumber}`,
      lat, lng,
      type: FEMA_TYPE[incType] ?? 'disaster',
      title: item.declarationTitle as string,
      description: `FEMA 재난선포: ${item.declarationTitle} | 유형: ${incType} | 주(州): ${item.state}`,
      severity: 'high',
      location: item.state as string,
      country: 'United States',
      timestamp: item.declarationDate
        ? new Date(item.declarationDate as string).toISOString()
        : new Date().toISOString(),
      source: 'FEMA',
      newsUrl: `https://www.fema.gov/disaster/${item.disasterNumber}`,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 10. FloodList — 전세계 홍수 뉴스 (RSS)
// ─────────────────────────────────────────────────────────

/** 주요 도시 좌표 DB — 국가 수준보다 훨씬 정밀한 위치 표시 */
const CITY_COORDS: Record<string, readonly [number, number]> = {
  // 동북아시아
  'Tokyo':[35.68,139.69],'Osaka':[34.69,135.50],'Kyoto':[35.01,135.77],'Hiroshima':[34.39,132.45],
  'Beijing':[39.91,116.39],'Shanghai':[31.23,121.47],'Guangzhou':[23.13,113.27],'Shenzhen':[22.54,114.06],
  'Chongqing':[29.56,106.55],'Wuhan':[30.59,114.31],'Chengdu':[30.57,104.07],'Tianjin':[39.13,117.18],
  'Hong Kong':[22.32,114.17],'Macau':[22.20,113.55],
  'Seoul':[37.57,126.98],'Busan':[35.18,129.08],'Incheon':[37.46,126.71],
  'Taipei':[25.05,121.53],'Kaohsiung':[22.63,120.27],
  'Pyongyang':[39.02,125.75],
  'Ulaanbaatar':[47.91,106.91],
  // 동남아시아
  'Bangkok':[13.75,100.52],'Chiang Mai':[18.79,98.98],'Pattaya':[12.93,100.88],
  'Singapore':[1.35,103.82],
  'Kuala Lumpur':[3.14,101.69],'Penang':[5.41,100.33],'Johor Bahru':[1.46,103.74],
  'Jakarta':[-6.21,106.85],'Surabaya':[-7.25,112.75],'Bali':[-8.34,115.09],'Medan':[3.60,98.68],
  'Manila':[14.60,120.98],'Cebu':[10.32,123.90],'Davao':[7.07,125.61],
  'Hanoi':[21.03,105.85],'Ho Chi Minh City':[10.82,106.63],'Ho Chi Minh':[10.82,106.63],'Da Nang':[16.05,108.22],
  'Phnom Penh':[11.57,104.92],'Siem Reap':[13.36,103.86],
  'Vientiane':[17.97,102.60],
  'Yangon':[16.87,96.17],'Naypyidaw':[19.76,96.07],'Mandalay':[21.97,96.08],
  'Bandar Seri Begawan':[4.94,114.95],
  'Dili':[-8.56,125.58],
  // 남아시아
  'New Delhi':[28.61,77.21],'Delhi':[28.66,77.23],'Mumbai':[19.08,72.88],'Kolkata':[22.57,88.36],
  'Chennai':[13.08,80.27],'Bangalore':[12.97,77.59],'Hyderabad':[17.38,78.49],
  'Ahmedabad':[23.03,72.59],'Pune':[18.52,73.86],'Jaipur':[26.91,75.79],
  'Dhaka':[23.72,90.41],'Chittagong':[22.34,91.83],
  'Karachi':[24.86,67.01],'Lahore':[31.55,74.35],'Islamabad':[33.72,73.04],'Peshawar':[34.01,71.57],
  'Kathmandu':[27.71,85.32],
  'Colombo':[6.93,79.86],
  'Kabul':[34.53,69.17],'Kandahar':[31.61,65.71],'Herat':[34.34,62.20],
  'Malé':[4.18,73.51],
  // 중앙아시아·코카서스
  'Tashkent':[41.30,69.24],'Almaty':[43.22,76.85],'Nur-Sultan':[51.13,71.43],'Astana':[51.13,71.43],
  'Bishkek':[42.87,74.59],'Dushanbe':[38.56,68.77],'Ashgabat':[37.95,58.38],
  'Baku':[40.41,49.87],'Yerevan':[40.18,44.51],'Tbilisi':[41.69,44.83],
  // 중동
  'Tehran':[35.69,51.39],'Isfahan':[32.66,51.68],'Mashhad':[36.30,59.60],
  'Baghdad':[33.34,44.40],'Basra':[30.51,47.79],'Mosul':[36.34,43.13],'Erbil':[36.19,44.01],
  'Riyadh':[24.69,46.72],'Jeddah':[21.49,39.19],'Mecca':[21.39,39.86],'Medina':[24.47,39.61],
  'Istanbul':[41.01,28.95],'Ankara':[39.93,32.86],'Izmir':[38.42,27.14],'Adana':[37.01,35.32],
  'Tel Aviv':[32.09,34.78],'Jerusalem':[31.78,35.22],'Haifa':[32.82,34.99],
  'Beirut':[33.89,35.50],'Tripoli':[34.44,35.85],
  'Damascus':[33.51,36.29],'Aleppo':[36.20,37.16],'Homs':[34.72,36.71],
  'Amman':[31.96,35.95],'Zarqa':[32.07,36.09],
  'Gaza':[31.50,34.47],'Ramallah':[31.90,35.21],'Hebron':[31.53,35.10],
  'Dubai':[25.20,55.27],'Abu Dhabi':[24.45,54.37],'Sharjah':[25.34,55.39],
  'Doha':[25.29,51.53],
  'Kuwait City':[29.37,47.98],
  "Sana'a":[15.35,44.21],'Aden':[12.78,45.04],'Hudaydah':[14.80,43.00],
  'Muscat':[23.61,58.59],
  'Manama':[26.22,50.58],
  // 유럽 서부
  'London':[51.51,-0.13],'Birmingham':[52.49,-1.90],'Manchester':[53.48,-2.24],'Glasgow':[55.86,-4.25],
  'Paris':[48.85,2.35],'Lyon':[45.75,4.83],'Marseille':[43.30,5.37],'Toulouse':[43.60,1.44],
  'Berlin':[52.52,13.40],'Hamburg':[53.57,10.02],'Munich':[48.14,11.58],'Frankfurt':[50.11,8.68],'Cologne':[50.94,6.96],
  'Madrid':[40.42,-3.70],'Barcelona':[41.39,2.15],'Valencia':[39.47,-0.38],'Seville':[37.39,-5.99],
  'Rome':[41.90,12.49],'Milan':[45.47,9.19],'Naples':[40.85,14.27],'Turin':[45.07,7.69],
  'Amsterdam':[52.37,4.90],'Rotterdam':[51.92,4.48],'The Hague':[52.08,4.32],
  'Brussels':[50.85,4.35],'Antwerp':[51.22,4.40],
  'Vienna':[48.21,16.37],'Graz':[47.07,15.44],
  'Zurich':[47.38,8.54],'Geneva':[46.20,6.15],'Bern':[46.95,7.45],
  'Stockholm':[59.33,18.07],'Gothenburg':[57.71,11.97],
  'Oslo':[59.91,10.75],'Bergen':[60.39,5.32],
  'Copenhagen':[55.68,12.57],
  'Helsinki':[60.17,24.94],'Espoo':[60.21,24.66],
  'Lisbon':[38.72,-9.14],'Porto':[41.16,-8.63],
  'Dublin':[53.33,-6.25],'Cork':[51.90,-8.47],
  'Reykjavik':[64.14,-21.95],
  // 유럽 중·동부
  'Warsaw':[52.23,21.01],'Krakow':[50.06,19.94],'Gdansk':[54.35,18.65],'Wroclaw':[51.11,17.04],
  'Prague':[50.08,14.43],'Brno':[49.20,16.61],
  'Budapest':[47.50,19.04],'Debrecen':[47.53,21.63],
  'Bucharest':[44.43,26.10],'Cluj-Napoca':[46.77,23.59],
  'Belgrade':[44.82,20.46],'Novi Sad':[45.26,19.83],
  'Sofia':[42.70,23.32],'Plovdiv':[42.15,24.75],
  'Athens':[37.97,23.73],'Thessaloniki':[40.64,22.94],
  'Zagreb':[45.81,15.98],'Split':[43.51,16.44],'Dubrovnik':[42.65,18.09],
  'Ljubljana':[46.05,14.51],
  'Bratislava':[48.15,17.11],
  'Sarajevo':[43.85,18.36],'Mostar':[43.35,17.81],
  'Tirana':[41.33,19.83],
  'Skopje':[41.99,21.43],
  'Podgorica':[42.44,19.26],
  'Pristina':[42.67,21.17],
  'Valletta':[35.90,14.51],
  'Nicosia':[35.17,33.37],
  // 구소련 유럽 지역
  'Kyiv':[50.45,30.52],'Kiev':[50.45,30.52],'Kharkiv':[49.99,36.23],
  'Odessa':[46.48,30.73],'Dnipro':[48.46,35.04],'Zaporizhzhia':[47.84,35.14],
  'Lviv':[49.84,24.03],'Mariupol':[47.11,37.54],'Kherson':[46.64,32.62],
  'Moscow':[55.75,37.62],'Saint Petersburg':[59.93,30.32],'St. Petersburg':[59.93,30.32],
  'Novosibirsk':[54.99,82.90],'Yekaterinburg':[56.84,60.60],'Kazan':[55.79,49.12],
  'Vladivostok':[43.12,131.88],'Murmansk':[68.97,33.09],
  'Minsk':[53.90,27.57],
  'Chisinau':[47.00,28.86],
  'Riga':[56.95,24.11],'Tallinn':[59.44,24.75],'Vilnius':[54.69,25.28],
  // 아프리카 북부
  'Cairo':[30.06,31.25],'Alexandria':[31.20,29.92],'Giza':[30.01,31.21],
  'Tunis':[36.82,10.17],'Sfax':[34.74,10.76],
  'Algiers':[36.73,3.09],'Oran':[35.70,-0.64],
  'Casablanca':[33.59,-7.62],'Rabat':[34.01,-6.83],'Marrakech':[31.63,-7.99],'Fez':[34.04,-5.00],
  'Tripoli Libya':[32.90,13.18],'Benghazi':[32.12,20.07],
  'Khartoum':[15.55,32.53],'Omdurman':[15.65,32.48],'Port Sudan':[19.62,37.22],
  // 아프리카 사하라 이남
  'Lagos':[6.45,3.40],'Abuja':[9.07,7.40],'Kano':[12.00,8.52],'Port Harcourt':[4.77,7.01],'Ibadan':[7.39,3.90],
  'Nairobi':[-1.29,36.82],'Mombasa':[-4.05,39.67],'Kisumu':[-0.10,34.75],
  'Johannesburg':[-26.20,28.04],'Cape Town':[-33.93,18.42],'Durban':[-29.86,31.02],'Pretoria':[-25.75,28.19],
  'Addis Ababa':[9.03,38.74],'Dire Dawa':[9.59,41.86],
  'Kinshasa':[-4.32,15.32],'Lubumbashi':[-11.67,27.47],'Goma':[-1.68,29.22],
  'Mogadishu':[2.05,45.34],
  'Accra':[5.55,-0.20],'Kumasi':[6.69,-1.62],
  'Dakar':[14.72,-17.47],
  'Abidjan':[5.36,-4.01],
  'Kampala':[0.32,32.58],
  'Dar es Salaam':[-6.79,39.27],'Dodoma':[-6.17,35.74],
  'Harare':[-17.83,31.05],'Bulawayo':[-20.15,28.58],
  'Lusaka':[-15.42,28.28],'Ndola':[-12.97,28.63],
  'Maputo':[-25.97,32.59],
  'Antananarivo':[-18.91,47.54],
  'Bamako':[12.65,-8.00],
  'Ouagadougou':[12.37,-1.52],
  'Niamey':[13.51,2.12],
  "N'Djamena":[12.11,15.04],
  'Bangui':[4.36,18.56],
  'Brazzaville':[-4.27,15.28],
  'Luanda':[-8.84,13.23],'Huambo':[-12.78,15.74],
  'Windhoek':[-22.56,17.08],
  'Gaborone':[-24.65,25.91],
  'Juba':[4.86,31.60],
  'Kigali':[-1.95,30.06],
  'Bujumbura':[-3.39,29.36],
  'Freetown':[8.49,-13.23],
  'Monrovia':[6.30,-10.80],
  'Conakry':[9.54,-13.68],
  'Djibouti':[11.59,43.15],
  'Asmara':[15.33,38.93],
  'Lome':[6.14,1.22],
  'Cotonou':[6.37,2.43],
  'Malabo':[3.75,8.78],
  'Libreville':[0.39,9.45],
  // 북미
  'New York':[40.71,-74.01],'Los Angeles':[34.05,-118.24],'Chicago':[41.85,-87.65],
  'Houston':[29.76,-95.37],'Phoenix':[33.45,-112.07],'Philadelphia':[39.95,-75.16],
  'San Antonio':[29.43,-98.49],'San Diego':[32.72,-117.16],'Dallas':[32.79,-96.80],
  'San Francisco':[37.77,-122.42],'Seattle':[47.61,-122.33],'Denver':[39.74,-104.99],
  'Washington':[38.91,-77.04],'Washington DC':[38.91,-77.04],'Washington D.C.':[38.91,-77.04],
  'Miami':[25.77,-80.19],'Atlanta':[33.75,-84.39],'Boston':[42.36,-71.06],
  'Las Vegas':[36.17,-115.14],'Portland':[45.52,-122.68],'Nashville':[36.17,-86.78],
  'Baltimore':[39.29,-76.61],'Minneapolis':[44.98,-93.27],'New Orleans':[29.95,-90.07],
  'Toronto':[43.70,-79.42],'Vancouver':[49.25,-123.12],'Montreal':[45.51,-73.55],
  'Ottawa':[45.42,-75.69],'Calgary':[51.05,-114.08],'Edmonton':[53.55,-113.49],'Winnipeg':[49.90,-97.14],
  'Mexico City':[19.43,-99.13],'Guadalajara':[20.68,-103.35],'Monterrey':[25.68,-100.32],
  'Tijuana':[32.52,-117.04],'Cancún':[21.16,-86.85],
  // 중남미
  'São Paulo':[-23.55,-46.63],'Rio de Janeiro':[-22.91,-43.17],'Brasília':[-15.78,-47.93],
  'Salvador':[-12.97,-38.50],'Fortaleza':[-3.73,-38.52],'Belo Horizonte':[-19.92,-43.94],
  'Manaus':[-3.10,-60.02],'Recife':[-8.05,-34.88],'Porto Alegre':[-30.03,-51.23],
  'Buenos Aires':[-34.61,-58.38],'Córdoba':[-31.42,-64.18],'Rosario':[-32.95,-60.66],
  'Santiago':[-33.46,-70.65],'Valparaíso':[-33.05,-71.62],
  'Lima':[-12.05,-77.04],'Arequipa':[-16.41,-71.54],
  'Bogotá':[4.71,-74.07],'Medellín':[6.25,-75.56],'Cali':[3.44,-76.52],
  'Caracas':[10.48,-66.88],'Maracaibo':[10.67,-71.61],
  'Quito':[-0.23,-78.52],'Guayaquil':[-2.19,-79.89],
  'La Paz':[-16.50,-68.15],'Santa Cruz':[-17.79,-63.18],
  'Asunción':[-25.29,-57.64],
  'Montevideo':[-34.90,-56.19],
  'Havana':[23.13,-82.38],
  'Panama City':[8.99,-79.52],
  'San José':[9.93,-84.08],
  'Tegucigalpa':[14.10,-87.21],
  'Managua':[12.13,-86.28],
  'Guatemala City':[14.63,-90.51],
  'San Salvador':[13.69,-89.19],
  'Port-au-Prince':[18.54,-72.34],'Santo Domingo':[18.50,-69.99],
  'Kingston':[17.99,-76.79],
  // 오세아니아
  'Sydney':[-33.87,151.21],'Melbourne':[-37.81,144.96],'Brisbane':[-27.47,153.03],
  'Perth':[-31.95,115.86],'Adelaide':[-34.93,138.60],'Canberra':[-35.28,149.13],
  'Auckland':[-36.85,174.76],'Wellington':[-41.29,174.78],'Christchurch':[-43.53,172.64],
  'Suva':[-18.14,178.44],'Port Moresby':[-9.44,147.18],'Honiara':[-9.43,160.05],
}

/** 텍스트에서 위치 추출 (뉴스 데이트라인 → 도시 → 국가 순)
 *  반환: [lat, lng, 장소명, jitter반경(도)] */
function coordsFromText(text: string): readonly [number, number, string, number] | null {
  // 1. 뉴스 데이트라인: "MOSCOW (Reuters) -" / "KYIV, Ukraine —" 형태
  const dl = text.match(/^([A-Z][A-Z '.()-]{1,28}?)(?:,\s*[A-Za-z ]+?)?\s*(?:\([^)]+\)\s*)?[-–—]/)
  if (dl) {
    const raw = dl[1].trim()
    for (const [name, c] of Object.entries(CITY_COORDS)) {
      if (raw.toUpperCase() === name.toUpperCase()) return [c[0], c[1], name, 0.12]
    }
  }
  // 2. 전체 텍스트에서 도시명 (긴 이름 우선 → 더 구체적)
  const sortedCities = Object.entries(CITY_COORDS).sort((a, b) => b[0].length - a[0].length)
  for (const [name, c] of sortedCities) {
    if (text.includes(name)) return [c[0], c[1], name, 0.12]
  }
  // 3. 국가명 폴백
  for (const [name, c] of Object.entries(COUNTRY_COORDS)) {
    if (text.includes(name)) return [c[0], c[1], name, 2.5]
  }
  return null
}

async function fetchFloodList(): Promise<WorldEvent[]> {
  const res = await fetch('https://floodlist.com/feed', {
    ...fetchOpts(600),
    headers: { 'User-Agent': 'BoomTrack/1.0' },
  })
  if (!res.ok) return []
  const xml = await res.text()
  const items = parseRSSItems(xml)
  const events: WorldEvent[] = []
  for (const item of items.slice(0, 20)) {
    let lat = item.geoLat
    let lng = item.geoLng
    let country = ''
    if (!lat || !lng || !isValidCoord(lat, lng)) {
      const found = coordsFromText(item.title + ' ' + item.description)
      if (!found) continue
      lat = found[0] + (Math.random() - 0.5) * found[3]
      lng = found[1] + (Math.random() - 0.5) * found[3]
      country = found[2]
    }
    if (!isValidCoord(lat, lng)) continue
    events.push({
      id: `flood-${(item.link ?? '').slice(-20) || Math.random().toString(36).slice(2)}`,
      lat, lng,
      type: 'weather',
      title: item.title || '홍수 뉴스',
      description: item.description.slice(0, 300),
      severity: 'high',
      location: country,
      country,
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      source: 'FloodList',
      newsUrl: item.link || undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 11. WHO — 세계보건기구 질병발생·긴급보건 뉴스 (RSS)
// ─────────────────────────────────────────────────────────

const WHO_KEYWORDS =
  /outbreak|epidemic|alert|emergency|disease|virus|cholera|ebola|mpox|dengue|measles|influenza|plague|rabies|avian|health crisis|pandemic/i

async function fetchWHO(): Promise<WorldEvent[]> {
  const res = await fetch('https://www.who.int/rss-feeds/news-english.xml', {
    ...fetchOpts(600),
    headers: { 'User-Agent': 'BoomTrack/1.0' },
  })
  if (!res.ok) return []
  const xml = await res.text()
  const items = parseRSSItems(xml)
  const events: WorldEvent[] = []
  for (const item of items.slice(0, 30)) {
    const text = item.title + ' ' + item.description
    if (!WHO_KEYWORDS.test(text)) continue
    const found = coordsFromText(text)
    if (!found) continue
    const lat = found[0] + (Math.random() - 0.5) * found[3]
    const lng = found[1] + (Math.random() - 0.5) * found[3]
    if (!isValidCoord(lat, lng)) continue
    events.push({
      id: `who-${(item.link ?? '').slice(-20) || Math.random().toString(36).slice(2)}`,
      lat, lng,
      type: 'health',
      title: item.title || 'WHO 보건 경보',
      description: item.description.slice(0, 300),
      severity: 'high',
      location: found[2],
      country: found[2],
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      source: 'WHO',
      newsUrl: item.link || undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 12. PTWC — 태평양 쓰나미 경보 센터 (RSS)
// ─────────────────────────────────────────────────────────

/** 다양한 형태의 좌표 문자열 파싱
 *  지원: "19.4N 155.3W" / "LAT 19.4 LON -155.3" / "-19.4, 155.3" */
function parseTsunamiCoords(text: string): [number, number] | null {
  // 패턴1: 19.4N 155.3W
  let m = text.match(/(\d+\.?\d*)\s*([NS])[,\s]+(\d+\.?\d*)\s*([EW])/i)
  if (m) {
    const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1)
    const lng = parseFloat(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1)
    if (isValidCoord(lat, lng)) return [lat, lng]
  }
  // 패턴2: LAT 19.4 LON -155.3
  m = text.match(/LAT(?:ITUDE)?\s*[:=]?\s*(-?\d+\.?\d*)[,\s]+LON(?:GITUDE)?\s*[:=]?\s*(-?\d+\.?\d*)/i)
  if (m) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2])
    if (isValidCoord(lat, lng)) return [lat, lng]
  }
  // 패턴3: LOCATION -19.4 155.3
  m = text.match(/LOCATION\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/i)
  if (m) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2])
    if (isValidCoord(lat, lng)) return [lat, lng]
  }
  return null
}

async function fetchPTWC(): Promise<WorldEvent[]> {
  // 태평양 + 인도양 두 피드를 병렬로 가져옴
  const feeds = [
    'https://ptwc.weather.gov/feeds/ptwc_rss_pacific.xml',
    'https://ptwc.weather.gov/feeds/ptwc_rss_indian.xml',
  ]
  const xmlList = await Promise.allSettled(
    feeds.map(url =>
      fetch(url, { ...fetchOpts(300), headers: { 'User-Agent': 'BoomTrack/1.0' } })
        .then(r => (r.ok ? r.text() : ''))
    )
  )
  const events: WorldEvent[] = []
  for (const result of xmlList) {
    if (result.status !== 'fulfilled' || !result.value) continue
    const items = parseRSSItems(result.value)
    for (const item of items.slice(0, 10)) {
      let lat = item.geoLat
      let lng = item.geoLng
      if (!lat || !lng || !isValidCoord(lat, lng)) {
        const coords = parseTsunamiCoords(item.title + ' ' + item.description)
        if (!coords) continue
        ;[lat, lng] = coords
      }
      const upper = (item.title + ' ' + item.description).toUpperCase()
      const severity: Severity =
        upper.includes('WARNING') ? 'critical' :
        upper.includes('WATCH')   ? 'high'     : 'medium'
      events.push({
        id: `ptwc-${(item.link ?? '').slice(-20) || Math.random().toString(36).slice(2)}`,
        lat, lng,
        type: 'disaster',
        title: item.title || '쓰나미 경보',
        description: item.description.slice(0, 300),
        severity,
        location: '쓰나미 경보 구역',
        country: '',
        timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        source: 'PTWC',
        newsUrl: item.link || undefined,
      })
    }
  }
  return events
}

// ─────────────────────────────────────────────────────────
// 13. IAEA — 국제원자력기구 핵·방사능 뉴스 (RSS)
// ─────────────────────────────────────────────────────────

async function fetchIAEA(): Promise<WorldEvent[]> {
  // 키워드 필터 제거 — IAEA 뉴스 자체가 핵·방사능 관련
  // 국가 미언급 기사는 IAEA 본부(오스트리아 빈) 좌표 사용
  const IAEA_HQ: [number, number] = [48.23, 16.36]
  const res = await fetch('https://www.iaea.org/newscenter/news/news-rss.xml', {
    ...fetchOpts(600),
    headers: { 'User-Agent': 'BoomTrack/1.0', Accept: 'application/rss+xml, text/xml' },
  })
  if (!res.ok) return []
  const xml = await res.text()
  const items = parseRSSItems(xml)
  const events: WorldEvent[] = []
  for (const item of items.slice(0, 20)) {
    const text = item.title + ' ' + item.description
    const found = coordsFromText(text)
    const lat = found ? found[0] + (Math.random() - 0.5) * found[3] : IAEA_HQ[0]
    const lng = found ? found[1] + (Math.random() - 0.5) * found[3] : IAEA_HQ[1]
    const upper = text.toUpperCase()
    const severity: Severity =
      upper.includes('EMERGENCY') || upper.includes('MELTDOWN') || upper.includes('ACCIDENT') ? 'critical' :
      upper.includes('INCIDENT')  || upper.includes('CONTAMINATION') ? 'high' : 'medium'
    events.push({
      id: `iaea-${(item.link ?? '').slice(-20) || Math.random().toString(36).slice(2)}`,
      lat, lng,
      type: 'nuclear',
      title: item.title || 'IAEA 뉴스',
      description: item.description.slice(0, 300),
      severity,
      location: found ? found[2] : 'Vienna, Austria',
      country: found ? found[2] : 'Austria',
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      source: 'IAEA',
      newsUrl: item.link || undefined,
    })
  }
  return events
}

// ─────────────────────────────────────────────────────────
// Main GET handler
// ─────────────────────────────────────────────────────────

export async function GET() {
  const tasks = [
    fetchUSGS(),
    fetchEMSC(),
    fetchEONET(),
    fetchNOAAAlerts(),
    fetchSpaceWeather(),
    fetchGDACS(),
    fetchReliefWeb(),
    fetchFEMA(),
    fetchFloodList(),
    fetchWHO(),
    fetchPTWC(),
    fetchIAEA(),
    ...NEWS_FEEDS.map(f => fetchNewsFeed(f.url, f.name)),
  ]

  const settled = await Promise.allSettled(tasks)

  const allEvents: WorldEvent[] = settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<WorldEvent[]>).value)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const sources: Record<string, number> = {}
  for (const e of allEvents) sources[e.source] = (sources[e.source] ?? 0) + 1

  const SOURCE_NAMES = [
    'USGS','EMSC','EONET','NOAA Alerts','Space Weather','GDACS','ReliefWeb',
    'FEMA','FloodList','WHO','PTWC','IAEA',
    ...NEWS_FEEDS.map(f => f.name),
  ]

  const failedSources: Record<string, string> = {}
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = (r as PromiseRejectedResult).reason
      const msg = reason instanceof Error ? reason.message : String(reason)
      failedSources[SOURCE_NAMES[i]] = msg
      console.warn(`[BoomTrack] ${SOURCE_NAMES[i]} 실패:`, reason)
    }
  })

  return NextResponse.json({
    events: allEvents,
    total: allEvents.length,
    lastUpdate: new Date().toISOString(),
    sources,
    failedSources,
  })
}
