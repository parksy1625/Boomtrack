import { NextResponse } from 'next/server'
import { WorldEvent, EventType, Severity } from '@/lib/types'

const USGS_FEED =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'

function magnitudeToSeverity(mag: number): Severity {
  if (mag >= 7.0) return 'critical'
  if (mag >= 5.0) return 'high'
  if (mag >= 3.0) return 'medium'
  return 'low'
}

async function fetchEarthquakes(): Promise<WorldEvent[]> {
  try {
    const res = await fetch(USGS_FEED, {
      next: { revalidate: 30 },
      headers: { 'User-Agent': 'BoomTrack/1.0' },
    })
    if (!res.ok) return []
    const data = await res.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.features.slice(0, 60).map((f: any) => {
      const mag = f.properties.mag ?? 0
      return {
        id: f.id,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        type: 'earthquake' as EventType,
        title: f.properties.title ?? '지진 발생',
        description: `규모 ${mag.toFixed(1)} 지진. ${f.properties.place ?? ''}`,
        severity: magnitudeToSeverity(mag),
        location: f.properties.place ?? '알 수 없음',
        country: '',
        timestamp: new Date(f.properties.time).toISOString(),
        magnitude: mag,
        source: 'USGS',
      }
    })
  } catch {
    return []
  }
}

// Global hotspot cities for simulated events
const CITIES = [
  { city: '서울', country: '대한민국', lat: 37.5665, lng: 126.978 },
  { city: '도쿄', country: '일본', lat: 35.6762, lng: 139.6503 },
  { city: '베이징', country: '중국', lat: 39.9042, lng: 116.4074 },
  { city: '뉴욕', country: '미국', lat: 40.7128, lng: -74.006 },
  { city: '런던', country: '영국', lat: 51.5074, lng: -0.1278 },
  { city: '파리', country: '프랑스', lat: 48.8566, lng: 2.3522 },
  { city: '모스크바', country: '러시아', lat: 55.7558, lng: 37.6173 },
  { city: '두바이', country: 'UAE', lat: 25.2048, lng: 55.2708 },
  { city: '뭄바이', country: '인도', lat: 19.076, lng: 72.8777 },
  { city: '상파울루', country: '브라질', lat: -23.5505, lng: -46.6333 },
  { city: '카이로', country: '이집트', lat: 30.0444, lng: 31.2357 },
  { city: '나이로비', country: '케냐', lat: -1.2921, lng: 36.8219 },
  { city: '라고스', country: '나이지리아', lat: 6.5244, lng: 3.3792 },
  { city: '시드니', country: '호주', lat: -33.8688, lng: 151.2093 },
  { city: '멕시코시티', country: '멕시코', lat: 19.4326, lng: -99.1332 },
  { city: '부에노스아이레스', country: '아르헨티나', lat: -34.6037, lng: -58.3816 },
  { city: '자카르타', country: '인도네시아', lat: -6.2088, lng: 106.8456 },
  { city: '방콕', country: '태국', lat: 13.7563, lng: 100.5018 },
  { city: '테헤란', country: '이란', lat: 35.6892, lng: 51.389 },
  { city: '이스탄불', country: '터키', lat: 41.0082, lng: 28.9784 },
  { city: '베를린', country: '독일', lat: 52.52, lng: 13.405 },
  { city: '마드리드', country: '스페인', lat: 40.4168, lng: -3.7038 },
  { city: '로마', country: '이탈리아', lat: 41.9028, lng: 12.4964 },
  { city: '워싱턴 D.C.', country: '미국', lat: 38.9072, lng: -77.0369 },
  { city: '베이루트', country: '레바논', lat: 33.8938, lng: 35.5018 },
  { city: '키이우', country: '우크라이나', lat: 50.4501, lng: 30.5234 },
  { city: '리야드', country: '사우디아라비아', lat: 24.7136, lng: 46.6753 },
  { city: '다카', country: '방글라데시', lat: 23.8103, lng: 90.4125 },
  { city: '카라치', country: '파키스탄', lat: 24.8607, lng: 67.0011 },
  { city: '상하이', country: '중국', lat: 31.2304, lng: 121.4737 },
  { city: '홍콩', country: '중국', lat: 22.3193, lng: 114.1694 },
  { city: '싱가포르', country: '싱가포르', lat: 1.3521, lng: 103.8198 },
  { city: '마닐라', country: '필리핀', lat: 14.5995, lng: 120.9842 },
  { city: '양곤', country: '미얀마', lat: 16.8661, lng: 96.1951 },
  { city: '하노이', country: '베트남', lat: 21.0285, lng: 105.8542 },
  { city: '카불', country: '아프가니스탄', lat: 34.5553, lng: 69.2075 },
  { city: '바그다드', country: '이라크', lat: 33.3152, lng: 44.3661 },
  { city: '다마스쿠스', country: '시리아', lat: 33.5138, lng: 36.2765 },
  { city: '가자', country: '팔레스타인', lat: 31.5017, lng: 34.4668 },
  { city: '아디스아바바', country: '에티오피아', lat: 9.0054, lng: 38.7636 },
  { city: '키갈리', country: '르완다', lat: -1.9441, lng: 30.0619 },
  { city: '카사블랑카', country: '모로코', lat: 33.5731, lng: -7.5898 },
  { city: '하라레', country: '짐바브웨', lat: -17.8252, lng: 31.0335 },
  { city: '보고타', country: '콜롬비아', lat: 4.711, lng: -74.0721 },
  { city: '리마', country: '페루', lat: -12.0464, lng: -77.0428 },
  { city: '산티아고', country: '칠레', lat: -33.4489, lng: -70.6693 },
  { city: '카라카스', country: '베네수엘라', lat: 10.4806, lng: -66.9036 },
  { city: '키토', country: '에콰도르', lat: -0.1807, lng: -78.4678 },
  { city: '알래스카', country: '미국', lat: 64.2008, lng: -153.4937 },
  { city: '레이캬비크', country: '아이슬란드', lat: 64.1355, lng: -21.8954 },
]

const SIM_EVENTS: Array<{
  type: EventType
  titles: string[]
  severities: Severity[]
}> = [
  {
    type: 'weather',
    titles: [
      '태풍 접근 경보',
      '기록적 폭설 발생',
      '극심한 가뭄 경보',
      '홍수 위기 경보',
      '폭풍 주의보 발령',
      '이상고온 경보',
      '산불 확산 위험',
      '토네이도 경보',
    ],
    severities: ['low', 'medium', 'high', 'critical'],
  },
  {
    type: 'political',
    titles: [
      '긴급 정상회담 개최',
      '국경 분쟁 발생',
      '선거 결과 논란',
      '외교 갈등 고조',
      '국제 제재 발표',
      '쿠데타 시도 발생',
      '대규모 시위 발생',
    ],
    severities: ['low', 'medium', 'high'],
  },
  {
    type: 'conflict',
    titles: [
      '무장 충돌 발생',
      '휴전 협상 결렬',
      '군사 작전 개시',
      '민간인 대피령 발령',
      '분쟁 지역 확산',
      '포격 사건 발생',
      '무인기 공격 감지',
    ],
    severities: ['medium', 'high', 'critical'],
  },
  {
    type: 'economic',
    titles: [
      '금융 시장 급락',
      '통화 가치 폭락',
      '대규모 파업 시작',
      '무역 분쟁 격화',
      '기업 파산 선언',
      '에너지 위기 발생',
      '공급망 붕괴 경고',
    ],
    severities: ['low', 'medium', 'high'],
  },
  {
    type: 'health',
    titles: [
      '신종 바이러스 발견',
      '전염병 경보 발령',
      '의약품 부족 사태',
      '병원 응급 선언',
      '보건 위기 공표',
      '식중독 대량 발생',
    ],
    severities: ['medium', 'high', 'critical'],
  },
  {
    type: 'disaster',
    titles: [
      '대규모 산불 발생',
      '화산 폭발 징후',
      '해일 경보 발령',
      '대형 교통사고',
      '댐 붕괴 위험',
      '건물 붕괴 사고',
      '독성 화학물질 유출',
    ],
    severities: ['high', 'critical'],
  },
]

// Seeded random based on time bucket so simulated events are consistent per 30s window
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function generateSimulatedEvents(): WorldEvent[] {
  const now = Date.now()
  const bucket = Math.floor(now / 30000) // 30s bucket
  const rng = seededRandom(bucket * 31337)

  const count = 45
  const events: WorldEvent[] = []

  for (let i = 0; i < count; i++) {
    const city = CITIES[Math.floor(rng() * CITIES.length)]
    const template = SIM_EVENTS[Math.floor(rng() * SIM_EVENTS.length)]
    const title = template.titles[Math.floor(rng() * template.titles.length)]
    const severity = template.severities[
      Math.floor(rng() * template.severities.length)
    ] as Severity

    const hoursAgo = rng() * 12
    const timestamp = new Date(now - hoursAgo * 3600000).toISOString()

    const latOff = (rng() - 0.5) * 3
    const lngOff = (rng() - 0.5) * 3

    events.push({
      id: `sim-${bucket}-${i}`,
      lat: city.lat + latOff,
      lng: city.lng + lngOff,
      type: template.type,
      title: `${city.city}: ${title}`,
      description: `${city.country} ${city.city} 지역에서 ${title} 상황이 감지되었습니다.`,
      severity,
      location: city.city,
      country: city.country,
      timestamp,
      source: 'BoomTrack',
    })
  }

  return events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}

export async function GET() {
  const [quakes, simulated] = await Promise.all([
    fetchEarthquakes(),
    Promise.resolve(generateSimulatedEvents()),
  ])

  const all = [...quakes, ...simulated].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return NextResponse.json({
    events: all,
    total: all.length,
    lastUpdate: new Date().toISOString(),
  })
}
