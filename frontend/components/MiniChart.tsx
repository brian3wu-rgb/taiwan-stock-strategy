'use client'

/**
 * MiniChart.tsx
 * ─────────────────────────────────────────────────────────────────────
 * 選股掃描頁面用的迷你 K 線圖元件。
 * - 無 X/Y 軸刻度、無 crosshair
 * - 自動 fitContent
 * - MA5（黃）MA60（青）MA100（粉紅）
 */

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  IChartApi,
  CandlestickData,
  LineData,
  Time,
  CrosshairMode,
} from 'lightweight-charts'
import { getChartData } from '@/lib/api'

interface Props {
  symbol: string
  height?: number
  showPriceScale?: boolean   // 顯示右側價格軸（模擬交易頁用）
}

const COLORS = {
  bg:       '#161b22',
  grid:     '#21262d',
  candleUp: '#ef5350',
  candleDn: '#26a69a',
  ma5:      '#f0c040',
  ma60:     '#26c6da',
  ma100:    '#ec407a',
}

export default function MiniChart({ symbol, height = 190, showPriceScale = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!containerRef.current) return
      setLoading(true)
      setError(false)

      try {
        const data = await getChartData(symbol)
        if (cancelled || !containerRef.current) return

        // 銷毀舊圖
        chartRef.current?.remove()
        chartRef.current = null

        const chart = createChart(containerRef.current, {
          width:  containerRef.current.clientWidth || 280,
          height,
          layout: {
            background: { color: COLORS.bg },
            textColor:  showPriceScale ? '#8b949e' : 'transparent',
          },
          grid: {
            vertLines: { color: COLORS.grid },
            horzLines: { color: COLORS.grid },
          },
          crosshair: { mode: CrosshairMode.Hidden },
          rightPriceScale: {
            visible:     showPriceScale,
            borderColor: showPriceScale ? '#30363d' : 'transparent',
            textColor:   '#8b949e',
          },
          leftPriceScale: { visible: false },
          timeScale: {
            visible:     false,
            borderColor: 'transparent',
          },
          handleScroll: false,
          handleScale:  false,
        })
        chartRef.current = chart

        const valid = data.candles.filter(
          c => c.open != null && c.high != null && c.low != null && c.close != null
        )

        const candle = chart.addCandlestickSeries({
          upColor:         COLORS.candleUp,
          downColor:       COLORS.candleDn,
          borderUpColor:   COLORS.candleUp,
          borderDownColor: COLORS.candleDn,
          wickUpColor:     COLORS.candleUp,
          wickDownColor:   COLORS.candleDn,
        })
        candle.setData(valid.map(c => ({
          time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
        } satisfies CandlestickData)))

        const ma5 = chart.addLineSeries({ color: COLORS.ma5, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        ma5.setData(valid.filter(c => c.ma5 != null).map(c => ({ time: c.time as Time, value: c.ma5! } satisfies LineData)))

        const ma60 = chart.addLineSeries({ color: COLORS.ma60, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        ma60.setData(valid.filter(c => c.ma60 != null).map(c => ({ time: c.time as Time, value: c.ma60! } satisfies LineData)))

        const ma100 = chart.addLineSeries({ color: COLORS.ma100, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        ma100.setData(valid.filter(c => c.ma100 != null).map(c => ({ time: c.time as Time, value: c.ma100! } satisfies LineData)))

        chart.timeScale().fitContent()

        // 響應式
        const ro = new ResizeObserver(entries => {
          const w = entries[0]?.contentRect?.width
          if (w && chartRef.current) chartRef.current.applyOptions({ width: w })
        })
        ro.observe(containerRef.current)

        setLoading(false)
        return () => ro.disconnect()

      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [symbol, height])

  return (
    <div className="relative w-full" style={{ height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#161b22] text-[#8b949e] text-xs gap-2">
          <div className="w-3 h-3 border border-[#30363d] border-t-blue-400 rounded-full animate-spin" />
          載入中
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#161b22] text-[#8b949e] text-xs">
          無法載入圖表
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
