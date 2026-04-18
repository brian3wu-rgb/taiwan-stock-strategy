'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getScanResults, triggerScan, ScanResult, ScanResponse } from '@/lib/api'
import SignalBadge from '@/components/SignalBadge'
import ScanProgressBar from '@/components/ScanProgressBar'

type FilterType = 'ALL' | 'LONG' | 'SHORT'

// ─────────────────────────────────────────────
//  統計卡片
// ─────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
      <div className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────
//  表格列
// ─────────────────────────────────────────────
function StockRow({ stock, rank }: { stock: ScanResult; rank: number }) {
  const proximityPct = stock.cross_proximity != null
    ? (stock.cross_proximity * 100).toFixed(2)
    : '—'

  const volColor = stock.volume_ratio != null
    ? stock.volume_ratio >= 2 ? 'text-yellow-400'
    : stock.volume_ratio >= 1.5 ? 'text-green-400'
    : 'text-[#e6edf3]'
    : 'text-[#8b949e]'

  return (
    <tr className="border-b border-[#21262d] hover:bg-[#1c2128] transition-colors group">
      {/* 排名 */}
      <td className="px-4 py-3 text-xs text-[#8b949e] w-12">{rank}</td>

      {/* 代號 */}
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-[#58a6ff]">
          {stock.symbol.replace('.TW', '').replace('.TWO', '')}
        </span>
        <span className="ml-1.5 text-[10px] text-[#8b949e]">
          {stock.symbol.endsWith('.TWO') ? 'OTC' : 'TSE'}
        </span>
      </td>

      {/* 名稱 */}
      <td className="px-4 py-3 text-sm font-medium">{stock.name}</td>

      {/* 訊號 */}
      <td className="px-4 py-3">
        <SignalBadge signal={stock.signal} />
      </td>

      {/* 收盤價 */}
      <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
        {stock.price.toFixed(2)}
      </td>

      {/* MA5 */}
      <td className="px-4 py-3 text-right font-mono text-xs text-blue-400">
        {stock.ma5?.toFixed(2) ?? '—'}
      </td>

      {/* MA100 */}
      <td className="px-4 py-3 text-right font-mono text-xs text-red-400">
        {stock.ma100?.toFixed(2) ?? '—'}
      </td>

      {/* 交叉接近度 ← 排序依據 */}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          {/* 視覺條 */}
          <div className="w-16 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-yellow-400"
              style={{ width: `${Math.min(100, (1 - (stock.cross_proximity ?? 0.02)) / 0.02 * 100)}%` }}
            />
          </div>
          <span className="font-mono text-xs text-[#e3b341]">{proximityPct}%</span>
        </div>
      </td>

      {/* 量比 */}
      <td className={`px-4 py-3 text-right font-mono text-xs ${volColor}`}>
        {stock.volume_ratio != null ? `${stock.volume_ratio.toFixed(2)}x` : '—'}
      </td>

      {/* 日期 */}
      <td className="px-4 py-3 text-right text-xs text-[#8b949e]">{stock.scan_date}</td>

      {/* 圖表連結 */}
      <td className="px-4 py-3 text-right">
        <Link
          href={`/chart/${encodeURIComponent(stock.symbol)}?signal=${stock.signal}&date=${stock.scan_date}`}
          className="text-xs text-[#58a6ff] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          圖表 →
        </Link>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────
//  主頁
// ─────────────────────────────────────────────
export default function HomePage() {
  const [data,    setData]    = useState<ScanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<FilterType>('ALL')
  const [error,   setError]   = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await getScanResults()
      setData(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '無法連接後端，請確認服務已啟動。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleScan() {
    try {
      setScanning(true)
      await triggerScan()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '觸發掃描失敗')
      setScanning(false)
    }
  }

  function handleScanDone() {
    setScanning(false)
    load()
  }

  const allResults   = data?.results ?? []
  const longCount    = allResults.filter(r => r.signal === 'LONG').length
  const shortCount   = allResults.filter(r => r.signal === 'SHORT').length
  const filtered     = filter === 'ALL' ? allResults : allResults.filter(r => r.signal === filter)

  return (
    <div className="min-h-screen bg-[#0d1117]">

      {/* ── Header ── */}
      <header className="bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">📈 台股策略選股</h1>
            <p className="text-[11px] text-[#8b949e]">
              均線交叉 × K線反轉 × 量能過濾 · 依交叉接近度排序
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data?.scan_date && (
              <span className="text-xs text-[#8b949e] hidden sm:block">
                上次掃描：{data.scan_date}
              </span>
            )}
            <button
              onClick={load}
              className="px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg transition-colors"
            >
              重新整理
            </button>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {scanning ? '掃描中...' : '立即掃描'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">

        {/* ── 統計卡 ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="掃描結果"  value={data?.total ?? 0}  color="text-white" />
          <StatCard label="做多訊號"  value={longCount}          color="text-green-400" />
          <StatCard label="做空訊號"  value={shortCount}         color="text-red-400" />
          <StatCard label="掃描日期"  value={data?.scan_date ?? '—'} color="text-[#e3b341]" />
        </div>

        {/* ── 篩選標籤 ── */}
        <div className="flex gap-2">
          {(['ALL', 'LONG', 'SHORT'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === f
                  ? f === 'LONG'  ? 'bg-green-600 text-white'
                  : f === 'SHORT' ? 'bg-red-600 text-white'
                  :                 'bg-blue-600 text-white'
                  : 'bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d]'
              }`}
            >
              {f === 'ALL' ? `全部 (${allResults.length})` : f === 'LONG' ? `做多 (${longCount})` : `做空 (${shortCount})`}
            </button>
          ))}
        </div>

        {/* ── 錯誤訊息 ── */}
        {error && (
          <div className="bg-red-950/30 border border-red-800/50 text-red-400 rounded-xl p-4 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ── 表格 ── */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-[#8b949e] gap-3">
            <div className="w-5 h-5 border-2 border-[#30363d] border-t-blue-400 rounded-full animate-spin" />
            載入中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">📭</div>
            <div className="text-[#8b949e] text-sm">
              {allResults.length === 0
                ? '尚無掃描資料，請點擊「立即掃描」'
                : '此篩選條件沒有結果'}
            </div>
          </div>
        ) : (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#30363d]">
                    {['#', '代號', '名稱', '訊號', '收盤價', 'MA5', 'MA100', '交叉接近度 ↑', '量比', '日期', ''].map(h => (
                      <th key={h}
                          className={`px-4 py-3 text-left text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider ${
                            ['收盤價','MA5','MA100','交叉接近度 ↑','量比','日期',''].includes(h) ? 'text-right' : ''
                          }`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((stock, i) => (
                    <StockRow key={stock.symbol} stock={stock} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* 表格底部說明 */}
            <div className="px-4 py-3 border-t border-[#21262d] flex items-center gap-4 text-[10px] text-[#8b949e]">
              <span>▲ 交叉接近度越小 = 越靠近均線交叉點，優先關注</span>
              <span>量比 &gt;2x 以黃色標示</span>
            </div>
          </div>
        )}
      </main>

      {/* ── 掃描進度浮動提示 ── */}
      <ScanProgressBar onDone={handleScanDone} />
    </div>
  )
}
