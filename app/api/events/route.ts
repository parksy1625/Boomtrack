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
  // ── 동유럽·러시아 ────────────────────────────────────────
  { url: 'https://meduza.io/rss/en/all',                              name: 'Meduza' },
  { url: 'https://www.euractiv.com/sections/all/feed/',               name: 'Euractiv' },
  { url: 'https://balkaninsight.com/feed/',                           name: 'Balkan Insight' },
  { url: 'https://notesfrompoland.com/feed/',                         name: 'Notes from Poland' },
  { url: 'https://rss.dw.com/xml/rss_en_europe',                     name: 'DW Europe' },
  { url: 'https://rss.dw.com/xml/rss-en-eu',                         name: 'DW EU' },
  { url: 'https://eng.belta.by/rss/',                                 name: 'BELTA Belarus' },
  { url: 'https://www.azernews.az/rss/news.xml',                      name: 'AzerNews' },
  { url: 'https://jam-news.net/feed/',                                name: 'JAM News' },
  // ── 동남아시아 추가 ──────────────────────────────────────
  { url: 'https://www.thejakartapost.com/rss/news.xml',               name: 'Jakarta Post' },
  { url: 'https://vietnamnews.vn/rss/latest.rss',                     name: 'Vietnam News' },
  { url: 'https://www.philstar.com/rss/realtime',                     name: 'Philippine Star' },
  { url: 'https://www.mizzima.com/feed',                              name: 'Mizzima (Myanmar)' },
  { url: 'https://www.irrawaddy.com/feed',                            name: 'Irrawaddy (Myanmar)' },
  { url: 'https://www.khmertimeskh.com/feed/',                        name: 'Khmer Times' },
  { url: 'https://phnompenhpost.com/rss.xml',                         name: 'Phnom Penh Post' },
  // ── 남아시아 추가 ────────────────────────────────────────
  { url: 'https://www.thedailystar.net/rss.xml',                      name: 'Daily Star BD' },
  { url: 'https://www.geo.tv/rss/',                                   name: 'Geo News' },
  { url: 'https://www.newsfirst.lk/feed/',                            name: 'NewsFirst LK' },
  { url: 'https://www.dailymirror.lk/rss/',                           name: 'Daily Mirror LK' },
  { url: 'https://kathmandupost.com/rss',                             name: 'Kathmandu Post' },
  // ── 아프리카 추가 ────────────────────────────────────────
  { url: 'https://www.africanews.com/feed/rss/',                      name: 'Africanews' },
  { url: 'https://www.dailymaverick.co.za/rss.xml',                   name: 'Daily Maverick' },
  { url: 'https://www.theafricareport.com/feed/',                     name: 'Africa Report' },
  { url: 'https://www.nation.co.ke/rss/news.xml',                     name: 'Daily Nation KE' },
  { url: 'https://www.theeastafrican.co.ke/rss/news.xml',             name: 'East African' },
  { url: 'https://www.pulse.com.gh/feed',                             name: 'Pulse Ghana' },
  { url: 'https://www.vanguardngr.com/feed/',                         name: 'Vanguard NG' },
  // ── 중남미 ───────────────────────────────────────────────
  { url: 'https://www.batimes.com.ar/feed',                           name: 'Buenos Aires Times' },
  { url: 'https://colombiareports.com/feed/',                         name: 'Colombia Reports' },
  { url: 'https://ticotimes.net/feed',                                name: 'Tico Times' },
  { url: 'https://www.jamaicaobserver.com/feed/',                     name: 'Jamaica Observer' },
  // ── 인도주의·인권 ────────────────────────────────────────
  { url: 'https://www.unhcr.org/news/rss.xml',                        name: 'UNHCR' },
  { url: 'https://www.icrc.org/en/rss.xml',                           name: 'ICRC' },
  { url: 'https://www.hrw.org/rss.xml',                               name: 'Human Rights Watch' },
  { url: 'https://www.amnesty.org/en/feed/',                          name: 'Amnesty Intl' },
  { url: 'https://www.msf.org/en/rss',                                name: 'MSF' },
  { url: 'https://www.crisisgroup.org/crisiswatch/feed',              name: 'Crisis Group' },
  { url: 'https://reliefweb.int/updates/rss.xml',                     name: 'ReliefWeb Updates' },
  // ── 경제·금융 ────────────────────────────────────────────
  { url: 'https://www.imf.org/en/News/rss',                           name: 'IMF' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', name: 'MarketWatch' },
  // ── 과학·환경·기후 ───────────────────────────────────────
  { url: 'https://rss.dw.com/xml/rss-en-environment',                 name: 'DW Environment' },
  { url: 'https://www.iucn.org/feeds/news',                           name: 'IUCN' },
  { url: 'https://www.unep.org/news-and-stories/rss.xml',             name: 'UNEP' },
  // ── 기타 국제 ────────────────────────────────────────────
  { url: 'https://www.nato.int/rss.xml',                              name: 'NATO' },
  { url: 'https://www.osce.org/taxonomy/term/384/feed',               name: 'OSCE' },
  { url: 'https://www.wfp.org/rss.xml',                               name: 'WFP' },
  { url: 'https://www.iom.int/rss.xml',                               name: 'IOM' },
  { url: 'https://www.worldbank.org/en/news/rss',                     name: 'World Bank' },
  // ── 재난·기상 ────────────────────────────────────────────
  { url: 'https://www.gdacs.org/xml/rss_24h.xml',                    name: 'GDACS' },
  { url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom', name: 'USGS Earthquakes' },
  { url: 'https://www.fema.gov/feeds/disasters.rss',                 name: 'FEMA' },
  { url: 'https://floodlist.com/feed',                               name: 'FloodList' },
  { url: 'https://www.weather.gov/rss_page.php?site_name=nws',       name: 'NWS Alerts' },
  { url: 'https://volcano.si.edu/news/WeeklyVolcanoActivity-Rss.xml',name: 'Smithsonian Volcano' },
  { url: 'https://emergency.copernicus.eu/mapping/activations-rapid/feed', name: 'Copernicus EMS' },
  // ── 보건·질병 ────────────────────────────────────────────
  { url: 'https://www.who.int/rss-feeds/news-english.xml',           name: 'WHO' },
  { url: 'https://promedmail.org/feed/',                             name: 'ProMED' },
  { url: 'https://outbreaknewstoday.com/feed/',                      name: 'Outbreak News Today' },
  // ── 핵·군사 ──────────────────────────────────────────────
  { url: 'https://www.iaea.org/feeds/news',                          name: 'IAEA' },
  { url: 'https://www.armscontrol.org/rss.xml',                      name: 'Arms Control' },
  { url: 'https://thebulletin.org/feed/',                            name: 'Bulletin of Atomic Scientists' },
  // ── 아프리카 추가 ────────────────────────────────────────
  { url: 'https://www.ethiopia-monitor.com/feed/',                   name: 'Ethiopia Monitor' },
  { url: 'https://www.sudantribune.com/spip.php?page=backend',       name: 'Sudan Tribune' },
  { url: 'https://www.theciviliansd.com/feed/',                      name: 'The Civilian SD' },
  { url: 'https://www.liberianobserver.com/feed/',                   name: 'Liberian Observer' },
  { url: 'https://www.newvision.co.ug/feed/',                        name: 'New Vision UG' },
  { url: 'https://www.independent.co.ug/feed/',                      name: 'Independent UG' },
  { url: 'https://www.theeastafrican.co.ke/rss/news.xml',           name: 'East African' },
  { url: 'https://saharareporters.com/rss.xml',                      name: 'Sahara Reporters' },
  // ── 중동 추가 ────────────────────────────────────────────
  { url: 'https://www.al-monitor.com/rss',                          name: 'Al Monitor' },
  { url: 'https://english.ahram.org.eg/RssFeeds.aspx',              name: 'Al Ahram' },
  { url: 'https://www.yalibnan.com/feed/',                           name: 'Ya Libnan' },
  { url: 'https://www.jordantimes.com/rss.xml',                     name: 'Jordan Times' },
  { url: 'https://www.rudaw.net/english/feed',                      name: 'Rudaw (Kurdistan)' },
  // ── 중앙아시아 ───────────────────────────────────────────
  { url: 'https://24.kg/english/rss.xml',                           name: '24.kg Kyrgyzstan' },
  { url: 'https://kun.uz/en/rss',                                   name: 'Kun.uz Uzbekistan' },
  { url: 'https://www.rferl.org/api/epiqxqim_tj',                   name: 'RFE/RL Tajikistan' },
  // ── 라틴아메리카 추가 ────────────────────────────────────
  { url: 'https://www.elnacional.com/feed/',                        name: 'El Nacional VE' },
  { url: 'https://www.laprensa.hn/feed/',                           name: 'La Prensa HN' },
  { url: 'https://www.elsalvador.com/feed/',                        name: 'El Salvador News' },
  { url: 'https://haitilibre.com/en/rss-feed.xml',                  name: 'Haiti Libre' },
  // ── 과학·우주·기술 ───────────────────────────────────────
  { url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',          name: 'NASA' },
  { url: 'https://spaceweather.com/services/rss.xml',               name: 'Space Weather' },
  { url: 'https://www.spaceweatherlive.com/en/news/rss.xml',        name: 'SpaceWeatherLive' },
  // ── 글로벌 주요 언론 추가 ────────────────────────────────
  { url: 'https://feeds.washingtonpost.com/rss/world',              name: 'Washington Post' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',  name: 'NY Times World' },
  { url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',            name: 'Wall Street Journal' },
  { url: 'https://www.ft.com/rss/home/uk',                         name: 'Financial Times' },
  { url: 'https://www.economist.com/international/rss.xml',         name: 'The Economist' },
  { url: 'https://foreignpolicy.com/feed/',                         name: 'Foreign Policy' },
  { url: 'https://www.foreignaffairs.com/rss.xml',                  name: 'Foreign Affairs' },
  { url: 'https://theintercept.com/feed/?rss',                      name: 'The Intercept' },
  // ── 러시아·구소련 ────────────────────────────────────────
  { url: 'https://www.themoscowtimes.com/rss/news',                 name: 'Moscow Times' },
  { url: 'https://www.kavkaz-uzel.eu/articles/rss.xml',             name: 'Kavkaz-Uzel (Caucasus)' },
  { url: 'https://www.ukraine-crisis.info/feed/',                   name: 'Ukraine Crisis' },
  { url: 'https://www.pravda.com.ua/eng/rss/view_news/',            name: 'Ukrayinska Pravda' },
  // ── 동아시아 추가 ────────────────────────────────────────
  { url: 'https://www.rfa.org/english/rss2.xml',                    name: 'Radio Free Asia' },
  { url: 'https://www.taipeitimes.com/xml/index.rss',               name: 'Taipei Times' },
  { url: 'https://en.hani.co.kr/rss',                               name: 'Hankyoreh' },
  { url: 'https://asia.nikkei.com/rss/feed/nar',                    name: 'Nikkei Asia' },
  { url: 'https://www.rfa.org/english/news/china/rss2.xml',         name: 'RFA China' },
  { url: 'https://www.rfa.org/english/news/nkorea/rss2.xml',        name: 'RFA N.Korea' },
  // ── 남아시아 추가 ────────────────────────────────────────
  { url: 'https://www.thequint.com/news/rss',                       name: 'The Quint' },
  { url: 'https://www.thenews.com.pk/rss/1/2',                      name: 'The News PK' },
  { url: 'https://www.samaa.tv/feed/',                              name: 'Samaa TV' },
  { url: 'https://tolonews.com/rss.xml',                            name: 'Tolo News (Afghanistan)' },
  { url: 'https://www.khaama.com/feed/',                            name: 'Khaama (Afghanistan)' },
  // ── 중동 추가 ────────────────────────────────────────────
  { url: 'https://english.wafa.ps/rss.aspx',                       name: 'WAFA (Palestine)' },
  { url: 'https://www.iranintl.com/en/rss',                         name: 'Iran International' },
  { url: 'https://www.tasnimnews.com/en/rss',                       name: 'Tasnim (Iran)' },
  { url: 'https://www.kurdistan24.net/en/rss.xml',                  name: 'Kurdistan 24' },
  { url: 'https://www.yementimes.com/en/rss.xml',                   name: 'Yemen Times' },
  // ── 아프리카 추가 ────────────────────────────────────────
  { url: 'https://www.dw.com/en/africa/rss',                        name: 'DW Africa' },
  { url: 'https://www.theafricareport.com/feed/',                   name: 'Africa Report' },
  { url: 'https://www.voaafrica.com/api/zivqrkrvil',                name: 'VOA Africa' },
  { url: 'https://www.sabcnews.com/sabcnews/feed/',                  name: 'SABC News' },
  { url: 'https://www.monitor.co.ug/monitor/feed',                  name: 'Daily Monitor UG' },
  { url: 'https://www.ghanaweb.com/GhanaHomePage/rss.php',          name: 'GhanaWeb' },
  { url: 'https://www.ethiopiaobserver.com/feed/',                  name: 'Ethiopia Observer' },
  // ── 중남미 추가 ────────────────────────────────────────
  { url: 'https://www.venezuelanalysis.com/feed',                   name: 'Venezuela Analysis' },
  { url: 'https://lacuarta.com/rss/',                               name: 'La Cuarta CL' },
  { url: 'https://www.nodal.am/feed/',                              name: 'NODAL LatAm' },
  { url: 'https://www.brasildefato.com.br/rss.xml',                 name: 'Brasil de Fato' },
  // ── 기후·환경 추가 ───────────────────────────────────────
  { url: 'https://www.climatechangenews.com/feed/',                 name: 'Climate Change News' },
  { url: 'https://insideclimatenews.org/feed/',                     name: 'Inside Climate News' },
  { url: 'https://www.carbonbrief.org/feed',                        name: 'Carbon Brief' },
  { url: 'https://e360.yale.edu/feed',                              name: 'Yale Environment 360' },
  // ── 사이버·기술 안보 ────────────────────────────────────
  { url: 'https://krebsonsecurity.com/feed/',                       name: 'Krebs on Security' },
  { url: 'https://therecord.media/feed',                            name: 'The Record (Cyber)' },
  { url: 'https://www.securityweek.com/feed/',                      name: 'SecurityWeek' },
  // ── 국제기구 추가 ───────────────────────────────────────
  { url: 'https://www.unocha.org/feed',                             name: 'OCHA' },
  { url: 'https://www.unhcr.org/en-us/news/press/rss.xml',         name: 'UNHCR Press' },
  { url: 'https://www.unicef.org/press-releases/rss.xml',          name: 'UNICEF' },
  { url: 'https://www.ohchr.org/en/rss-feeds/news',                name: 'OHCHR' },
  { url: 'https://www.transparency.org/en/feed',                   name: 'Transparency Intl' },

  // ── 유럽 추가 ────────────────────────────────────────────
  { url: 'https://www.theguardian.com/world/rss',                   name: 'The Guardian World' },
  { url: 'https://www.independent.co.uk/news/world/rss',            name: 'The Independent' },
  { url: 'https://www.telegraph.co.uk/rss.xml',                     name: 'The Telegraph' },
  { url: 'https://www.lemonde.fr/en/rss/une.xml',                   name: 'Le Monde' },
  { url: 'https://www.spiegel.de/ausland/index.rss',                name: 'Spiegel Ausland' },
  { url: 'https://www.zeit.de/news/rss',                            name: 'Die Zeit' },
  { url: 'https://www.corriere.it/rss/homepage.xml',                name: 'Corriere della Sera' },
  { url: 'https://www.elpais.com/rss/elpais/internacional/portada_rss.xml', name: 'El País' },
  { url: 'https://www.sueddeutsche.de/news/rss',                    name: 'Süddeutsche Zeitung' },
  { url: 'https://yle.fi/uutiset/rss/international.rss',            name: 'Yle Finland' },
  { url: 'https://www.svt.se/nyheter/utrikes/rss.xml',              name: 'SVT Sweden' },
  { url: 'https://www.nrk.no/toppsaker.rss',                        name: 'NRK Norway' },
  { url: 'https://www.dr.dk/nyheder/service/feeds/allenyheder',     name: 'DR Denmark' },
  { url: 'https://www.hs.fi/rss/maailma.xml',                       name: 'Helsingin Sanomat' },
  { url: 'https://www.rts.ch/info/monde/rss',                       name: 'RTS Switzerland' },
  { url: 'https://www.rtbf.be/rss/info/monde',                      name: 'RTBF Belgium' },
  { url: 'https://www.tvp.info/rss',                                name: 'TVP Info Poland' },
  { url: 'https://www.romfea.gr/rss.xml',                           name: 'Romfea Greece' },
  { url: 'https://www.denik.cz/rss/z-domova.rss',                   name: 'Deník Czech' },
  { url: 'https://www.aktuality.sk/rss',                            name: 'Aktuality Slovakia' },
  { url: 'https://index.hu/24ora/rss/',                             name: 'Index Hungary' },
  { url: 'https://www.digi24.ro/rss',                               name: 'Digi24 Romania' },
  { url: 'https://www.novinite.com/rss.php',                        name: 'Novinite Bulgaria' },
  { url: 'https://www.b92.net/info/vesti/rss.php',                  name: 'B92 Serbia' },
  { url: 'https://www.jutarnji.hr/rss',                             name: 'Jutarnji Croatia' },
  { url: 'https://www.rtklive.com/en/rss.xml',                      name: 'RTK Kosovo' },
  { url: 'https://www.postimees.ee/rss',                            name: 'Postimees Estonia' },
  { url: 'https://www.delfi.lt/rss/feeds/daily.xml',                name: 'Delfi Lithuania' },
  { url: 'https://www.lsm.lv/en/rss.xml',                          name: 'LSM Latvia' },
  // ── 러시아/CIS 추가 ──────────────────────────────────────
  { url: 'https://www.interfax.ru/rss.asp',                         name: 'Interfax Russia' },
  { url: 'https://www.rbc.ru/rss/news',                             name: 'RBC Russia' },
  { url: 'https://www.kommersant.ru/RSS/news.xml',                  name: 'Kommersant' },
  { url: 'https://www.currenttime.tv/api/zivqrkrvil',               name: 'Current Time' },
  { url: 'https://www.azattyq.org/api/zivqrkrvil',                  name: 'Azattyq Kazakhstan' },
  { url: 'https://www.rferl.org/api/zivqrkrvil_uz',                 name: 'RFE/RL Uzbekistan' },
  { url: 'https://www.rferl.org/api/zivqrkrvil_ky',                 name: 'RFE/RL Kyrgyzstan' },
  { url: 'https://eurasianet.org/feed',                             name: 'Eurasianet' },
  { url: 'https://www.occrp.org/en/feed/',                          name: 'OCCRP' },
  // ── 중동 추가2 ───────────────────────────────────────────
  { url: 'https://www.albawaba.com/rss.xml',                        name: 'Al Bawaba' },
  { url: 'https://www.dailysabah.com/rssFeed/world',                name: 'Daily Sabah Turkey' },
  { url: 'https://www.hurriyetdailynews.com/rss',                   name: 'Hurriyet Daily News' },
  { url: 'https://www.haaretz.com/cmlink/1.4566499',                name: 'Haaretz' },
  { url: 'https://www.timesofisrael.com/feed/',                     name: 'Times of Israel' },
  { url: 'https://www.i24news.tv/en/rss',                           name: 'i24 News' },
  { url: 'https://www.ynetnews.com/category/3082/rss',              name: 'Ynet News' },
  { url: 'https://www.kurdipresse.com/en/feed/',                    name: 'Kurdi Presse' },
  { url: 'https://www.moroccoworldnews.com/feed/',                  name: 'Morocco World News' },
  { url: 'https://www.libyaherald.com/feed/',                       name: 'Libya Herald' },
  { url: 'https://www.manoramaonline.com/news/english.rss',         name: 'Manorama' },
  // ── 남아시아 추가2 ───────────────────────────────────────
  { url: 'https://www.ndtv.com/rss/feeds/world.xml',                name: 'NDTV' },
  { url: 'https://www.hindustantimes.com/feeds/rss/world/rssfeed.xml', name: 'Hindustan Times' },
  { url: 'https://www.business-standard.com/rss/latest.rss',        name: 'Business Standard' },
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', name: 'Economic Times IN' },
  { url: 'https://www.andhrajyothy.com/rss/top-news.xml',           name: 'Andhra Jyothy' },
  { url: 'https://www.myrepublica.com/feed/',                       name: 'My Republica Nepal' },
  { url: 'https://thehimalayantimes.com/feed/',                     name: 'Himalayan Times' },
  { url: 'https://www.newagebd.net/rss.xml',                        name: 'New Age BD' },
  { url: 'https://www.prothomalo.com/feed',                         name: 'Prothom Alo BD' },
  { url: 'https://www.colombopage.com/feed',                        name: 'ColomboPage LK' },
  // ── 동남아시아 추가2 ─────────────────────────────────────
  { url: 'https://www.nationthailand.com/rss',                      name: 'Nation Thailand' },
  { url: 'https://thaipbsworld.com/feed/',                          name: 'Thai PBS World' },
  { url: 'https://www.rappler.com/rss',                             name: 'Rappler PH' },
  { url: 'https://newsinfo.inquirer.net/feed',                      name: 'Inquirer PH' },
  { url: 'https://www.malaymail.com/feed',                          name: 'Malay Mail' },
  { url: 'https://www.freemalaysiatoday.com/feed/',                 name: 'Free Malaysia Today' },
  { url: 'https://www.rfa.org/english/news/vietnam/rss2.xml',       name: 'RFA Vietnam' },
  { url: 'https://www.rfa.org/english/news/laos/rss2.xml',          name: 'RFA Laos' },
  { url: 'https://www.rfa.org/english/news/cambodia/rss2.xml',      name: 'RFA Cambodia' },
  { url: 'https://www.rfa.org/english/news/burma/rss2.xml',         name: 'RFA Myanmar' },
  { url: 'https://www.myanmar-now.org/en/feed',                     name: 'Myanmar Now' },
  { url: 'https://www.bnionline.net/en/rss.xml',                    name: 'BNI Myanmar' },
  { url: 'https://coconuts.co/bali/feed/',                          name: 'Coconuts Bali' },
  { url: 'https://coconuts.co/manila/feed/',                        name: 'Coconuts Manila' },
  // ── 동아시아 추가2 ───────────────────────────────────────
  { url: 'https://mainichi.jp/english/rss',                         name: 'Mainichi Japan' },
  { url: 'https://www.asahi.com/ajw/rss.xml',                       name: 'Asahi Shimbun' },
  { url: 'https://www.yomiuri.co.jp/dy/rss/rss-dy-en.xml',          name: 'Yomiuri' },
  { url: 'https://www.stripes.com/feeds/news.rss',                  name: 'Stars and Stripes' },
  { url: 'https://www.chosun.com/rss/news.xml',                     name: 'Chosun Ilbo' },
  { url: 'https://english.chosun.com/rss/site/news/world.rss',      name: 'Chosun EN' },
  { url: 'https://www.koreajoongangdaily.joins.com/rss',             name: 'JoongAng Daily' },
  { url: 'https://www.rfa.org/english/news/tinews/rss2.xml',        name: 'RFA Taiwan' },
  { url: 'https://focustaiwan.tw/rss',                              name: 'Focus Taiwan' },
  // ── 아프리카 추가2 ───────────────────────────────────────
  { url: 'https://www.capetalk.co.za/feed',                         name: 'Cape Talk ZA' },
  { url: 'https://businessday.ng/feed/',                            name: 'BusinessDay NG' },
  { url: 'https://www.punchng.com/feed/',                           name: 'Punch NG' },
  { url: 'https://thenationonlineng.net/feed/',                      name: 'The Nation NG' },
  { url: 'https://www.graphic.com.gh/feed',                         name: 'Graphic GH' },
  { url: 'https://www.citinewsroom.com/feed/',                      name: 'Citi Newsroom GH' },
  { url: 'https://www.kenyanews.go.ke/feed/',                       name: 'Kenya News Agency' },
  { url: 'https://www.standardmedia.co.ke/rss/headlines.php',       name: 'Standard Media KE' },
  { url: 'https://www.thecitizen.co.tz/feed',                       name: 'The Citizen TZ' },
  { url: 'https://www.ippmedia.com/en/rss.xml',                     name: 'IPP Media TZ' },
  { url: 'https://www.newvision.co.ug/feed/',                       name: 'New Vision UG' },
  { url: 'https://allafrica.com/tools/headlines/rss/subsaharan/full.rss', name: 'AllAfrica SubSahara' },
  { url: 'https://www.journalducameroun.com/en/feed/',              name: 'Journal du Cameroun' },
  { url: 'https://www.abidjannet.net/rss.xml',                      name: 'Abidjan.net CI' },
  { url: 'https://www.maliweb.net/feed/',                           name: 'Maliweb' },
  { url: 'https://www.rfi.fr/en/africa/rss',                        name: 'RFI Africa' },
  { url: 'https://www.bbc.co.uk/sport/africa.rss',                  name: 'BBC Africa' },
  { url: 'https://www.voazimbabwe.com/api/zivqrkrvil',              name: 'VOA Zimbabwe' },
  { url: 'https://www.voaswahili.com/api/zivqrkrvil',               name: 'VOA Swahili' },
  { url: 'https://www.voaamharic.com/api/zivqrkrvil',               name: 'VOA Amharic' },
  { url: 'https://www.voahausa.com/api/zivqrkrvil',                 name: 'VOA Hausa' },
  // ── 중남미 추가2 ─────────────────────────────────────────
  { url: 'https://www.infobae.com/feeds/rss/',                      name: 'Infobae' },
  { url: 'https://www.clarin.com/rss/lo-ultimo/',                   name: 'Clarín AR' },
  { url: 'https://www.lanacion.com.ar/arcio/rss/',                  name: 'La Nación AR' },
  { url: 'https://www.folha.uol.com.br/internacional/rss091.xml',   name: 'Folha de SP' },
  { url: 'https://oglobo.globo.com/rss.xml',                        name: 'O Globo' },
  { url: 'https://www.bbc.com/portuguese/rss/bbc_radiobrasil.xml',  name: 'BBC Brasil' },
  { url: 'https://www.latimes.com/world-nation/rss2.0.xml',         name: 'LA Times World' },
  { url: 'https://www.elnuevoherald.com/feeds/rss/',                name: 'El Nuevo Herald' },
  { url: 'https://www.univision.com/noticias/rss',                  name: 'Univision Noticias' },
  { url: 'https://www.telesurtv.net/rss/news.rss',                  name: 'TeleSUR' },
  { url: 'https://www.rpp.pe/rss/mundo.xml',                        name: 'RPP Peru' },
  { url: 'https://elcomercio.pe/rss/mundo.xml',                     name: 'El Comercio PE' },
  { url: 'https://www.larepublica.co/rss/mundo.xml',                name: 'La República CO' },
  { url: 'https://www.semana.com/rss/nacion.xml',                   name: 'Semana CO' },
  { url: 'https://www.eluniversal.com.mx/rss.xml',                  name: 'El Universal MX' },
  { url: 'https://www.excelsior.com.mx/rss.xml',                    name: 'Excélsior MX' },
  { url: 'https://www.proceso.com.mx/rss',                          name: 'Proceso MX' },
  { url: 'https://www.noticias.com.uy/feed/',                       name: 'Noticias UY' },
  // ── 재난·기상 추가 ───────────────────────────────────────
  { url: 'https://www.reliefweb.int/disasters/rss.xml',             name: 'ReliefWeb Disasters' },
  { url: 'https://pdc.org/feeds/disaster-alert.rss',                name: 'PDC Disaster Alert' },
  { url: 'https://www.ifrc.org/en/news-and-media/news/rss/',        name: 'IFRC' },
  { url: 'https://phys.org/rss-feed/space-news/',                   name: 'Phys.org Space' },
  { url: 'https://earthobservatory.nasa.gov/feeds/natural-hazards.rss', name: 'NASA Earth Observatory' },
  { url: 'https://www.volcanodiscovery.com/news/rss.xml',           name: 'VolcanoDiscovery' },
  { url: 'https://www.tsunamizone.org/feed/',                       name: 'Tsunami Zone' },
  // ── 경제·제재 ────────────────────────────────────────────
  { url: 'https://home.treasury.gov/system/files/126/ofac.xml',     name: 'OFAC Sanctions' },
  { url: 'https://www.reuters.com/finance/rss',                     name: 'Reuters Finance' },
  { url: 'https://www.bloomberg.com/feeds/podcasts/first_word.xml', name: 'Bloomberg First Word' },
  { url: 'https://www.project-syndicate.org/rss',                   name: 'Project Syndicate' },
  // ── 분쟁 전문 ────────────────────────────────────────────
  { url: 'https://acleddata.com/feed/',                             name: 'ACLED' },
  { url: 'https://www.smallarmssurvey.org/resource-feed',           name: 'Small Arms Survey' },
  { url: 'https://www.sipri.org/taxonomy/term/10/feed',             name: 'SIPRI' },
  { url: 'https://www.iiss.org/en/publications/survival/rss',       name: 'IISS Survival' },
  { url: 'https://warontherocks.com/feed/',                         name: 'War on the Rocks' },
  { url: 'https://www.bellingcat.com/feed/',                        name: 'Bellingcat' },
  { url: 'https://thesoufancenter.org/feed/',                       name: 'Soufan Center' },
  { url: 'https://ctc.usma.edu/feed/',                              name: 'CTC Sentinel' },
  { url: 'https://jamestown.org/feed/',                             name: 'Jamestown Foundation' },
  { url: 'https://www.lowyinstitute.org/the-interpreter/rss.xml',   name: 'Lowy Institute' },
  { url: 'https://www.atlanticcouncil.org/feed/',                   name: 'Atlantic Council' },
  { url: 'https://carnegieendowment.org/publications/rss',          name: 'Carnegie Endowment' },
  { url: 'https://www.chathamhouse.org/feed',                       name: 'Chatham House' },
  { url: 'https://www.brookings.edu/feed/',                         name: 'Brookings' },
  { url: 'https://www.rand.org/blog/rss.xml',                       name: 'RAND' },
  { url: 'https://www.wilsoncenter.org/rss.xml',                    name: 'Wilson Center' },

  // ── 미국 주요 언론 추가 ──────────────────────────────────
  { url: 'https://feeds.nbcnews.com/nbcnews/public/world',          name: 'NBC News World' },
  { url: 'https://rss.cnn.com/rss/edition_world.rss',               name: 'CNN World' },
  { url: 'https://abcnews.go.com/abcnews/internationalheadlines',    name: 'ABC News Intl' },
  { url: 'https://feeds.cbsnews.com/CBSNewsWorld',                   name: 'CBS News World' },
  { url: 'https://msnbc.com/rss',                                    name: 'MSNBC' },
  { url: 'https://www.apnews.com/apf-intlnews',                     name: 'AP International' },
  { url: 'https://www.upi.com/RSS/News/World-News/',                 name: 'UPI World' },
  { url: 'https://www.axios.com/feeds/feed.rss',                    name: 'Axios' },
  { url: 'https://thehill.com/rss/syndicator/19110',                name: 'The Hill' },
  { url: 'https://www.politico.com/rss/politicopicks.xml',           name: 'Politico US' },
  { url: 'https://www.vox.com/rss/world-politics/index.xml',        name: 'Vox World' },
  { url: 'https://www.motherjones.com/feed/',                       name: 'Mother Jones' },
  { url: 'https://www.thedailybeast.com/rss',                       name: 'The Daily Beast' },
  { url: 'https://www.vice.com/en/rss',                             name: 'VICE News' },
  { url: 'https://www.newsweek.com/rss',                            name: 'Newsweek' },
  { url: 'https://time.com/feed/',                                   name: 'TIME' },
  { url: 'https://www.theatlantic.com/feed/all/',                   name: 'The Atlantic' },
  { url: 'https://www.newyorker.com/feed/news',                     name: 'The New Yorker' },
  { url: 'https://www.propublica.org/feeds/propublica/main',        name: 'ProPublica' },
  // ── 영국 추가 ────────────────────────────────────────────
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',             name: 'BBC World' },
  { url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',      name: 'BBC World Africa' },
  { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml',        name: 'BBC World Asia' },
  { url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml',      name: 'BBC World Europe' },
  { url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml', name: 'BBC World LatAm' },
  { url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', name: 'BBC World MiddleEast' },
  { url: 'https://www.theguardian.com/uk-news/rss',                 name: 'Guardian UK' },
  { url: 'https://www.theguardian.com/environment/rss',             name: 'Guardian Environment' },
  { url: 'https://www.theguardian.com/science/rss',                 name: 'Guardian Science' },
  // ── 프랑스어권 추가 ──────────────────────────────────────
  { url: 'https://www.rfi.fr/en/rss',                               name: 'RFI English' },
  { url: 'https://www.rfi.fr/fr/rss',                               name: 'RFI Français' },
  { url: 'https://www.rfi.fr/en/middle-east/rss',                   name: 'RFI Middle East' },
  { url: 'https://www.tv5monde.com/rss',                            name: 'TV5Monde' },
  { url: 'https://information.tv5monde.com/rss.xml',                name: 'TV5Monde Info' },
  { url: 'https://www.24heures.ch/rss',                             name: '24heures CH' },
  { url: 'https://www.letemps.ch/rss.xml',                          name: 'Le Temps CH' },
  // ── 독일어권 추가 ────────────────────────────────────────
  { url: 'https://www.dw.com/en/rss',                               name: 'DW English' },
  { url: 'https://www.dw.com/en/world/rss',                         name: 'DW World' },
  { url: 'https://www.tagesspiegel.de/feeds/internationaleandforeignpolitics.rss', name: 'Tagesspiegel' },
  { url: 'https://www.nzz.ch/recent.rss',                           name: 'NZZ Switzerland' },
  { url: 'https://www.diepresse.com/rss/au',                        name: 'Die Presse AT' },
  { url: 'https://www.derstandard.at/rss',                          name: 'Der Standard AT' },
  // ── 스페인어권 추가 ──────────────────────────────────────
  { url: 'https://agenciafe.com/feed/',                             name: 'Agencia FE' },
  { url: 'https://www.abc.es/rss/feeds/abc_Internacional.xml',      name: 'ABC España' },
  { url: 'https://www.20minutos.es/rss/internacional/',             name: '20minutos ES' },
  { url: 'https://www.latercera.com/feed/',                         name: 'La Tercera CL' },
  { url: 'https://www.eltiempo.com/rss/mundo.xml',                  name: 'El Tiempo CO' },
  { url: 'https://www.elnacional.com/feed/',                        name: 'El Nacional DO' },
  // ── 포르투갈어권 추가 ────────────────────────────────────
  { url: 'https://www.dn.pt/rss/rss.aspx',                         name: 'Diário de Notícias PT' },
  { url: 'https://www.publico.pt/api/feed/rss/ultimas',             name: 'Público PT' },
  { url: 'https://www.rtp.pt/noticias/index.php?headline=4&visual=61&rss=1', name: 'RTP PT' },
  { url: 'https://www.correiobraziliense.com.br/feeds/rss/home.rss', name: 'Correio Braziliense' },
  { url: 'https://noticias.uol.com.br/ultnot/reuters/rss.xml',      name: 'UOL Noticias' },
  // ── 아랍어권 추가 ────────────────────────────────────────
  { url: 'https://www.almasryalyoum.com/rss.xml',                   name: 'Al Masry Al Youm EG' },
  { url: 'https://english.aawsat.com/rss.xml',                      name: 'Asharq Al Awsat' },
  { url: 'https://www.alarabiya.net/api/rlFeed',                    name: 'Al Arabiya' },
  { url: 'https://www.france24.com/ar/rss',                         name: 'France24 Arabic' },
  { url: 'https://www.bbc.com/arabic/index.xml',                    name: 'BBC Arabic' },
  // ── 인도 추가 ────────────────────────────────────────────
  { url: 'https://www.theprint.in/feed/',                           name: 'The Print IN' },
  { url: 'https://scroll.in/feed',                                  name: 'Scroll.in IN' },
  { url: 'https://www.outlookindia.com/rss/main/magazine',          name: 'Outlook India' },
  { url: 'https://www.firstpost.com/rss/world.xml',                 name: 'Firstpost World' },
  { url: 'https://www.deccanherald.com/rss',                        name: 'Deccan Herald' },
  { url: 'https://www.tribuneindia.com/rss/feed',                   name: 'Tribune India' },
  { url: 'https://www.theweek.in/rss',                              name: 'The Week IN' },
  // ── 파키스탄/아프간 추가 ─────────────────────────────────
  { url: 'https://www.brecorder.com/feed',                          name: 'Brecorder PK' },
  { url: 'https://www.app.com.pk/feed/',                            name: 'APP Pakistan' },
  { url: 'https://www.ariana-news.com/feed/',                       name: 'Ariana News AF' },
  { url: 'https://www.1tvnews.af/en/feed',                          name: '1TV Afghanistan' },
  // ── 터키 추가 ────────────────────────────────────────────
  { url: 'https://www.sabah.com.tr/rss/anasayfa.xml',               name: 'Sabah TR' },
  { url: 'https://www.trthaber.com/rss/kategoriler/dunya.rss',      name: 'TRT Haber' },
  { url: 'https://www.ntv.com.tr/rss/dunya',                        name: 'NTV TR' },
  // ── 이란 추가 ────────────────────────────────────────────
  { url: 'https://en.mehrnews.com/rss',                             name: 'Mehr News IR' },
  { url: 'https://www.presstv.ir/rss',                              name: 'PressTV IR' },
  { url: 'https://www.isna.ir/rss',                                 name: 'ISNA IR' },
  // ── 이스라엘 추가 ────────────────────────────────────────
  { url: 'https://www.jpost.com/rss/rssfeedsworld.aspx',            name: 'Jerusalem Post World' },
  { url: 'https://www.israelhayom.com/feed/',                       name: 'Israel Hayom' },
  // ── 동남아 추가3 ─────────────────────────────────────────
  { url: 'https://www.bangkokbiznews.com/rss/international.xml',    name: 'Bangkok Biz News' },
  { url: 'https://www.nationmultimedia.com/rss',                    name: 'Nation Multimedia TH' },
  { url: 'https://en.nhandan.vn/rss',                               name: 'Nhan Dan VN' },
  { url: 'https://e.vnexpress.net/rss/news.rss',                    name: 'VnExpress' },
  { url: 'https://www.benarnews.org/english/news/rss',              name: 'BenarNews' },
  { url: 'https://www.sunstar.com.ph/feed/',                        name: 'Sun Star PH' },
  { url: 'https://mb.com.ph/feed/',                                 name: 'Manila Bulletin' },
  { url: 'https://www.manilatimes.net/feed/',                       name: 'Manila Times' },
  { url: 'https://www.mmtimes.com/feed',                            name: 'Myanmar Times' },
  { url: 'https://elevenmyanmar.com/feed',                          name: 'Eleven Myanmar' },
  { url: 'https://www.cambodiadaily.com/feed/',                     name: 'Cambodia Daily' },
  { url: 'https://www.vientianetimes.org.la/feed/',                 name: 'Vientiane Times' },
  { url: 'https://borneobulletin.com.bn/feed/',                     name: 'Borneo Bulletin BN' },
  { url: 'https://www.thestar.com.my/rss/news/world',               name: 'The Star MY' },
  { url: 'https://www.nst.com.my/feeds/world.rss',                  name: 'NST Malaysia' },
  // ── 오세아니아 추가 ──────────────────────────────────────
  { url: 'https://www.abc.net.au/news/feed/2942460/rss.xml',        name: 'ABC Australia World' },
  { url: 'https://www.smh.com.au/rss/world.xml',                    name: 'Sydney Morning Herald' },
  { url: 'https://www.theaustralian.com.au/rss',                    name: 'The Australian' },
  { url: 'https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/world/', name: 'NZ Herald' },
  { url: 'https://www.stuff.co.nz/rss',                             name: 'Stuff NZ' },
  { url: 'https://www.pina.com.fj/rss',                             name: 'PINA Pacific' },
  { url: 'https://www.radionz.co.nz/rss/pacific.xml',               name: 'RNZ Pacific' },
  // ── 한국/일본 추가 ───────────────────────────────────────
  { url: 'https://www.koreajoongangdaily.joins.com/rss/topnews',    name: 'JoongAng Top' },
  { url: 'https://www.kbs.co.kr/rss/rss_news.xml',                  name: 'KBS World' },
  { url: 'https://world.kbs.co.kr/service/news_rss.htm?lang=e',     name: 'KBS Radio World' },
  { url: 'https://english.ytn.co.kr/rss/rss_world.xml',             name: 'YTN Korea' },
  { url: 'https://japannews.yomiuri.co.jp/feed/',                   name: 'Japan News' },
  { url: 'https://www.japantimes.co.jp/feed/',                      name: 'Japan Times Feed' },
  { url: 'https://english.kyodonews.net/rss/politics.xml',          name: 'Kyodo Politics' },
  // ── 중국 추가 ────────────────────────────────────────────
  { url: 'https://www.chinadailyhk.com/rss/news.xml',               name: 'China Daily HK' },
  { url: 'https://www.xinhuanet.com/english/rss/worldnews.xml',     name: 'Xinhua World' },
  { url: 'https://www.cgtn.com/subscribe/rss/section/world.xml',    name: 'CGTN World' },
  { url: 'https://www.scmp.com/rss/91/feed',                        name: 'SCMP World' },
  { url: 'https://www.scmp.com/rss/4/feed',                         name: 'SCMP Asia' },
  // ── 러시아/우크라이나 추가2 ─────────────────────────────
  { url: 'https://www.unian.info/rss/news.rss',                     name: 'UNIAN Ukraine' },
  { url: 'https://www.radiosvoboda.org/api/zivqrkrvil',             name: 'Radio Svoboda' },
  { url: 'https://www.eurointegration.com.ua/eng/rss/',             name: 'Eurointegration UA' },
  { url: 'https://english.nv.ua/rss',                               name: 'NV Ukraine' },
  { url: 'https://www.segodnya.ua/en/rss',                          name: 'Segodnya UA' },
  // ── 인권·거버넌스 추가 ───────────────────────────────────
  { url: 'https://freedomhouse.org/feed',                           name: 'Freedom House' },
  { url: 'https://www.refworld.org/rss.xml',                        name: 'Refworld' },
  { url: 'https://www.globalwitness.org/en/feed/',                  name: 'Global Witness' },
  { url: 'https://www.article19.org/feed/',                         name: 'Article 19' },
  { url: 'https://cpj.org/feed/',                                   name: 'Committee to Protect Journalists' },
  { url: 'https://rsf.org/en/rss',                                  name: 'Reporters Without Borders' },
  { url: 'https://www.pri.org/feeds/global-nation.rss',             name: 'PRI Global Nation' },
  // ── 에너지·자원 추가 ─────────────────────────────────────
  { url: 'https://www.iea.org/news/rss',                            name: 'IEA Energy' },
  { url: 'https://oilprice.com/rss/main',                           name: 'OilPrice.com' },
  { url: 'https://www.energymonitor.ai/feed',                       name: 'Energy Monitor' },
  { url: 'https://www.miningweekly.com/rss',                        name: 'Mining Weekly' },
  { url: 'https://www.spglobal.com/commodityinsights/en/rss-feed',  name: 'S&P Commodity' },
  // ── 이민·난민 추가 ───────────────────────────────────────
  { url: 'https://www.infomigrants.net/en/feed/all',                name: 'InfoMigrants' },
  { url: 'https://www.migrationpolicy.org/rss.xml',                 name: 'Migration Policy' },
  { url: 'https://www.borderreport.fox/feed/',                      name: 'Border Report' },
  // ── 기타 전문 ────────────────────────────────────────────
  { url: 'https://www.janes.com/feeds/news',                        name: 'Janes Defence' },
  { url: 'https://www.defensenews.com/rss/',                        name: 'Defense News' },
  { url: 'https://www.stripes.com/feeds/world.rss',                 name: 'Stars & Stripes World' },
  { url: 'https://taskandpurpose.com/feed/',                        name: 'Task & Purpose' },
  { url: 'https://www.defenseone.com/rss/all/',                     name: 'Defense One' },
  { url: 'https://www.navaltoday.com/feed/',                        name: 'Naval Today' },
  { url: 'https://aviationweek.com/rss',                            name: 'Aviation Week' },
  { url: 'https://theaviationist.com/feed/',                        name: 'The Aviationist' },

  // ── 서아프리카 추가 ──────────────────────────────────────
  { url: 'https://www.guineaconakrynews.com/feed/',                 name: 'Guinea Conakry News' },
  { url: 'https://www.sierraleonetelegraph.com/feed/',              name: 'Sierra Leone Telegraph' },
  { url: 'https://frontpageafricaonline.com/feed/',                 name: 'FrontPage Africa LR' },
  { url: 'https://www.thepalavernewspaper.com/feed/',               name: 'Palaver LR' },
  { url: 'https://www.gambianow.com/feed/',                         name: 'Gambia Now' },
  { url: 'https://www.guineabissaunews.com/feed/',                  name: 'Guinea-Bissau News' },
  { url: 'https://www.malijet.com/feed/',                           name: 'Malijet' },
  { url: 'https://www.burkina24.com/feed/',                         name: 'Burkina24' },
  { url: 'https://www.actuniger.com/feed/',                         name: 'Actu Niger' },
  { url: 'https://www.journaldumali.com/feed/',                     name: 'Journal du Mali' },
  { url: 'https://www.seneweb.com/news/rss.php',                    name: 'Seneweb SN' },
  { url: 'https://www.dakarecho.com/feed/',                         name: 'Dakar Echo' },
  { url: 'https://www.icilome.com/feed/',                           name: 'Icilome TG' },
  { url: 'https://www.benin24.com/feed/',                           name: 'Benin24' },
  { url: 'https://www.connexion-ivoirienne.net/feed/',              name: 'Connexion Ivoirienne' },
  // ── 중앙아프리카 추가 ────────────────────────────────────
  { url: 'https://www.radiookapi.net/feed',                         name: 'Radio Okapi DRC' },
  { url: 'https://www.congoindependant.com/feed/',                  name: 'Congo Indépendant' },
  { url: 'https://www.actualite.cd/feed/',                          name: 'Actualite.cd DRC' },
  { url: 'https://www.rjdh.org/feed/',                              name: 'RJDH CAR' },
  { url: 'https://www.camernews.com/feed/',                         name: 'CamerNews CM' },
  { url: 'https://www.camer.be/feed/',                              name: 'Camer.be CM' },
  { url: 'https://gabonreview.com/feed/',                           name: 'Gabon Review' },
  { url: 'https://www.gabonactu.com/feed/',                         name: 'Gabon Actu' },
  // ── 동아프리카 추가 ──────────────────────────────────────
  { url: 'https://www.theeastafrican.co.ke/feed',                  name: 'East African Feed' },
  { url: 'https://www.businessdailyafrica.com/feed',               name: 'Business Daily KE' },
  { url: 'https://www.capitalfm.co.ke/news/feed/',                 name: 'Capital FM KE' },
  { url: 'https://www.kbc.co.ke/feed/',                            name: 'KBC Kenya' },
  { url: 'https://www.busiweek.com/feed/',                         name: 'Busiweek UG' },
  { url: 'https://www.theeastafrican.co.ke/rss/tea',               name: 'East African Tea' },
  { url: 'https://www.dailymaverick.co.za/feed/',                  name: 'Daily Maverick ZA' },
  { url: 'https://www.rwandaeye.com/feed/',                         name: 'Rwanda Eye' },
  { url: 'https://www.newtimes.co.rw/feed/',                       name: 'New Times RW' },
  { url: 'https://www.igihe.com/spip.php?page=backend',            name: 'Igihe RW' },
  { url: 'https://www.burundidaily.com/feed/',                      name: 'Burundi Daily' },
  { url: 'https://www.somalicurrent.com/feed/',                    name: 'Somali Current' },
  { url: 'https://garoweonline.com/feed/',                          name: 'Garowe Online SO' },
  { url: 'https://www.hiiraan.com/index.asp?fmt=rss',              name: 'Hiiraan SO' },
  // ── 남부아프리카 추가 ────────────────────────────────────
  { url: 'https://www.ewn.co.za/feed',                             name: 'Eyewitness News ZA' },
  { url: 'https://www.news24.com/news24/rss',                      name: 'News24 ZA' },
  { url: 'https://www.timeslive.co.za/rss/',                       name: 'Times Live ZA' },
  { url: 'https://www.herald.co.zw/feed/',                         name: 'The Herald ZW' },
  { url: 'https://www.newsday.co.zw/feed/',                        name: 'NewsDay ZW' },
  { url: 'https://mwnation.com/feed/',                             name: 'Malawi Nation' },
  { url: 'https://www.nyasatimes.com/feed/',                       name: 'Nyasa Times MW' },
  { url: 'https://www.lusakatimes.com/feed/',                      name: 'Lusaka Times ZM' },
  { url: 'https://www.mozambiqueminingpost.com/feed/',             name: 'Mozambique Post' },
  { url: 'https://www.macauhub.com.mo/feed/',                      name: 'Macauhub MZ' },
  // ── 북아프리카 추가 ──────────────────────────────────────
  { url: 'https://www.tsa-algerie.com/feed/',                      name: 'TSA Algérie' },
  { url: 'https://www.elwatan.com/feed',                           name: 'El Watan DZ' },
  { url: 'https://www.lematin.ma/rss',                             name: 'Le Matin MA' },
  { url: 'https://www.hespress.com/feed',                          name: 'Hespress MA' },
  { url: 'https://www.tap.info.tn/en/feed',                        name: 'TAP Tunisia' },
  { url: 'https://www.tunisienumerique.com/feed/',                 name: 'Tunisie Numerique' },
  { url: 'https://www.libyaobserver.ly/feed/',                     name: 'Libya Observer' },
  { url: 'https://www.middleeastmonitor.com/feed/',                name: 'Middle East Monitor' },
  // ── 뿔 아프리카·사헬 추가 ──────────────────────────────
  { url: 'https://www.addisstandard.com/feed/',                    name: 'Addis Standard ET' },
  { url: 'https://www.thereporterethiopia.com/feed/',              name: 'The Reporter ET' },
  { url: 'https://www.eritreahub.org/feed',                        name: 'Eritrea Hub' },
  { url: 'https://www.sudanakhbar.com/feed',                       name: 'Sudan Akhbar' },
  { url: 'https://www.dabangasudan.org/en/all-news/feed',          name: 'Dabanga Sudan' },
  { url: 'https://www.theafricareport.com/category/sahel/feed/',   name: 'Africa Report Sahel' },
  // ── 코카서스 추가 ────────────────────────────────────────
  { url: 'https://www.1lurer.am/en/feed',                          name: '1Lurer Armenia' },
  { url: 'https://www.azatutyun.am/api/zivqrkrvil',                name: 'Azatutyun Armenia' },
  { url: 'https://www.turan.az/ext/news/rss.php',                  name: 'Turan AZ' },
  { url: 'https://report.az/en/feed/',                             name: 'Report.az AZ' },
  { url: 'https://www.civil.ge/feed',                              name: 'Civil Georgia' },
  { url: 'https://www.interpressnews.ge/en/feed/',                 name: 'Interpress Georgia' },
  { url: 'https://www.agenda.ge/en/feed',                          name: 'Agenda Georgia' },
  // ── 발칸 추가 ────────────────────────────────────────────
  { url: 'https://www.slobodnaevropa.org/api/zivqrkrvil',          name: 'Slobodna Evropa' },
  { url: 'https://www.al-monitor.com/originals/rss',               name: 'Al Monitor Originals' },
  { url: 'https://europeanwesternbalkans.com/feed/',               name: 'European Western Balkans' },
  { url: 'https://www.tanjug.rs/eng/rss.aspx',                     name: 'Tanjug Serbia' },
  { url: 'https://www.total-croatia-news.com/feed/',               name: 'Total Croatia News' },
  { url: 'https://www.albanianews.al/feed/',                       name: 'Albania News' },
  { url: 'https://www.kosovapress.com/en/feed/',                   name: 'Kosova Press' },
  { url: 'https://www.meta.mk/en/feed/',                           name: 'Meta MK' },
  // ── 스칸디나비아/발트 추가 ──────────────────────────────
  { url: 'https://www.thelocal.se/feeds/rss.php',                  name: 'The Local Sweden' },
  { url: 'https://www.thelocal.no/feeds/rss.php',                  name: 'The Local Norway' },
  { url: 'https://www.thelocal.dk/feeds/rss.php',                  name: 'The Local Denmark' },
  { url: 'https://www.thelocal.fi/feeds/rss.php',                  name: 'The Local Finland' },
  { url: 'https://news.err.ee/rss',                                name: 'ERR Estonia' },
  { url: 'https://www.lrt.lt/en/news-in-english/rss',              name: 'LRT Lithuania' },
  { url: 'https://www.lsm.lv/en/rss/',                             name: 'LSM Latvia RSS' },
  { url: 'https://eng.ruv.is/rss',                                 name: 'RÚV Iceland' },
  // ── 남코카서스·중앙아시아 추가 ──────────────────────────
  { url: 'https://www.rferl.org/api/zivqrkrvil_az',                name: 'RFE/RL Azerbaijan' },
  { url: 'https://www.rferl.org/api/zivqrkrvil_ge',                name: 'RFE/RL Georgia' },
  { url: 'https://www.rferl.org/api/zivqrkrvil_am',                name: 'RFE/RL Armenia' },
  { url: 'https://www.rferl.org/api/zivqrkrvil_tm',                name: 'RFE/RL Turkmenistan' },
  { url: 'https://www.rferl.org/api/zivqrkrvil_mn',                name: 'RFE/RL Mongolia' },
  { url: 'https://akipress.com/rss.php',                           name: 'AKIpress KG' },
  { url: 'https://kabar.kg/eng/rss.xml',                           name: 'Kabar KG' },
  { url: 'https://tj.sputniknews.ru/export/rss2/index.xml',        name: 'Sputnik TJ' },
  { url: 'https://www.turkmenportal.com/en/feed/',                 name: 'Turkmenportal' },
  // ── 태평양 도서국 추가 ───────────────────────────────────
  { url: 'https://www.rnz.co.nz/rss/pacific.xml',                  name: 'RNZ Pacific RSS' },
  { url: 'https://www.pina.com.fj/category/news/feed/',            name: 'PINA Fiji Feed' },
  { url: 'https://www.fijisun.com.fj/feed/',                       name: 'Fiji Sun' },
  { url: 'https://www.fijivillage.com/rss',                        name: 'Fiji Village' },
  { url: 'https://www.solomonstarnews.com/index.php?format=feed',  name: 'Solomon Star' },
  { url: 'https://www.islandsbusiness.com/feed/',                  name: 'Islands Business' },
  { url: 'https://www.pacificbeat.net/feed/',                      name: 'Pacific Beat' },
  // ── 카리브해 추가 ────────────────────────────────────────
  { url: 'https://www.caribbeannationalweekly.com/feed/',          name: 'Caribbean National Weekly' },
  { url: 'https://www.loopnews.com/feed/',                         name: 'Loop News Caribbean' },
  { url: 'https://www.antiguaobserver.com/feed/',                  name: 'Antigua Observer' },
  { url: 'https://jamaica-gleaner.com/feed/rss',                   name: 'Jamaica Gleaner' },
  { url: 'https://www.nationnews.com/feed/',                       name: 'Nation News BB' },
  { url: 'https://www.trinidadexpress.com/feed/',                  name: 'Trinidad Express' },
  { url: 'https://www.guardian.co.tt/feed/',                       name: 'Trinidad Guardian' },
  { url: 'https://haitiantimes.com/feed/',                         name: 'Haitian Times' },
  { url: 'https://www.dominicantoday.com/feed/',                   name: 'Dominican Today' },
  { url: 'https://www.puertorico.com/feed/',                       name: 'Puerto Rico News' },
  // ── 중미 추가 ────────────────────────────────────────────
  { url: 'https://www.nacion.com/el-pais/rss/',                    name: 'La Nación CR' },
  { url: 'https://www.laprensalibre.cr/feed/',                     name: 'La Prensa Libre CR' },
  { url: 'https://www.prensalibre.com/feed/',                      name: 'Prensa Libre GT' },
  { url: 'https://www.elfaro.net/rss',                             name: 'El Faro SV' },
  { url: 'https://www.elheraldo.hn/feed/',                         name: 'El Heraldo HN' },
  { url: 'https://www.proceso.hn/feed/',                           name: 'Proceso HN' },
  { url: 'https://www.confidencial.com.ni/feed/',                  name: 'Confidencial NI' },
  { url: 'https://www.laprensa.com.ni/feed/',                      name: 'La Prensa NI' },
  { url: 'https://www.laestrella.com.pa/feed/',                    name: 'La Estrella PA' },
  { url: 'https://www.tvn-2.com/feed/',                            name: 'TVN Panama' },
  // ── 남미 추가 ────────────────────────────────────────────
  { url: 'https://www.pagina12.com.ar/rss/portada',                name: 'Página 12 AR' },
  { url: 'https://www.perfil.com/feed/',                           name: 'Perfil AR' },
  { url: 'https://www.ambito.com/rss/',                            name: 'Ámbito AR' },
  { url: 'https://www.estadao.com.br/rss/ultimas.xml',             name: 'Estadão BR' },
  { url: 'https://www.valor.com.br/feed',                          name: 'Valor Econômico BR' },
  { url: 'https://www.terra.com.br/noticias/rss',                  name: 'Terra BR' },
  { url: 'https://www.emol.com/rss',                               name: 'Emol CL' },
  { url: 'https://www.biobiochile.cl/feed/',                       name: 'BioBio CL' },
  { url: 'https://eldeber.com.bo/feed/',                           name: 'El Deber BO' },
  { url: 'https://www.lostiempos.com/feed',                        name: 'Los Tiempos BO' },
  { url: 'https://www.elcomercio.com/feed/',                       name: 'El Comercio EC' },
  { url: 'https://www.expreso.ec/feed/',                           name: 'Expreso EC' },
  { url: 'https://www.abc.com.py/feed/',                           name: 'ABC Color PY' },
  { url: 'https://www.ultimahora.com/feed/',                       name: 'Última Hora PY' },
  { url: 'https://www.elobservador.com.uy/feed/',                  name: 'El Observador UY' },
  { url: 'https://www.republica.com.uy/feed/',                     name: 'La República UY' },
  { url: 'https://talcualdigital.com/feed/',                       name: 'TalCual VE' },
  { url: 'https://efectococuyo.com/feed/',                         name: 'Efecto Cocuyo VE' },
  { url: 'https://www.larepublica.pe/feed/',                       name: 'La República PE' },
  { url: 'https://larazon.pe/feed/',                               name: 'La Razón PE' },
  // ── 우크라이나 전선 특화 ─────────────────────────────────
  { url: 'https://www.mil.gov.ua/en/rss',                          name: 'Ukraine MoD' },
  { url: 'https://www.ukrmilitary.com/feed',                       name: 'Ukraine Military' },
  { url: 'https://www.ukrinform.net/rss/block-ato',                name: 'Ukrinform ATO' },
  { url: 'https://liveuamap.com/rss',                              name: 'LiveUAmap' },
  { url: 'https://www.defenceblog.com/feed/',                      name: 'Defence Blog UA' },
  { url: 'https://mil.in.ua/en/feed/',                             name: 'MIL.IN.UA' },
  // ── 아시아 추가 ──────────────────────────────────────────
  { url: 'https://www.rfa.org/english/news/indonesia/rss2.xml',    name: 'RFA Indonesia' },
  { url: 'https://www.rfa.org/english/news/philippines/rss2.xml',  name: 'RFA Philippines' },
  { url: 'https://www.rfa.org/english/news/uyghur/rss2.xml',       name: 'RFA Uyghur' },
  { url: 'https://www.rfa.org/english/news/tibet/rss2.xml',        name: 'RFA Tibet' },
  { url: 'https://www.benarnews.org/english/news/rss',             name: 'BenarNews RSS' },
  { url: 'https://www.channelnewsasia.com/rss/8395884',            name: 'CNA Asia' },
  { url: 'https://www.channelnewsasia.com/rss/8395744',            name: 'CNA SE Asia' },
  { url: 'https://www.asean.org/feed/',                            name: 'ASEAN' },
  // ── 과학·보건 추가 ───────────────────────────────────────
  { url: 'https://www.science.org/rss/news_current.xml',           name: 'Science Magazine' },
  { url: 'https://www.nature.com/nature.rss',                      name: 'Nature' },
  { url: 'https://newscientist.com/feed/home/',                    name: 'New Scientist' },
  { url: 'https://www.scientificamerican.com/feed/rss/',           name: 'Scientific American' },
  { url: 'https://www.thelancet.com/rssfeed/lancet_current.xml',   name: 'The Lancet' },
  { url: 'https://www.nejm.org/action/showFeed?type=etoc',         name: 'NEJM' },
  { url: 'https://www.healthmap.org/rss/healthmap.rss',            name: 'HealthMap' },
  { url: 'https://www.cidrap.umn.edu/rss.xml',                     name: 'CIDRAP' },
  // ── 경제·금융 추가 ───────────────────────────────────────
  { url: 'https://www.ft.com/rss/home',                            name: 'FT Home' },
  { url: 'https://www.economist.com/finance-and-economics/rss.xml',name: 'Economist Finance' },
  { url: 'https://www.businessinsider.com/rss',                    name: 'Business Insider' },
  { url: 'https://fortune.com/feed/',                              name: 'Fortune' },
  { url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html',  name: 'CNBC World' },
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',          name: 'WSJ Markets' },
  { url: 'https://www.iif.com/Publications/RSS',                   name: 'IIF Finance' },
  { url: 'https://www.bis.org/rss/press.htm',                      name: 'BIS' },
  // ── 인권·법 추가 ─────────────────────────────────────────
  { url: 'https://www.icc-cpi.int/rss',                            name: 'ICC' },
  { url: 'https://www.icj.org/feed/',                              name: 'ICJ' },
  { url: 'https://www.aclu.org/news/rss.xml',                      name: 'ACLU' },
  { url: 'https://www.justiceinitiative.org/feeds/rss',            name: 'Open Society Justice' },
  { url: 'https://www.fidh.org/en/feed/',                          name: 'FIDH' },
  { url: 'https://www.phrusa.org/feed/',                           name: 'PHR' },
  // ── 환경·기후 추가2 ──────────────────────────────────────
  { url: 'https://www.theguardian.com/environment/climate-crisis/rss', name: 'Guardian Climate' },
  { url: 'https://www.climatecentral.org/feed',                    name: 'Climate Central' },
  { url: 'https://www.ecowatch.com/feed',                          name: 'EcoWatch' },
  { url: 'https://earthjustice.org/feed',                          name: 'Earthjustice' },
  { url: 'https://www.globalforestwatch.org/blog/feed/',           name: 'Global Forest Watch' },
  { url: 'https://news.mongabay.com/feed/',                        name: 'Mongabay' },
  { url: 'https://www.greenpeace.org/international/feed/',         name: 'Greenpeace' },
  { url: 'https://www.wwf.org.uk/feed',                            name: 'WWF' },
  // ── 이주·인신매매 추가 ───────────────────────────────────
  { url: 'https://www.iom.int/rss/latest',                         name: 'IOM Latest' },
  { url: 'https://mixedmigration.org/feed/',                       name: 'Mixed Migration' },
  { url: 'https://www.passblue.com/feed/',                         name: 'PassBlue UN' },
  { url: 'https://www.devex.com/news/rss.xml',                     name: 'Devex Aid' },
  { url: 'https://www.irinnews.org/rss.xml',                       name: 'IRIN News' },
  { url: 'https://www.alertnet.org/rss/latest.rss',                name: 'AlertNet' },
  // ── 아프리카 심층 ────────────────────────────────────────
  { url: 'https://www.dailymaverick.co.za/feed/',                  name: 'Daily Maverick ZA' },
  { url: 'https://www.news24.com/rss',                             name: 'News24 ZA' },
  { url: 'https://www.theeastafrican.co.ke/rss',                   name: 'The East African' },
  { url: 'https://www.standardmedia.co.ke/rss',                    name: 'Standard Media KE' },
  { url: 'https://www.monitor.co.ug/feed',                         name: 'Monitor UG' },
  { url: 'https://www.nation.africa/kenya/rss',                    name: 'Nation Africa KE' },
  { url: 'https://www.africanews.com/feed/rss',                    name: 'Africanews' },
  { url: 'https://www.theafricareport.com/feed/',                  name: 'The Africa Report' },
  { url: 'https://businessday.ng/feed/',                           name: 'BusinessDay NG' },
  { url: 'https://saharareporters.com/rss.xml',                    name: 'Sahara Reporters NG' },
  { url: 'https://punchng.com/feed/',                              name: 'Punch NG' },
  { url: 'https://www.vanguardngr.com/feed/',                      name: 'Vanguard NG' },
  { url: 'https://www.herald.co.zw/feed/',                         name: 'Herald ZW' },
  { url: 'https://www.lusakatimes.com/feed/',                      name: 'Lusaka Times ZM' },
  { url: 'https://www.rfi.fr/en/rss',                              name: 'RFI English' },
  { url: 'https://africa.cgtn.com/feed/',                          name: 'CGTN Africa' },
  // ── 중동 심층 ────────────────────────────────────────────
  { url: 'https://english.alarabiya.net/tools/rss',                name: 'Al Arabiya EN' },
  { url: 'https://www.al-monitor.com/rss',                         name: 'Al Monitor' },
  { url: 'https://www.irna.ir/rss/',                               name: 'IRNA Iran' },
  { url: 'https://en.mehrnews.com/rss',                            name: 'Mehr News IR' },
  { url: 'https://www.tasnimnews.com/en/rss',                      name: 'Tasnim News IR' },
  { url: 'https://www.kurdistan24.net/en/rss.xml',                 name: 'Kurdistan 24' },
  { url: 'https://rudaw.net/english/RSS',                          name: 'Rudaw KR' },
  { url: 'https://gulfnews.com/rss',                               name: 'Gulf News' },
  { url: 'https://www.khaleejtimes.com/rss',                       name: 'Khaleej Times' },
  { url: 'https://www.egyptindependent.com/feed/',                 name: 'Egypt Independent' },
  // ── 남아시아 심층 ────────────────────────────────────────
  { url: 'https://www.thedailystar.net/rss.xml',                   name: 'Daily Star BD' },
  { url: 'https://bdnews24.com/rss',                               name: 'bdnews24 BD' },
  { url: 'https://www.dailymirror.lk/RSS',                         name: 'Daily Mirror LK' },
  { url: 'https://myrepublica.nagariknetwork.com/rss',             name: 'Republica NP' },
  { url: 'https://www.thehimalayantimes.com/feed/',                name: 'Himalayan Times NP' },
  { url: 'https://www.brecorder.com/rss',                          name: 'Brecorder PK' },
  { url: 'https://www.thenews.com.pk/rss',                         name: 'The News PK' },
  { url: 'https://www.geo.tv/rss',                                 name: 'Geo TV PK' },
  { url: 'https://www.tolonews.com/rss.xml',                       name: 'Tolo News AF' },
  { url: 'https://www.khaama.com/feed/',                           name: 'Khaama Press AF' },
  // ── 동남아시아 심층 ──────────────────────────────────────
  { url: 'https://www.phnompenhpost.com/rss.xml',                  name: 'Phnom Penh Post' },
  { url: 'https://e.vnexpress.net/rss/news/latest.rss',            name: 'VnExpress EN' },
  { url: 'https://vietnamnews.vn/rss/latest-news.rss',             name: 'Vietnam News' },
  { url: 'https://www.irrawaddy.com/feed',                         name: 'Irrawaddy MM' },
  { url: 'https://www.mizzima.com/rss.xml',                        name: 'Mizzima MM' },
  { url: 'https://www.thejakartapost.com/feed/',                   name: 'Jakarta Post' },
  { url: 'https://www.rappler.com/feed',                           name: 'Rappler PH' },
  { url: 'https://newsinfo.inquirer.net/feed',                     name: 'Inquirer PH' },
  { url: 'https://www.freemalaysiatoday.com/feed/',                name: 'Free Malaysia Today' },
  // ── 동아시아 심층 ────────────────────────────────────────
  { url: 'https://www3.nhk.or.jp/rss/news/cat6.xml',              name: 'NHK Disaster' },
  { url: 'https://mainichi.jp/rss/etc/english.rss',                name: 'Mainichi EN' },
  { url: 'https://english.hani.co.kr/rss',                         name: 'Hankyoreh EN' },
  { url: 'https://focustaiwan.tw/rss.xml',                         name: 'Focus Taiwan' },
  { url: 'https://www.taipeitimes.com/xml/index.rss',              name: 'Taipei Times' },
  { url: 'https://www.rfa.org/english/news/northkorea/rss2.xml',   name: 'RFA North Korea' },
  { url: 'https://www.nknews.org/feed/',                           name: 'NK News' },
  // ── 분쟁·안보 특화 ───────────────────────────────────────
  { url: 'https://www.crisisgroup.org/rss.xml',                    name: 'Crisis Group ICG' },
  { url: 'https://www.sipri.org/rss.xml',                          name: 'SIPRI' },
  { url: 'https://foreignpolicy.com/feed/',                        name: 'Foreign Policy' },
  { url: 'https://www.foreignaffairs.com/rss.xml',                 name: 'Foreign Affairs' },
  { url: 'https://warontherocks.com/feed/',                        name: 'War on the Rocks' },
  { url: 'https://www.bellingcat.com/feed/',                       name: 'Bellingcat' },
  { url: 'https://thesoufancenter.org/feed/',                      name: 'Soufan Center' },
  { url: 'https://ctc.westpoint.edu/feed/',                        name: 'CTC West Point' },
  // ── 핵·WMD 특화 ─────────────────────────────────────────
  { url: 'https://www.armscontrol.org/rss.xml',                    name: 'Arms Control' },
  { url: 'https://www.nti.org/rss/',                               name: 'NTI Nuclear' },
  { url: 'https://thebulletin.org/feed/',                          name: 'Bulletin Atomic Scientists' },
  // ── 보건·전염병 특화 ─────────────────────────────────────
  { url: 'https://www.promedmail.org/rss/',                        name: 'ProMED' },
  { url: 'https://outbreaksnewstoday.com/feed/',                   name: 'Outbreak News Today' },
  { url: 'https://www.ecdc.europa.eu/en/rss.xml',                  name: 'ECDC EU' },
  { url: 'https://www.who.int/feeds/entity/csr/don/en/rss.xml',   name: 'WHO Disease Outbreak' },
  // ── 기후·재해 특화 ───────────────────────────────────────
  { url: 'https://www.carbonbrief.org/feed',                       name: 'Carbon Brief' },
  { url: 'https://insideclimatenews.org/feed/',                    name: 'Inside Climate News' },
  { url: 'https://reliefweb.int/updates/rss.xml',                  name: 'ReliefWeb Updates' },
  { url: 'https://news.mongabay.com/feed/',                        name: 'Mongabay' },
  // ── 사이버보안 특화 ──────────────────────────────────────
  { url: 'https://www.darkreading.com/rss.xml',                    name: 'Dark Reading' },
  { url: 'https://krebsonsecurity.com/feed/',                      name: 'Krebs Security' },
  { url: 'https://www.bleepingcomputer.com/feed/',                 name: 'BleepingComputer' },
  { url: 'https://www.cyberscoop.com/feed/',                       name: 'CyberScoop' },
  { url: 'https://securityaffairs.com/feed',                       name: 'Security Affairs' },
  // ── 라틴아메리카 심층 ────────────────────────────────────
  { url: 'https://www.infobae.com/feeds/rss/',                     name: 'Infobae AR' },
  { url: 'https://www.clarin.com/rss/lo-ultimo/',                  name: 'Clarín AR' },
  { url: 'https://g1.globo.com/rss/g1/',                           name: 'G1 Globo BR' },
  { url: 'https://www.elespectador.com/rss/',                      name: 'El Espectador CO' },
  { url: 'https://www.semana.com/rss.xml',                         name: 'Semana CO' },
  { url: 'https://elcomercio.pe/feed/',                            name: 'El Comercio PE' },
  { url: 'https://www.24horas.cl/feed/',                           name: '24horas CL' },
  { url: 'https://www.eluniversal.com.mx/rss.xml',                 name: 'El Universal MX' },
  { url: 'https://www.jornada.com.mx/rss/edicion.xml',             name: 'La Jornada MX' },
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
  Belize:[17,-88.8],Benin:[9.3,2.3],Bhutan:[27.5,90.5],Bolivia:[-17,-65],
  'Bosnia and Herzegovina':[44,17.5],Botswana:[-22,24],Brazil:[-10,-55],
  Brunei:[4.5,114.7],Bulgaria:[43,25],
  'Burkina Faso':[13,-2],Burundi:[-3.5,30],Cambodia:[13,105],Cameroon:[6,12],
  Canada:[60,-96],'Cape Verde':[15,-24],'Central African Republic':[7,21],Chad:[15,19],
  Chile:[-30,-71],China:[35,105],Colombia:[4,-72],Comoros:[-11.6,43.3],Congo:[-1,15],
  'Costa Rica':[10,-84],Croatia:[45.2,15.5],Cuba:[22,-79.5],Cyprus:[35,33],
  'Czech Republic':[49.75,15.5],Czechia:[49.75,15.5],
  'Democratic Republic of the Congo':[-4,22],DRC:[-4,22],
  Denmark:[56,10],Djibouti:[11.5,43],
  'Dominican Republic':[19,-70.7],Ecuador:[-2,-77.5],Egypt:[26,30],
  'El Salvador':[13.8,-88.9],Eritrea:[15,39],'Equatorial Guinea':[2,10],
  Estonia:[58.7,25.1],Eswatini:[-26.5,31.5],Ethiopia:[8,38],Fiji:[-18,178],
  Finland:[64,26],France:[46,2],Gabon:[-1,11.7],Gambia:[13.5,-15.5],
  Georgia:[42,43.5],Germany:[51,10],Ghana:[8,-2],Greece:[39,22],
  Guatemala:[15.5,-90.25],Guinea:[11,-10],'Guinea-Bissau':[12,-15],
  Guyana:[5,-59],Haiti:[19,-72.5],Honduras:[15,-86.5],Hungary:[47,19],
  Iceland:[65,-18],India:[20,77],Indonesia:[-5,120],Iran:[32,53],Iraq:[33,44],
  Ireland:[53,-8],Israel:[31.5,34.75],Italy:[42,12.5],'Ivory Coast':[7.5,-5.5],
  Jamaica:[18,-77.3],Japan:[36,138],Jordan:[31,36],Kazakhstan:[48,68],
  Kenya:[1,38],Kosovo:[42.6,20.9],Kuwait:[29.5,47.75],Kyrgyzstan:[41,75],
  Laos:[18,103],Latvia:[57,25],Lebanon:[33.85,35.9],Lesotho:[-29.5,28.3],
  Liberia:[6.5,-9.4],Libya:[27,17],Liechtenstein:[47.2,9.6],Lithuania:[56,24],
  Luxembourg:[49.75,6.17],Madagascar:[-20,47],Malawi:[-13.5,34],Malaysia:[2.5,112.5],
  Maldives:[3.2,73],Mali:[17,-4],Malta:[35.9,14.5],'Marshall Islands':[9,168],
  Mauritania:[20,-12],Mauritius:[-20.3,57.5],Mexico:[23,-102],
  Micronesia:[7,150],Moldova:[47,29],Monaco:[43.7,7.4],Mongolia:[46,105],
  Montenegro:[42.5,19.3],Morocco:[32,-5],Mozambique:[-18,35],Myanmar:[22,96],
  Namibia:[-22,17],Nepal:[28,84],Netherlands:[52.3,5.3],'New Zealand':[-42,174],
  Nicaragua:[13,-85],Niger:[17,8],Nigeria:[10,8],'North Korea':[40,127],
  'North Macedonia':[41.6,21.7],Norway:[64,26],Oman:[21,57],Pakistan:[30,70],
  Palau:[7.5,134.6],Palestine:[31.9,35.2],'Papua New Guinea':[-6,147],
  Panama:[9,-80],Paraguay:[-23,-58],Peru:[-10,-76],Philippines:[13,122],
  Poland:[52,20],Portugal:[39.5,-8],Qatar:[25.5,51.2],Romania:[46,25],Russia:[60,100],
  Rwanda:[-2,30],'Saint Lucia':[13.9,-60.98],'San Marino':[43.9,12.5],
  'São Tomé and Príncipe':[0.5,6.6],'Saudi Arabia':[24,45],Senegal:[14,-14],
  Serbia:[44,21],Seychelles:[-4.67,55.5],'Sierra Leone':[8.5,-12],Singapore:[1.35,103.82],
  Slovakia:[48.7,19.7],Slovenia:[46.1,14.8],'Solomon Islands':[-9,160],
  Somalia:[6,46],'South Africa':[-29,25],'South Korea':[36,128],'South Sudan':[7,30],
  Spain:[40,-4],'Sri Lanka':[7,81],Sudan:[15,30],Suriname:[4,-56],Sweden:[60,15],
  Switzerland:[47,8],Syria:[35,38],Taiwan:[23.5,121],Tajikistan:[39,71],
  Tanzania:[-6,35],Thailand:[15,100],'Timor-Leste':[-8.9,125.7],'East Timor':[-8.9,125.7],
  Togo:[8,1.2],Tonga:[-20,-175],Trinidad:[10.7,-61.2],'Trinidad and Tobago':[10.7,-61.2],
  Tunisia:[34,9],Turkey:[39,35],Turkmenistan:[40,60],Tuvalu:[-8,178],
  Uganda:[1,32],Ukraine:[49,32],'United Arab Emirates':[24,54],UAE:[24,54],
  'United Kingdom':[54,-2],UK:[54,-2],Britain:[54,-2],'United States':[38,-97],
  US:[38,-97],USA:[38,-97],Uruguay:[-33,-56],Uzbekistan:[41,64],Vanuatu:[-16,167],
  Venezuela:[8,-66],Vietnam:[16,108],Yemen:[15.5,47.5],Zambia:[-13.5,27.5],Zimbabwe:[-20,30],
  // 추가 별칭
  'South America':[-15,-60],'North America':[45,-100],'Latin America':[0,-70],
  'Middle East':[29,42],'Southeast Asia':[10,110],'Central Asia':[43,65],
  'East Africa':[0,35],'West Africa':[10,-5],'Central Africa':[5,20],
  'Sub-Saharan Africa':[5,20],'Eastern Europe':[50,30],'Western Europe':[48,5],
  Europe:[50,15],Africa:[10,20],Asia:[35,95],Americas:[0,-70],
  'Pacific':[0,170],'Arctic':[80,0],'Antarctic':[-80,0],
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
  // 우크라이나 전선 도시
  'Donetsk':[48.01,37.80],'Luhansk':[48.57,39.34],'Bakhmut':[48.60,38.00],
  'Avdiivka':[48.14,37.75],'Sevastopol':[44.60,33.52],
  'Mykolaiv':[46.97,32.00],'Sumy':[50.91,34.80],'Chernihiv':[51.49,31.29],
  'Kramatorsk':[48.73,37.56],'Sloviansk':[48.87,37.63],'Melitopol':[46.85,35.37],
  // 러시아 국경지역
  'Belgorod':[50.60,36.59],'Kursk':[51.73,36.19],'Bryansk':[53.25,34.37],
  'Voronezh':[51.67,39.18],'Rostov-on-Don':[47.23,39.72],'Krasnodar':[45.04,38.98],
  // 중국 추가 도시
  'Nanjing':[32.06,118.78],"Xi'an":[34.27,108.95],'Harbin':[45.75,126.65],
  'Shenyang':[41.79,123.43],'Jinan':[36.67,117.00],'Qingdao':[36.07,120.38],
  'Zhengzhou':[34.76,113.65],'Changsha':[28.23,112.94],'Fuzhou':[26.07,119.30],
  'Kunming':[25.04,102.71],'Nanchang':[28.68,115.88],'Hefei':[31.86,117.28],
  'Xiamen':[24.48,118.08],'Urumqi':[43.83,87.63],'Lanzhou':[36.06,103.79],
  'Changchun':[43.88,125.35],'Taiyuan':[37.87,112.55],'Guiyang':[26.58,106.71],
  'Nanning':[22.82,108.32],'Hohhot':[40.82,111.66],'Lhasa':[29.65,91.13],
  // 인도 추가 도시
  'Surat':[21.17,72.83],'Lucknow':[26.85,80.95],'Kanpur':[26.47,80.33],
  'Nagpur':[21.15,79.09],'Patna':[25.61,85.14],'Indore':[22.72,75.86],
  'Bhopal':[23.26,77.40],'Vadodara':[22.31,73.19],'Agra':[27.18,78.00],
  'Ludhiana':[30.90,75.85],'Nashik':[19.99,73.79],'Meerut':[28.98,77.71],
  'Varanasi':[25.32,83.01],'Srinagar':[34.09,74.80],'Amritsar':[31.64,74.87],
  'Visakhapatnam':[17.69,83.23],'Coimbatore':[11.00,76.96],'Kochi':[9.93,76.27],
  // 미국 추가 도시
  'Austin':[30.27,-97.74],'Charlotte':[35.23,-80.84],'Raleigh':[35.78,-78.64],
  'Memphis':[35.15,-90.05],'Louisville':[38.25,-85.76],'Richmond':[37.54,-77.43],
  'Indianapolis':[39.77,-86.16],'Columbus':[39.96,-82.99],'Detroit':[42.33,-83.05],
  'Kansas City':[39.10,-94.58],'Salt Lake City':[40.76,-111.89],'Tucson':[32.22,-110.97],
  'Sacramento':[38.58,-121.49],'San Jose':[37.34,-121.89],'Fort Worth':[32.75,-97.33],
  'El Paso':[31.76,-106.49],'Jacksonville':[30.33,-81.66],'Milwaukee':[43.04,-87.91],
  'Albuquerque':[35.08,-106.65],'Omaha':[41.26,-95.93],'Honolulu':[21.31,-157.86],
  'Anchorage':[61.22,-149.90],'Tampa':[27.95,-82.46],'Pittsburgh':[40.44,-79.99],
  'Cincinnati':[39.10,-84.51],'St. Louis':[38.63,-90.20],'Cleveland':[41.50,-81.69],
  // 영국 추가 도시
  'Leeds':[53.80,-1.55],'Sheffield':[53.38,-1.47],'Liverpool':[53.41,-2.98],
  'Bristol':[51.45,-2.59],'Edinburgh':[55.95,-3.19],'Cardiff':[51.48,-3.18],
  'Newcastle':[54.97,-1.62],'Leicester':[52.64,-1.13],'Nottingham':[52.95,-1.15],
  // 독일 추가 도시
  'Stuttgart':[48.78,9.18],'Dresden':[51.05,13.74],'Leipzig':[51.34,12.37],
  'Hannover':[52.37,9.73],'Nuremberg':[49.45,11.08],'Bremen':[53.08,8.80],
  'Düsseldorf':[51.23,6.78],'Dortmund':[51.52,7.47],'Essen':[51.46,7.01],
  // 프랑스 추가 도시
  'Nice':[43.70,7.26],'Bordeaux':[44.84,-0.58],'Strasbourg':[48.58,7.75],
  'Nantes':[47.22,-1.55],'Lille':[50.63,3.07],'Rennes':[48.11,-1.68],
  // 이탈리아 추가 도시
  'Florence':[43.77,11.26],'Venice':[45.44,12.33],'Bologna':[44.49,11.34],
  'Palermo':[38.13,13.33],'Genoa':[44.41,8.93],'Catania':[37.50,15.09],
  // 이스라엘·팔레스타인 세부
  'Rafah':[31.29,34.25],'Khan Yunis':[31.34,34.30],'Nablus':[32.22,35.26],
  'Jenin':[32.46,35.30],'Beer Sheva':[31.25,34.79],'Ashdod':[31.80,34.65],
  // 이란 추가
  'Tabriz':[38.07,46.30],'Shiraz':[29.62,52.53],'Ahvaz':[31.32,48.67],'Qom':[34.64,50.88],
  // 이라크 추가
  'Kirkuk':[35.47,44.39],'Najaf':[32.02,44.34],'Karbala':[32.61,44.02],'Sulaymaniyah':[35.56,45.43],
  // 시리아 추가
  'Hama':[35.13,36.75],'Deir ez-Zor':[35.33,40.14],'Raqqa':[35.95,39.01],'Latakia':[35.52,35.79],
  // 예멘 추가
  'Taiz':[13.58,44.02],'Ibb':[13.97,44.18],'Marib':[15.46,45.33],
  // 미얀마 추가
  'Meiktila':[20.87,95.86],'Myitkyina':[25.38,97.39],'Sittwe':[20.15,92.90],
  // 에티오피아 추가
  'Mekelle':[13.49,39.47],'Gondar':[12.60,37.47],'Hawassa':[7.06,38.47],
  // 수단 추가
  'El Fasher':[13.63,25.35],'El Obeid':[13.18,30.22],'Kassala':[15.45,36.40],
  // 사헬 지역
  'Maiduguri':[11.84,13.16],'Sokoto':[13.06,5.24],'Gao':[16.27,-0.04],'Timbuktu':[16.77,-3.00],
  // 남미 추가
  'Barranquilla':[10.96,-74.80],'Cartagena':[10.40,-75.51],
  'Maracaibo VE':[10.67,-71.61],'Valencia VE':[10.18,-68.00],'Barquisimeto':[10.07,-69.32],
  'Cochabamba':[-17.39,-66.16],'Sucre':[-19.05,-65.26],
  'Cuenca':[-2.90,-79.00],
  'Trujillo':[-8.11,-79.02],'Chiclayo':[-6.78,-79.84],'Iquitos':[-3.74,-73.25],
  'Mendoza':[-32.89,-68.83],'Tucumán':[-26.82,-65.22],'Mar del Plata':[-38.00,-57.55],
  'Concepción':[-36.82,-73.05],'Antofagasta':[-23.65,-70.40],
}

/** 주·도·지역 단위 좌표 DB (도시보다 넓고 국가보다 좁은 중간 레이어) */
const REGION_COORDS: Record<string, readonly [number, number]> = {
  // 미국 주
  'California':[36.78,-119.42],'Texas':[31.97,-99.90],'Florida':[27.99,-81.76],
  'New York State':[42.97,-75.52],'Pennsylvania':[41.20,-77.19],'Illinois':[40.35,-88.99],
  'Ohio':[40.41,-82.71],'Georgia':[32.16,-82.90],'North Carolina':[35.63,-79.81],
  'Michigan':[44.31,-85.60],'New Jersey':[40.06,-74.41],'Virginia':[37.93,-79.02],
  'Washington State':[47.51,-120.74],'Arizona':[34.04,-111.09],'Massachusetts':[42.41,-71.38],
  'Tennessee':[35.86,-86.35],'Indiana':[40.27,-86.13],'Missouri':[38.46,-92.29],
  'Maryland':[39.05,-76.64],'Wisconsin':[44.27,-89.62],'Colorado':[39.55,-105.78],
  'Minnesota':[46.39,-94.64],'South Carolina':[33.84,-81.16],'Alabama':[32.32,-86.90],
  'Louisiana':[31.07,-91.96],'Kentucky':[37.67,-84.67],'Oregon':[44.57,-122.07],
  'Oklahoma':[35.57,-96.93],'Connecticut':[41.60,-72.72],'Utah':[39.32,-111.09],
  'Iowa':[42.03,-93.21],'Nevada':[38.80,-116.42],'Arkansas':[34.97,-92.37],
  'Mississippi':[32.74,-89.67],'Kansas':[38.53,-96.73],'Nebraska':[41.49,-99.90],
  'Idaho':[44.24,-114.48],'Montana':[46.88,-110.36],'Alaska':[64.20,-153.37],
  // 인도 주
  'Uttar Pradesh':[26.85,80.91],'Maharashtra':[19.66,75.31],'Bihar':[25.09,85.31],
  'West Bengal':[22.98,87.85],'Madhya Pradesh':[23.47,77.95],'Tamil Nadu':[11.13,78.66],
  'Rajasthan':[27.02,74.21],'Karnataka':[15.32,75.71],'Gujarat':[22.26,71.19],
  'Andhra Pradesh':[15.91,79.74],'Odisha':[20.94,84.80],'Telangana':[17.86,79.01],
  'Kerala':[10.85,76.27],'Jharkhand':[23.61,85.28],'Assam':[26.20,92.93],
  'Punjab':[31.15,75.34],'Haryana':[29.06,76.08],'Uttarakhand':[30.07,79.02],
  'Jammu':[32.73,74.87],'Kashmir':[34.08,74.80],
  // 중국 성
  'Guangdong':[23.37,113.50],'Shandong':[36.67,118.00],'Henan':[34.29,113.74],
  'Sichuan':[30.66,102.88],'Jiangsu':[32.97,119.46],'Hubei':[30.96,112.27],
  'Hunan':[27.62,111.72],'Anhui':[31.86,117.28],'Hebei':[38.04,114.51],
  'Zhejiang':[29.18,120.10],'Yunnan':[24.47,101.35],'Shaanxi':[35.20,108.94],
  'Liaoning':[41.30,122.60],'Heilongjiang':[47.86,127.74],'Shanxi':[37.87,112.55],
  'Xinjiang':[43.83,87.63],'Tibet':[29.65,91.13],'Hainan':[19.20,109.74],
  // 러시아 지역
  'Siberia':[60.00,100.00],'Ural':[58.00,60.00],'Far East':[55.00,135.00],
  'Chechnya':[43.40,45.71],'Dagestan':[42.47,47.10],'Tatarstan':[55.79,49.12],
  // 독일 주
  'Bavaria':[48.92,11.41],'Saxony':[51.10,13.20],'Brandenburg':[52.41,12.53],
  'Thuringia':[50.91,11.00],'Hesse':[50.65,8.99],'North Rhine-Westphalia':[51.43,7.66],
  // 영국 지역
  'Scotland':[56.49,-4.20],'Wales':[52.13,-3.78],'Northern Ireland':[54.60,-6.76],
  'Yorkshire':[53.96,-1.08],'Lancashire':[53.76,-2.70],'Midlands':[52.48,-1.90],
  // 우크라이나 주
  'Donbas':[48.00,38.00],'Crimea':[44.95,34.10],'Kharkiv Oblast':[49.90,36.50],
  // 중동 지역
  'West Bank':[31.95,35.30],'Gaza Strip':[31.35,34.35],
  'Kurdistan':[36.80,44.60],'Sinai':[29.86,34.04],
  // 아프리카 지역
  'Sahel':[15.00,0.00],'Darfur':[13.50,24.50],'Tigray':[13.90,38.50],
  'Sahara':[23.00,12.00],'Katanga':[-9.00,26.00],
  // 동남아 지역
  'Mindanao':[7.87,124.86],'Luzon':[16.00,121.00],'Sumatra':[0.59,101.34],
  'Borneo':[1.00,114.00],'Papua':[-4.00,136.00],
}

// ── 추가 도시 (CITY_COORDS 확장) ──────────────────────────
Object.assign(CITY_COORDS, {
  // 일본
  'Nagoya':[35.18,136.91],'Sapporo':[43.06,141.35],'Fukuoka':[33.59,130.40],
  'Kobe':[34.69,135.20],'Sendai':[38.27,140.87],'Kitakyushu':[33.88,130.88],
  'Kawasaki':[35.52,139.72],'Saitama':[35.86,139.65],'Kumamoto':[32.80,130.71],
  'Naha':[26.21,127.68],'Nagasaki':[32.74,129.87],'Kagoshima':[31.60,130.56],
  // 한국
  'Daegu':[35.87,128.60],'Gwangju':[35.16,126.85],'Daejeon':[36.35,127.39],
  'Ulsan':[35.54,129.31],'Suwon':[37.27,127.01],'Changwon':[35.23,128.68],
  // 중국 추가
  'Suzhou':[31.30,120.60],'Hangzhou':[30.27,120.15],'Ningbo':[29.87,121.54],
  'Wuxi':[31.57,120.30],'Zibo':[36.79,118.05],'Tangshan':[39.63,118.18],
  'Shijiazhuang':[38.04,114.50],'Wenzhou':[28.02,120.67],'Foshan':[23.02,113.12],
  'Dongguan':[23.02,113.75],'Zhongshan':[22.52,113.39],'Zhuhai':[22.27,113.57],
  // 인도 추가
  'Rajkot':[22.30,70.78],'Jodhpur':[26.29,73.03],'Raipur':[21.25,81.63],
  'Ranchi':[23.34,85.31],'Gwalior':[26.22,78.18],'Jabalpur':[23.18,79.95],
  'Kota':[25.18,75.85],'Thiruvananthapuram':[8.52,76.94],'Kozhikode':[11.25,75.78],
  'Madurai':[9.92,78.12],'Tiruchirappalli':[10.79,78.70],'Salem':[11.65,78.15],
  'Guwahati':[26.18,91.75],'Shillong':[25.57,91.89],'Imphal':[24.82,93.95],
  'Dehradun':[30.32,78.03],'Shimla':[31.10,77.17],'Chandigarh':[30.74,76.79],
  // 파키스탄
  'Quetta':[30.19,67.00],'Multan':[30.20,71.47],'Rawalpindi':[33.60,73.04],
  'Faisalabad':[31.42,73.08],'Hyderabad Sindh':[25.37,68.37],'Gujranwala':[32.16,74.19],
  // 방글라데시
  'Sylhet':[24.90,91.87],'Rajshahi':[24.37,88.60],'Khulna':[22.85,89.57],
  // 스리랑카
  'Kandy':[7.29,80.64],'Jaffna':[9.67,80.02],'Galle':[6.05,80.22],
  // 인도네시아
  'Bandung':[-6.92,107.61],'Makassar':[-5.15,119.41],'Semarang':[-7.00,110.42],
  'Palembang':[-2.99,104.76],'Banjarmasin':[-3.32,114.59],'Padang':[-0.95,100.35],
  // 필리핀
  'Zamboanga':[6.91,122.07],'Cagayan de Oro':[8.48,124.65],'General Santos':[6.11,125.17],
  'Iloilo':[10.72,122.57],'Bacolod':[10.68,122.95],'Tacloban':[11.24,125.00],
  // 태국
  'Hat Yai':[7.01,100.47],'Khon Kaen':[16.43,102.83],'Chiang Rai':[19.91,99.83],
  'Nakhon Ratchasima':[14.97,102.10],'Udon Thani':[17.41,102.79],
  // 베트남
  'Hue':[16.47,107.60],'Can Tho':[10.03,105.79],'Nha Trang':[12.25,109.18],
  'Hai Phong':[20.86,106.68],'Bien Hoa':[10.95,106.82],
  // 미얀마
  'Mawlamyine':[16.49,97.63],'Pathein':[16.78,94.73],'Loikaw':[19.68,97.21],
  // 러시아
  'Omsk':[54.99,73.37],'Samara':[53.20,50.15],'Perm':[58.01,56.23],
  'Ufa':[54.74,55.97],'Volgograd':[48.71,44.51],'Krasnoyarsk':[56.01,92.88],
  'Saratov':[51.53,46.03],'Tolyatti':[53.51,49.42],'Izhevsk':[56.85,53.21],
  'Khabarovsk':[48.48,135.08],'Chelyabinsk':[55.16,61.40],'Orenburg':[51.77,55.10],
  // 아프리카 추가
  'Douala':[4.05,9.70],'Yaoundé':[3.87,11.52],'Lilongwe':[-13.97,33.79],
  'Blantyre':[-15.79,35.00],'Beira':[-19.84,34.84],'Mombasa':[-4.05,39.67],
  'Nakuru':[-0.27,36.07],'Eldoret':[0.52,35.27],'Entebbe':[0.05,32.46],
  'Mwanza':[-2.52,32.90],'Arusha':[-3.37,36.68],'Zanzibar':[-6.17,39.20],
  'Lubango':[-14.92,13.49],'Huambo':[-12.78,15.74],
  'Tamale':[9.40,-0.85],'Sekondi':[-4.93,-1.70],
  'Kigali':[-1.95,30.06],'Gitega':[-3.43,29.92],
  'Hargeisa':[9.56,44.07],'Berbera':[10.44,45.02],
  'Tobruk':[32.08,23.97],'Misrata':[32.37,15.09],'Sabha':[27.04,14.43],
  'Sfax':[34.74,10.76],'Sousse':[35.83,10.64],
  // 유럽 추가
  'Luxembourg City':[49.61,6.13],'Vaduz':[47.14,9.52],
  'Tallinn':[59.44,24.75],'Tartu':[58.38,26.72],
  'Vilnius':[54.69,25.28],'Kaunas':[54.90,23.90],
  'Riga':[56.95,24.11],'Daugavpils':[55.87,26.54],
  'Reykjavik':[64.14,-21.95],
  'Minsk':[53.90,27.57],'Gomel':[52.44,30.99],'Brest':[52.10,23.68],
  'Chisinau':[47.00,28.86],
  'Tirana':[41.33,19.83],'Durrës':[41.32,19.45],
  'Podgorica':[42.44,19.26],'Prishtina':[42.67,21.17],
  'Skopje':[41.99,21.43],'Ohrid':[41.12,20.80],
  'Sarajevo':[43.85,18.36],'Banja Luka':[44.77,17.19],
  'Nicosia':[35.17,33.37],'Limassol':[34.68,33.04],
  // 중동 추가
  'Zarqa':[32.07,36.09],'Irbid':[32.55,35.85],'Aqaba':[29.53,35.00],
  'Hodeida':[14.80,43.00],'Al Mukalla':[14.55,49.13],
  'Sohar':[24.36,56.74],'Salalah':[17.02,54.09],
  'Al Ain':[24.23,55.76],'Fujairah':[25.12,56.34],
  'Tabuk':[28.39,36.57],'Dammam':[26.43,50.10],'Al Hofuf':[25.38,49.59],
  // 북미 추가
  'Quebec City':[46.81,-71.21],'Halifax':[44.65,-63.60],'Victoria':[48.43,-123.37],
  'Regina':[50.45,-104.61],'Saskatoon':[52.13,-106.67],
  'Guadalajara MX':[20.68,-103.35],'Puebla':[19.04,-98.20],'León':[21.12,-101.67],
  'Ciudad Juárez':[31.73,-106.49],'Mérida MX':[20.97,-89.62],'Acapulco':[16.86,-99.88],
  // 중남미 추가
  'Cali':[3.44,-76.52],'Bucaramanga':[7.12,-73.12],'Pereira':[4.81,-75.69],
  'Maracay':[10.24,-67.59],'Ciudad Guayana':[8.35,-62.64],
  'Belém':[-1.46,-48.50],'Goiânia':[-16.68,-49.26],'Florianópolis':[-27.59,-48.55],
  'Natal':[-5.79,-35.21],'Maceió':[-9.67,-35.74],'Teresina':[-5.09,-42.80],
  'Cúcuta':[7.89,-72.51],'Ibagué':[4.44,-75.23],
  'Trujillo PE':[-8.11,-79.02],'Chiclayo':[-6.78,-79.84],'Iquitos':[-3.74,-73.25],
  'Arequipa':[-16.41,-71.54],'Cusco':[-13.53,-71.97],
  'Santa Cruz BO':[-17.79,-63.18],'Cochabamba':[-17.39,-66.16],
  'Asunción':[-25.29,-57.64],'Ciudad del Este':[-25.51,-54.62],
  'Montevideo':[-34.90,-56.19],'Salto':[-31.38,-57.96],
  'Rosario':[-32.95,-60.66],'Córdoba AR':[-31.42,-64.18],'Mendoza':[-32.89,-68.83],
  'Santiago':[-33.46,-70.65],'Valparaíso':[-33.05,-71.62],'Antofagasta':[-23.65,-70.40],
  // 카리브해
  'Port-of-Spain':[10.65,-61.52],'Bridgetown':[13.10,-59.62],
  'Nassau':[25.04,-77.35],'Georgetown GY':[6.80,-58.16],
  'Paramaribo':[5.87,-55.17],'Cayenne':[4.93,-52.33],
  // 태평양 도서국 수도
  'Nuku\'alofa':[-21.13,-175.20],'Apia':[-13.83,-171.77],'Funafuti':[-8.52,179.19],
  'Honiara':[-9.43,160.05],'Port Vila':[-17.73,168.32],'Suva':[-18.14,178.44],
  'Ngerulmud':[7.50,134.62],'Palikir':[6.92,158.16],'Majuro':[7.09,171.38],
  'Tarawa':[1.33,173.00],'South Tarawa':[1.35,173.02],'Yaren':[-0.55,166.92],
  // 아프리카 추가 수도·주요도시
  'Malabo':[3.75,8.78],'São Tomé':[0.34,6.73],'Praia':[14.93,-23.51],
  'Moroni':[-11.70,43.26],'Victoria SC':[-4.62,55.45],'Asmara':[15.33,38.93],
  'Maseru':[-29.32,27.48],
  'Mbabane':[-26.32,31.13],'Windhoek':[-22.56,17.08],'Gaborone':[-24.65,25.91],
  'Libreville':[0.39,9.45],'Bangui':[4.36,18.56],'Brazzaville':[-4.27,15.28],
  'Bissau':[11.86,-15.60],'Conakry':[9.54,-13.68],'Freetown':[8.49,-13.23],
  'Monrovia':[6.30,-10.80],'Yamoussoukro':[6.82,-5.29],
  // 분쟁·분리주의 지역
  'Soledar':[48.68,38.10],'Toretsk':[48.40,37.86],'Chasiv Yar':[48.60,37.85],
  'Vuhledar':[47.83,37.25],'Robotyne':[47.46,35.83],'Orikhiv':[47.55,35.79],
  'Huliaipole':[47.66,36.26],'Kostiantynivka':[48.53,37.72],
  'Marinka':[47.95,37.51],'Volnovakha':[47.60,37.50],
  // 사헬 분쟁지역 도시
  'Sévaré':[14.53,-4.10],'Mopti':[14.49,-4.20],'Kidal':[18.44,1.41],
  'Ménaka':[15.91,2.40],'Tillabéri':[14.21,1.45],'Agadez':[16.97,7.99],'Diffa':[13.32,12.62],
  'Bossangoa':[6.49,17.46],'Bambari':[5.76,20.68],'Kaga-Bandoro':[6.99,19.18],
  'Bamenda':[5.96,10.16],'Buea':[4.15,9.23],
  // 중앙아시아 추가
  'Osh':[40.52,72.82],'Jalal-Abad':[40.93,73.00],'Namangan':[41.00,71.67],
  'Andijan':[40.78,72.34],'Fergana':[40.39,71.79],'Samarkand':[39.65,66.98],
  'Bukhara':[39.77,64.42],'Nukus':[42.45,59.60],'Mary':[37.59,61.82],
  'Khujand':[40.28,69.62],'Kulob':[37.91,69.80],
  // 코카서스 추가
  'Stepanakert':[39.82,46.75],'Gyumri':[40.79,43.84],'Vanadzor':[40.81,44.49],
  'Rustavi':[41.55,44.99],'Kutaisi':[42.27,42.70],'Batumi':[41.65,41.64],
  'Ganja':[40.68,46.36],'Sumqayit':[40.59,49.65],'Nakhchivan':[39.21,45.41],

  // ── 추가 도시 (기존 DB에 없는 것만) ──
  // 미국
  'Oklahoma City':[35.47,-97.52],'Virginia Beach':[36.85,-75.98],
  'Orlando':[28.54,-81.38],'Buffalo':[42.89,-78.87],
  // 유럽
  'Bilbao':[43.26,-2.93],'Malaga':[36.72,-4.42],'Heraklion':[35.34,25.14],
  'Bursa':[40.19,29.06],'Konya':[37.87,32.48],'Monaco':[43.73,7.42],
  // 중동
  'Fallujah':[33.35,43.79],'Kirkuk':[35.47,44.39],'Najaf':[32.00,44.34],
  'Karbala':[32.62,44.03],'Idlib':[35.93,36.63],'Sanaa':[15.35,44.21],
  // 남아시아
  'Thimphu':[27.47,89.64],'Pokhara':[28.21,83.99],'Hyderabad PK':[25.39,68.37],
  // 동남아시아
  'Haiphong':[20.86,106.68],'Tangerang':[-6.18,106.63],
  'Depok':[-6.40,106.82],'Ipoh':[4.60,101.08],'Kota Kinabalu':[5.98,116.07],
  'Kuching':[1.55,110.34],'George Town':[5.41,100.34],'Quezon City':[14.68,121.04],
  'Cebu City':[10.32,123.90],'Marawi':[7.99,124.29],'Cotabato':[7.22,124.25],
  'Pakse':[15.12,105.79],'Lashio':[22.93,97.75],
  // 동아시아
  'Yokohama':[35.44,139.64],'Taichung':[24.15,120.67],'Tainan':[22.99,120.22],
  // 아프리카
  'N Djamena':[12.11,15.04],'Nouakchott':[18.08,-15.97],'Porto Novo':[6.50,2.63],
  'Port Elizabeth':[-33.96,25.61],'Mbuji-Mayi':[-6.15,23.60],'Bukavu':[-2.51,28.86],
  'Kananga':[-5.90,22.42],'Benin City':[6.34,5.63],'Jos':[9.93,8.89],
  'Warri':[5.52,5.75],'Kaduna':[10.52,7.44],'Zaria':[11.08,7.71],
  // 중남미
  'Campinas':[-22.91,-47.06],'Curitiba':[-25.43,-49.27],
  'San Jose CR':[9.93,-84.08],'San Juan':[18.47,-66.11],
  // 오세아니아
  'Darwin':[-12.46,130.84],'Hobart':[-42.88,147.33],
  'Noumea':[-22.27,166.46],'Papeete':[-17.54,-149.57],'Nuku alofa':[-21.14,-175.22],

} as Record<string, readonly [number, number]>)

// ── 도시 추출 최적화: 모듈 레벨 캐시 ──────────────────────
/** 소문자 도시명 → { 표준명, 좌표 } 해시맵 (O(1) 조회) */
const _cityMap = new Map(
  Object.entries(CITY_COORDS).map(([k, v]) => [k.toLowerCase(), { name: k, c: v }])
)
/** 역사적·현지 별칭 → 표준 소문자 도시명 */
const CITY_ALIASES: Record<string, string> = {
  'peking':'beijing','peiping':'beijing','canton':'guangzhou','mukden':'shenyang',
  'bombay':'mumbai','calcutta':'kolkata','madras':'chennai','bangalore':'bangalore',
  'saigon':'ho chi minh city','ho chi minh':'ho chi minh city',
  'rangoon':'yangon','dacca':'dhaka',
  'kiev':'kyiv','kharkov':'kharkiv','odessa':'odessa',
  'leningrad':'saint petersburg','petrograd':'saint petersburg',
  'leopoldville':'kinshasa','elisabethville':'lubumbashi','salisbury':'harare',
  'stanleyville':'kisangani','lourenco marques':'maputo',
  'christiania':'oslo','helsingfors':'helsinki',
  'batavia':'jakarta','formosa':'taipei',
  'aden':'aden','mecca':'mecca','jeddah':'jeddah',
  'tehran':'tehran','teheran':'tehran',
  'moscow':'moscow','moskov':'moscow',
  'petrópolis':'rio de janeiro',
  'port au prince':'port-au-prince','port-au-prince':'port au prince',
  'new york city':'new york','nyc':'new york','ny':'new york',
  'la':'los angeles','l.a.':'los angeles','sf':'san francisco',
  'd.c.':'washington','dc':'washington','d.c':'washington',
  'the hague':'amsterdam','den haag':'amsterdam',
  'cologne':'cologne','köln':'cologne',
  'munich':'munich','münchen':'munich',
  'vienna':'vienna','wien':'vienna',
  'rome':'rome','roma':'rome',
  'athens':'athens','athina':'athens',
  'warsaw':'warsaw','warszawa':'warsaw',
  'prague':'prague','praha':'prague',
  'budapest':'budapest','bucharest':'bucharest',
  'istanbul':'istanbul','constantinople':'istanbul',
  'beijing':'beijing',
  'seoul':'seoul','busan':'busan',
  'tokyo':'tokyo','osaka':'osaka',
  'mexico city':'mexico city','ciudad de mexico':'mexico city',
  'buenos aires':'buenos aires','sao paulo':'sao paulo',
  'rio':'rio de janeiro','rio de janeiro':'rio de janeiro',
  'bogota':'bogota','bogotá':'bogota',
  'lima':'lima','santiago':'santiago',
  'lagos':'lagos','nairobi':'nairobi','cairo':'cairo',
  'johannesburg':'johannesburg','jo burg':'johannesburg','joburg':'johannesburg',
  'cape town':'cape town','capetown':'cape town',
  'new delhi':'new delhi','delhi':'new delhi',
  'mumbai':'mumbai','kolkata':'kolkata','chennai':'chennai',
  'dhaka':'dhaka','karachi':'karachi','lahore':'lahore',
  'kabul':'kabul','baghdad':'baghdad',
  'riyadh':'riyadh','dubai':'dubai',
  'tel aviv':'tel aviv','jerusalem':'jerusalem','gaza city':'gaza',
  'tripoli':'tripoli (libya)',
  'phnom penh':'phnom penh','vientiane':'vientiane',
  'kuala lumpur':'kuala lumpur','kl':'kuala lumpur',
  'ho chi minh city':'ho chi minh city','hcmc':'ho chi minh city',
  'xi\'an':'xi an','xian':'xi an',
}
/** 전치사 패턴: "in Cairo", "near Aleppo", "from Kyiv" */
const _PREP_RE = /\b(?:in|near|at|from|outside|around|across|throughout|into|within|toward|towards)\s+([A-Z][a-záéíóúàèìòùäëïöüâêîôûçñ]+(?:[\s-][A-Z][a-záéíóúàèìòùäëïöüâêîôûçñ]+){0,2})/g
/** 긴 이름 우선 정렬된 도시 목록 (캐시) */
const _sortedCities = Object.entries(CITY_COORDS).sort((a, b) => b[0].length - a[0].length)
const _sortedRegions = Object.entries(REGION_COORDS).sort((a, b) => b[0].length - a[0].length)

/** 소문자 도시명 → 좌표 반환 (별칭 포함) */
function lookupCity(raw: string): readonly [number, number, string, number] | null {
  const lower = raw.toLowerCase().trim()
  const direct = _cityMap.get(lower)
  if (direct) return [direct.c[0], direct.c[1], direct.name, 0.12]
  const alias = CITY_ALIASES[lower]
  if (alias) {
    const a = _cityMap.get(alias)
    if (a) return [a.c[0], a.c[1], a.name, 0.12]
  }
  return null
}

/** 단어경계 확인 (짧은 도시명의 오탐 방지) */
function hasWordBoundary(text: string, idx: number, len: number): boolean {
  const before = idx === 0 || !/[a-zA-Z]/.test(text[idx - 1])
  const after  = idx + len >= text.length || !/[a-zA-Z]/.test(text[idx + len])
  return before && after
}

interface _Candidate {
  lat: number; lng: number; name: string; jitter: number; score: number
}
// 컨텍스트 패턴: "city of X", "X province/state/oblast" 등
const _CTX_RE = /\b(?:city of|capital of|province of|region of|state of|port of|district of|in the city of|town of)\s+([A-Z][a-záéíóúàèìòùäëïöüâêîôûçñ]+(?:\s+[A-Z][a-záéíóúàèìòùäëïöüâêîôûçñ]+){0,2})|([A-Z][a-záéíóúàèìòùäëïöüâêîôûçñ]+(?:\s+[A-Z][a-záéíóúàèìòùäëïöüâêîôûçñ]+){0,2})\s+(?:province|state|oblast|district|prefecture|governorate|region|county|municipality|city)\b/gi

/** 텍스트에서 위치 추출 — 점수 기반 다중후보 선택
 *  순서: 데이트라인(즉시) → 컨텍스트(15) → 전치사(12) → 전문스캔(빈도×4) → 지역(1.0°) → 국가(1.5°)
 *  반환: [lat, lng, 장소명, jitter반경(도)] */
function coordsFromText(text: string): readonly [number, number, string, number] | null {
  const lower = text.toLowerCase()

  // 1. 데이트라인 — 최고 신뢰도, 즉시 반환
  const dl = text.match(/^([A-Z][A-Za-z\s'.()-]{1,32}?)(?:,\s*[A-Za-z\s]+?)?\s*(?:\([^)]{1,30}\)\s*)?[-–—]/)
  if (dl) {
    const r = lookupCity(dl[1].trim())
    if (r) return r
  }

  const cands: _Candidate[] = []

  // 2. 컨텍스트 패턴 (score 15): "city of Cairo", "Donbas region"
  _CTX_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = _CTX_RE.exec(text)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim()
    if (!raw) continue
    const r = lookupCity(raw)
    if (r) cands.push({ lat: r[0], lng: r[1], name: r[2], jitter: r[3], score: 15 })
  }

  // 3. 전치사 패턴 (score 12): "in Kyiv", "near Aleppo", "from Kabul"
  _PREP_RE.lastIndex = 0
  while ((m = _PREP_RE.exec(text)) !== null) {
    const r = lookupCity(m[1])
    if (r) cands.push({ lat: r[0], lng: r[1], name: r[2], jitter: r[3], score: 12 })
  }

  // 4. 전문 스캔 — 언급 횟수 × 4점 (최대 5회 카운트)
  for (const [name, c] of _sortedCities) {
    const nl = name.toLowerCase()
    let idx = lower.indexOf(nl)
    if (idx === -1) continue
    if (nl.length < 6 && !hasWordBoundary(lower, idx, nl.length)) continue
    let count = 0
    while (idx !== -1 && count < 5) { count++; idx = lower.indexOf(nl, idx + nl.length) }
    cands.push({ lat: c[0], lng: c[1], name, jitter: 0.12, score: count * 4 })
  }

  if (cands.length > 0) {
    const best = cands.reduce((b, c) => c.score > b.score ? c : b)
    return [best.lat, best.lng, best.name, best.jitter]
  }

  // 5. 지역 레이어
  for (const [name, c] of _sortedRegions) {
    if (lower.includes(name.toLowerCase())) return [c[0], c[1], name, 1.0]
  }

  // 6. 국가 폴백
  for (const [name, c] of Object.entries(COUNTRY_COORDS)) {
    if (text.includes(name)) return [c[0], c[1], name, 1.5]
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

  const SOURCE_NAMES = [
    'USGS','EMSC','EONET','NOAA Alerts','Space Weather','GDACS','ReliefWeb',
    'FEMA','FloodList','WHO','PTWC','IAEA',
    ...NEWS_FEEDS.map(f => f.name),
  ]

  const enc = new TextEncoder()

  // 스트리밍: 각 소스가 완료되는 즉시 청크 전송
  const stream = new ReadableStream({
    async start(controller) {
      const namedTasks = tasks.map((task, i) =>
        task
          .then(events => ({ events, source: SOURCE_NAMES[i] }))
          .catch(err => {
            console.warn(`[BoomTrack] ${SOURCE_NAMES[i]} 실패:`, err)
            return { events: [] as WorldEvent[], source: SOURCE_NAMES[i] }
          })
          .then(chunk => {
            controller.enqueue(enc.encode(JSON.stringify(chunk) + '\n'))
          })
      )
      await Promise.all(namedTasks)
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}
