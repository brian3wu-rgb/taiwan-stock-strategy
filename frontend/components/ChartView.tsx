'use client'

/**
 * ChartView.tsx
 * ─────────────────────────────────────────────────────────────────────
 * TradingView Lightweight Charts v4 圖表元件。
 * - K 線 (candlestick)  紅漲綠跌（台灣慣例）
 * - MA5（黃色）MA60（青色）MA100（粉紅）
 * - 訊號標記（marker）
 * - ResizeObserver 響應式寬度
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  SeriesMarker,
  Time,
  CrosshairMode,
} from 'lightweight-charts'
import { getChartData, ChartData } from '@/lib/api'
import SignalBadge from './SignalBadge'

interface Props {
  symbol:      string
  signal?:     'LONG' | 'SHORT'
  signalDate?: string
}

// ─────────────────────────────────────────────
//  圖表顏色常數
// ─────────────────────────────────────────────
const COLORS = {
  bg:          '#161b22',
  grid:        '#21262d',
  text:        '#8b949e',
  border:      '#30363d',
  candleUp:    '#ef5350',   // 紅漲（台灣慣例）
  candleDn:    '#26a69a',   // 綠跌（台灣慣例）
  ma5:         '#f0c040',   // 黃
  ma60:        '#26c6da',   // 青
  ma100:       '#ec407a',   // 粉紅
  markerLong:  '#3fb950',
  markerShort: '#f85149',
}

// ─────────────────────────────────────────────
//  主元件
// ─────────────────────────────────────────────
export default function ChartView({ symbol, signal, signalDate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // ── 載入資料 ─────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getChartData(symbol)
      setChartData(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `無法載入 ${symbol} 的圖表資料`)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => { load() }, [load])

  // ── 初始化 / 更新圖表 ────────────────────────
  useEffect(() => {
    if (!containerRef.current || !chartData || loading) return

    // 清除舊圖表
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current  = null
      candleRef.current = null
    }

    // ── 建立圖表 ─────────────────────────────
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 480,
      layout: {
        background: { color: COLORS.bg },
        textColor:  COLORS.text,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
      },
    })
    chartRef.current = chart

    // ── K 線 ─────────────────────────────────
    const candleSeries = chart.addCandlestickSeries({
      upColor:         COLORS.candleUp,
      downColor:       COLORS.candleDn,
      borderUpColor:   COLORS.candleUp,
      borderDownColor: COLORS.candleDn,
      wickUpColor:     COLORS.candleUp,
      wickDownColor:   COLORS.candleDn,
    })
    candleRef.current = candleSeries

    const validCandles = chartData.candles.filter(
      c => c.open != null && c.high != null && c.low != null && c.close != null
    )
    candleSeries.setData(
      validCandles.map(c => ({
        time:  c.time as Time,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      } satisfies CandlestickData))
    )

    // ── MA5（黃色）──────────────────────────
    const ma5Series = chart.addLineSeries({
      color:            COLORS.ma5,
      lineWidth:        2,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    ma5Series.setData(
      validCandles
        .filter(c => c.ma5 != null)
        .map(c => ({ time: c.time as Time, value: c.ma5! } satisfies LineData))
    )

    // ── MA60（青色）──────────────────────────
    const ma60Series = chart.addLineSeries({
      color:            COLORS.ma60,
      lineWidth:        2,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    ma60Series.setData(
      validCandles
        .filter(c => c.ma60 != null)
        .map(c => ({ time: c.time as Time, value: c.ma60! } satisfies LineData))
    )

    // ── MA100（粉紅）──────────────────────────
    const ma100Series = chart.addLineSeries({
      color:            COLORS.ma100,
      lineWidth:        2,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    ma100Series.setData(
      validCandles
        .filter(c => c.ma100 != null)
        .map(c => ({ time: c.time as Time, value: c.ma100! } satisfies LineData))
    )

    // ── 訊號標記 ─────────────────────────────
    if (signal && signalDate) {
      const isLong = signal === 'LONG'
      const markers: SeriesMarker<Time>[] = [{
        time:     signalDate as Time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color:    isLong ? COLORS.markerLong : COLORS.markerShort,
        shape:    isLong ? 'arrowUp' : 'arrowDown',
        text:     isLong ? '做多訊號' : '做空訊號',
        size:     2,
      }]
      candleSeries.setMarkers(markers)
    }

    chart.timeScale().fitContent()

    // ── 響應式 ────────────────────────────────
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w && chartRef.current) {
        chartRef.current.applyOptions({ width: w })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current  = null
      candleRef.current = null
    }
  }, [chartData, loading, signal, signalDate])

  // ── 最新價格 & 漲跌 ───────────────────────────
  const lastCandle  = chartData?.candles.at(-1)
  const firstCandle = chartData?.candles.find(c => c.close != null)
  const priceChange = lastCandle && firstCandle
    ? lastCandle.close - firstCandle.close
    : null
  const isUp = (priceChange ?? 0) >= 0

  // ─────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0d1117]">

      {/* ── Header ── */}
      <header className="bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-4">
          <Link href="/" className="text-[#8b949e] hover:text-white transition-colors text-sm">
            ← 返回列表
          </Link>
          <div className="h-4 w-px bg-[#30363d]" />
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono font-bold text-white">{symbol}</span>
            {signal && <SignalBadge signal={signal} />}
            {lastCandle && (
              <span className={`font-mono text-lg font-bold ${isUp ? 'text-[#ef5350]' : 'text-[#26a69a]'}`}>
                {lastCandle.close.toFixed(2)}
              </span>
            )}
            {signalDate && (
              <span className="text-xs text-[#8b949e]">訊號日：{signalDate}</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">

        {/* ── 圖例 ── */}
        <div className="flex gap-5 text-xs text-[#8b949e]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: COLORS.ma5 }} /> MA5
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: COLORS.ma60 }} /> MA60
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: COLORS.ma100 }} /> MA100
          </span>
          {signal && (
            <span className="flex items-center gap-1.5">
              <span className={`text-sm ${signal === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                {signal === 'LONG' ? '▲' : '▼'}
              </span>
              訊號標記
            </span>
          )}
        </div>

        {/* ── 圖表容器 ── */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden p-3">
          {loading && (
            <div className="flex items-center justify-center h-[480px] text-[#8b949e] gap-3">
              <div className="w-5 h-5 border-2 border-[#30363d] border-t-blue-400 rounded-full animate-spin" />
              載入圖表資料...
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-[480px] text-red-400 text-sm">
              ⚠️ {error}
            </div>
          )}
          {/* lightweight-charts 掛載點 */}
          <div
            ref={containerRef}
            className={loading || error ? 'hidden' : 'w-full'}
          />
        </div>

        {/* ── 資料摘要 ── */}
        {lastCandle && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '收盤',  value: lastCandle.close.toFixed(2) },
              { label: 'MA5',   value: lastCandle.ma5?.toFixed(2)  ?? '—', color: `text-[${COLORS.ma5}]` },
              { label: 'MA60',  value: lastCandle.ma60?.toFixed(2) ?? '—', color: `text-[${COLORS.ma60}]` },
              { label: 'MA100', value: lastCandle.ma100?.toFixed(2) ?? '—', color: `text-[${COLORS.ma100}]` },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wider">{label}</div>
                <div className={`font-mono font-bold mt-1 ${color ?? 'text-white'}`}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
