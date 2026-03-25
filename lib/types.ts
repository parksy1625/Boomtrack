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
  magnitude?: number
  source?: string
}

export interface EventsResponse {
  events: WorldEvent[]
  total: number
  lastUpdate: string
}
