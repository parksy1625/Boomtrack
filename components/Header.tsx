'use client'

import { useEffect, useState } from 'react'

interface Props {
  eventCount: number
  lastUpdate: Date
  isLoading: boolean
  criticalCount: number
}

export default function Header({ eventCount, lastUpdate, isLoading, criticalCount }: Props) {
  const [tick, setTick] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTick(p => !p), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <header className="flex items-center justify-between px-3 py-2 md:px-5 md:py-2.5 border-b border-cyan-900/40 bg-black/60 backdrop-blur-sm flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <span className="text-xl font-black tracking-[0.25em] text-cyan-400">
            BOOM
          </span>
          <span className="text-xl font-black tracking-[0.25em] text-red-500">
            TRACK
          </span>
          <div className="absolute -bottom-0.5 left-0 w-full h-px bg-gradient-to-r from-cyan-400 via-white/20 to-red-500" />
        </div>
        <div className="hidden sm:block text-[10px] text-gray-600 tracking-widest uppercase">
          전세계 실시간 관제 시스템
        </div>
      </div>

      {/* Center — critical alert */}
      {criticalCount > 0 && (
        <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 border border-red-600/60 rounded bg-red-950/30 critical-glow">
          <div className={`w-1.5 h-1.5 rounded-full bg-red-500 ${tick ? 'opacity-100' : 'opacity-20'}`} />
          <span className="text-red-400 text-[10px] md:text-xs font-bold tracking-wider">
            <span className="hidden sm:inline">심각 이벤트 </span>{criticalCount}건
          </span>
        </div>
      )}

      {/* Right — status */}
      <div className="flex items-center gap-2 md:gap-5 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'
            }`}
          />
          <span className="text-gray-400 hidden sm:inline">
            {isLoading ? '수신 중...' : '실시간 연결'}
          </span>
        </div>

        <div className="text-gray-500">
          <span className="hidden sm:inline">이벤트 </span>
          <span className="text-cyan-400 font-bold text-sm">{eventCount}</span>
          <span className="hidden sm:inline">건</span>
        </div>

        <div className="text-gray-600 hidden md:block">
          갱신{' '}
          {lastUpdate.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>
      </div>
    </header>
  )
}
