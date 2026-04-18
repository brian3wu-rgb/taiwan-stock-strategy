'use client'

import { useEffect, useState, useCallback } from 'react'
import { getScanStatus, ScanStatus } from '@/lib/api'

interface Props {
  triggered: boolean   // 父元件已觸發掃描，立即顯示進度條
  onDone: () => void   // 掃描完成時通知父元件刷新
}

/**
 * 掃描進度條：掃描觸發後顯示，每 2 秒輪詢一次後端狀態，
 * 完成後呼叫 onDone() 讓父元件重新載入結果。
 */
export default function ScanProgressBar({ triggered, onDone }: Props) {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [visible, setVisible] = useState(false)

  const poll = useCallback(async () => {
    try {
      const s = await getScanStatus()
      setStatus(s)
      if (s.running) {
        setVisible(true)
      } else if (visible) {
        // 從 running → done，通知父元件
        setVisible(false)
        onDone()
      }
    } catch {
      // 靜默失敗，不影響主畫面
    }
  }, [visible, onDone])

  useEffect(() => {
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [poll])

  if (!triggered && !visible) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl p-4">
      {/* 動畫進度條 */}
      <div className="h-1 bg-[#21262d] rounded-full overflow-hidden mb-3">
        <div className="h-full bg-blue-500 rounded-full animate-[progress_2s_ease-in-out_infinite]"
             style={{ width: '60%' }} />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-xs text-[#8b949e] truncate">{status?.progress ?? '啟動掃描中...'}</span>
      </div>
      <style jsx>{`
        @keyframes progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
