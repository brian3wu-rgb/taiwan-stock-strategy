'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getScanResults, triggerScan, getTWScanDates, ScanResult, ScanResponse } from '@/lib/api'
import { CONCEPTS, CONCEPT_BADGE, CONCEPT_ACTIVE, getConceptsForSymbol } from '@/lib/tw-concepts'
import SignalBadge from '@/components/SignalBadge'
import ScanProgressBar from '@/components/ScanProgressBar'
import MiniChart from '@/components/MiniChart'

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

// 漲跌顯示格式（台股慣例：漲=紅，跌=綠）
function ChangeDisplay({ change, changePct }: { change: number | null; changePct: number | null }) {
  if (change == null || changePct == null) return <span className="text-[#8b949e]">—</span>
  const up    = change >= 0
  const color = up ? 'text-red-400' : 'text-green-400'
  const arrow = up ? '▲' : '▼'
  const sign  = up ? '+' : ''
  return (
    <span className={`${color} font-mono`}>
      {arrow} {sign}{change.toFixed(2)}<br />
      <span className="text-[9px]">({sign}{changePct.toFixed(2)}%)</span>
    </span>
  )
}

// ─────────────────────────────────────────────
//  股票卡片（含迷你圖）
// ─────────────────────────────────────────────
function StockCard({ stock, rank }: { stock: ScanResult; rank: number }) {
  const router   = useRouter()
  const volColor = stock.volume_ratio != null
    ? stock.volume_ratio >= 2 ? 'text-yellow-400'
    : stock.volume_ratio >= 1.5 ? 'text-green-400'
    : 'text-[#e6edf3]'
    : 'text-[#8b949e]'

  const shortCode = stock.symbol.replace('.TW', '').replace('.TWO', '')
  const market    = stock.symbol.endsWith('.TWO') ? 'OTC' : 'TSE'
  const concepts  = getConceptsForSymbol(stock.symbol).slice(0, 2) // 最多顯示 2 個

  function handleCardClick() {
    router.push(`/simulate?symbol=${shortCode}&market=TW`)
  }

  function handleChartClick(e: React.MouseEvent) {
    e.stopPropagation()
    router.push(`/chart/${encodeURIComponent(stock.symbol)}?signal=${stock.signal}&date=${stock.scan_date}`)
  }

  return (
    <div
      className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden flex flex-col hover:border-[#58a6ff]/60 hover:bg-[#1c2128] transition-all cursor-pointer"
      onClick={handleCardClick}
    >
      {/* ── 卡片標頭 ── */}
      <div className="px-3 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] text-[#8b949e] shrink-0">#{rank}</span>
            <span className="font-mono font-bold text-[#58a6ff] text-sm">{shortCode}</span>
            <span className="text-[10px] text-[#8b949e] shrink-0">{market}</span>
            <span className="text-sm font-medium truncate">{stock.name}</span>
          </div>
          {/* ── 概念 Badge ── */}
          {concepts.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {concepts.map(c => (
                <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${CONCEPT_BADGE[c]}`}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SignalBadge signal={stock.signal} />
          <button
            onClick={handleChartClick}
            className="text-[10px] text-[#58a6ff] hover:text-white transition-colors"
          >
            全圖 →
          </button>
        </div>
      </div>

      {/* ── MA 圖例 ── */}
      <div className="px-3 pb-1.5 flex gap-3 text-[10px] text-[#8b949e]">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: '#f0c040' }} />MA5</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: '#26c6da' }} />MA60</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: '#ec407a' }} />MA100</span>
      </div>

      {/* ── 迷你 K 線圖 ── */}
      <div className="border-t border-[#21262d]">
        <MiniChart symbol={stock.symbol} height={180} />
      </div>

      {/* ── 卡片底部數據 ── */}
      <div className="px-3 py-2 border-t border-[#21262d] grid grid-cols-5 gap-1 text-center">
        <div>
          <div className="text-[9px] text-[#8b949e]">收盤</div>
          <div className="font-mono text-xs font-semibold">{stock.price.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#8b949e]">漲跌</div>
          <div className="text-xs leading-tight">
            <ChangeDisplay change={stock.change} changePct={stock.change_pct} />
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[#8b949e]">MA5</div>
          <div className="font-mono text-xs" style={{ color: '#f0c040' }}>{stock.ma5?.toFixed(2) ?? '—'}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#8b949e]">MA100</div>
          <div className="font-mono text-xs" style={{ color: '#ec407a' }}>{stock.ma100?.toFixed(2) ?? '—'}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#8b949e]">量比</div>
          <div className={`font-mono text-xs ${volColor}`}>
            {stock.volume_ratio != null ? `${stock.volume_ratio.toFixed(1)}x` : '—'}
          </div>
        </div>
      </div>

      {/* 日期 */}
      <div className="px-3 pb-2 text-[9px] text-[#8b949e] text-right">{stock.scan_date}</div>
    </div>
  )
}

// ─────────────────────────────────────────────
//  主頁
// ─────────────────────────────────────────────
export default function HomePage() {
  const [data,          setData]          = useState<ScanResponse | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [filter,        setFilter]        = useState<FilterType>('ALL')
  const [conceptFilter, setConceptFilter] = useState<string>('ALL')
  const [error,         setError]         = useState<string | null>(null)
  const [scanning,      setScanning]      = useState(false)
  const [dates,         setDates]         = useState<string[]>([])
  const [dateIdx,       setDateIdx]       = useState(0)

  const load = useCallback(async (date?: string) => {
    try {
      setLoading(true)
      setError(null)
      const res = await getScanResults(undefined, date)
      setData(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '無法連接後端，請確認服務已啟動。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    getTWScanDates().then(r => setDates(r.dates)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  function handleDateNav(dir: 'prev' | 'next') {
    const newIdx = dir === 'next' ? dateIdx - 1 : dateIdx + 1
    if (newIdx < 0 || newIdx >= dates.length) return
    setDateIdx(newIdx)
    load(dates[newIdx])
  }

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

  const allResults = data?.results ?? []
  const longCount  = allResults.filter(r => r.signal === 'LONG').length
  const shortCount = allResults.filter(r => r.signal === 'SHORT').length

  // 先套訊號篩選，再套概念篩選
  const signalFiltered = filter === 'ALL' ? allResults : allResults.filter(r => r.signal === filter)
  const filtered = conceptFilter === 'ALL'
    ? signalFiltered
    : conceptFilter === '其他'
      ? signalFiltered.filter(r => getConceptsForSymbol(r.symbol).length === 0)
      : signalFiltered.filter(r => getConceptsForSymbol(r.symbol).includes(conceptFilter))

  // 計算各概念在當前訊號篩選下的數量（有資料才顯示）
  const conceptCounts = Object.fromEntries(
    CONCEPTS.map(c => [c, signalFiltered.filter(r => getConceptsForSymbol(r.symbol).includes(c)).length])
  )
  const otherCount = signalFiltered.filter(r => getConceptsForSymbol(r.symbol).length === 0).length

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
            {dates.length > 0 && (
              <div className="hidden sm:flex items-center gap-1">
                <button
                  onClick={() => handleDateNav('prev')}
                  disabled={dateIdx >= dates.length - 1}
                  className="w-6 h-6 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="往前一天"
                >‹</button>
                <span className="text-xs text-[#8b949e] min-w-[80px] text-center">
                  {data?.scan_date ?? dates[dateIdx]}
                </span>
                <button
                  onClick={() => handleDateNav('next')}
                  disabled={dateIdx <= 0}
                  className="w-6 h-6 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="往後一天"
                >›</button>
              </div>
            )}
            <Link href="/scan-us" className="px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg transition-colors">
              🇺🇸 美股選股
            </Link>
            <Link href="/trades" className="px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg transition-colors">
              📋 交易紀錄
            </Link>
            <Link href="/simulate" className="px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg transition-colors">
              📊 模擬交易
            </Link>
            <button
              onClick={() => { setDateIdx(0); load() }}
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

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">

        {/* ── 統計卡 ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="掃描結果" value={data?.total ?? 0}       color="text-white" />
          <StatCard label="做多訊號" value={longCount}               color="text-red-400" />
          <StatCard label="做空訊號" value={shortCount}              color="text-green-400" />
          <StatCard label="掃描日期" value={data?.scan_date ?? '—'}  color="text-[#e3b341]" />
        </div>

        {/* ── 訊號篩選 ── */}
        <div className="flex gap-2">
          {(['ALL', 'LONG', 'SHORT'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === f
                  ? f === 'LONG'  ? 'bg-red-600 text-white'
                  : f === 'SHORT' ? 'bg-green-600 text-white'
                  :                 'bg-blue-600 text-white'
                  : 'bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d]'
              }`}
            >
              {f === 'ALL' ? `全部 (${allResults.length})` : f === 'LONG' ? `做多 (${longCount})` : `做空 (${shortCount})`}
            </button>
          ))}
        </div>

        {/* ── 概念篩選 ── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {/* 全部概念 */}
          <button
            onClick={() => setConceptFilter('ALL')}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 ${
              conceptFilter === 'ALL'
                ? 'bg-[#388bfd]/20 text-[#58a6ff] border border-[#388bfd]/40'
                : 'bg-[#21262d] text-[#8b949e] border border-[#30363d] hover:text-white'
            }`}
          >
            全部概念 ({signalFiltered.length})
          </button>

          {/* 各概念按鈕（只顯示有資料的） */}
          {CONCEPTS.map(c => {
            const count = conceptCounts[c]
            if (count === 0) return null
            return (
              <button
                key={c}
                onClick={() => setConceptFilter(c)}
                className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 ${
                  conceptFilter === c
                    ? CONCEPT_ACTIVE[c]
                    : 'bg-[#21262d] text-[#8b949e] border border-[#30363d] hover:text-white'
                }`}
              >
                {c} ({count})
              </button>
            )
          })}

          {/* 其他 */}
          {otherCount > 0 && (
            <button
              onClick={() => setConceptFilter('其他')}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 ${
                conceptFilter === '其他'
                  ? 'bg-[#444c56] text-white'
                  : 'bg-[#21262d] text-[#8b949e] border border-[#30363d] hover:text-white'
              }`}
            >
              其他 ({otherCount})
            </button>
          )}
        </div>

        {/* ── 錯誤訊息 ── */}
        {error && (
          <div className="bg-red-950/30 border border-red-800/50 text-red-400 rounded-xl p-4 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ── 卡片網格 ── */}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((stock, i) => (
              <StockCard key={stock.symbol} stock={stock} rank={i + 1} />
            ))}
          </div>
        )}
      </main>

      {/* ── 掃描進度監控 ── */}
      <ScanProgressBar
        triggered={scanning}
        onDone={handleScanDone}
        onPartialRefresh={load}
      />
    </div>
  )
}
