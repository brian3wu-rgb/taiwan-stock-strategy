'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { getScanStatus, ScanStatus } from '@/lib/api'

interface Props {
  triggered?: boolean        // 手動觸發掃描時傳 true（控制按鈕外觀用）
  onDone: () => void         // 掃描完成時通知父元件刷新結果
  onPartialRefresh?: () => void  // 掃描中每 30 秒刷新一次結果
}

/**
 * ScanProgressBar — 掃描狀態監控器
 * - 始終輪詢後端狀態（包含自動排程掃描）
 * - 掃描中：顯示進度條 + 每 30 秒觸發結果刷新（漸進顯示）
 * - 掃描完成：顯示完成 Toast 5 秒，通知父元件重新載入
 */
export default function ScanProgressBar({ triggered, onDone, onPartialRefresh }: Props) {
  const [status, setStatus]         = useState<ScanStatus | null>(null)
  const [wasRunning, setWasRunning] = useState(false)
  const [showToast, setShowToast]   = useState(false)
  const [doneMsg, setDoneMsg]       = useState('')
  const lastRefreshTs               = useRef<number>(0)
  const toastTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const s = await getScanStatus()
      setStatus(s)

      if (s.running) {
        setWasRunning(true)

        // 漸進刷新：每 30 秒通知父元件重新載入最新 DB 結果
        const now = Date.now()
        if (onPartialRefresh && now - lastRefreshTs.current >= 30_000) {
          lastRefreshTs.current = now
          onPartialRefresh()
        }
      } else if (wasRunning) {
        // 從 running → 完成
        setWasRunning(false)

        // 顯示完成 Toast
        const msg = s.progress ?? '掃描完成'
        setDoneMsg(msg)
        setShowToast(true)
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setShowToast(false), 6000)

        // 通知父元件刷新結果
        onDone()
      }
    } catch {
      // 靜默失敗
    }
  }, [wasRunning, onDone, onPartialRefresh])

  useEffect(() => {
    poll()
    const id = setInterval(poll, 3000)
    return () => {
      clearInterval(id)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [poll])

  const isRunning = status?.running || triggered

  return (
    <>
      {/* ── 掃描進度條（底部右側）── */}
      {isRunning && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl p-4">
          <div className="h-1 bg-[#21262d] rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ animation: 'scan-progress 2s ease-in-out infinite' }}
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="text-xs text-[#8b949e] truncate">
              {status?.progress ?? '啟動掃描中...'}
            </span>
          </div>
          <p className="text-[10px] text-[#484f58] mt-2">
            結果每 30 秒自動更新
          </p>
        </div>
      )}

      {/* ── 掃描完成 Toast（頂部右側）── */}
      {showToast && (
        <div
          className="fixed top-6 right-6 z-50 w-80 bg-[#1c2b1c] border border-green-700/60 rounded-xl shadow-2xl p-4 flex gap-3 items-start"
          style={{ animation: 'toast-in 0.3s ease-out' }}
        >
          <span className="text-2xl leading-none">✅</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-400 mb-0.5">每日掃描已完成</p>
            <p className="text-xs text-[#8b949e] truncate">{doneMsg}</p>
            <p className="text-[10px] text-[#484f58] mt-1">結果已更新至頁面</p>
          </div>
          <button
            onClick={() => setShowToast(false)}
            className="text-[#484f58] hover:text-white text-sm shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <style jsx global>{`
        @keyframes scan-progress {
          0%   { width: 20%; margin-left: -20%; }
          50%  { width: 60%; margin-left: 20%; }
          100% { width: 20%; margin-left: 100%; }
        }
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
