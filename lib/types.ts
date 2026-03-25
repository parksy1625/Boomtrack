export type EventType =
  | 'earthquake'
  | 'weather'
  | 'conflict'
  | 'political'
  | 'economic'
  | 'health'
  | 'disaster'

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface WorldEvent {
  id: string
  lat: number
  lng: number
  type: EventType
  title: string
  description: string
  severity: Severity
  location: string
  country: string
  timestamp: string
  magnitude?: number   // 지진 규모
  source: string       // USGS / NASA EONET / GDELT / ReliefWeb
  newsUrl?: string     // 원문 기사 링크
  toneScore?: number   // GDELT 감정 지수 (-100 매우 부정 ~ +100 매우 긍정)
  imageUrl?: string    // 기사 대표 이미지
  domain?: string      // 뉴스 출처 도메인
}

export interface EventsResponse {
  events: WorldEvent[]
  total: number
  lastUpdate: string
  sources: Record<string, number>
}
