import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BoomTrack — 전세계 관제실',
  description: '실시간 전세계 이벤트 모니터링 시스템',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
