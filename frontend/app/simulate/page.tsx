'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  getSimulationData, getMyTrades, addMyTrade, recordExit, deleteMyTrade,
  getTWStockList,
  SimData, SimRow, Trade, TradeIn, ExitIn, StockItem,
} from '@/lib/api'
import MiniChart from '@/components/MiniChart'

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function sigClass(sig: string) {
  if (!sig) return 'sig-wait'
  if (sig.startsWith('⚾')) return 'sig-long'
  if (sig.startsWith('🥎') || sig.includes('做空')) return 'sig-short'
  if (sig.startsWith('✋') || sig.startsWith('🛑')) return 'sig-exit'
  return 'sig-wait'
}

const SIG_STYLES: Record<string, string> = {
  'sig-long':  'bg-red-950 text-red-400 border border-red-700',
  'sig-short': 'bg-green-950 text-green-400 border border-green-700',
  'sig-exit':  'bg-amber-950 text-amber-400 border border-amber-700',
  'sig-wait':  'bg-[#1c2128] text-gray-400 border border-[#30363d]',
}

function SigBadge({ text, type }: { text: string; type: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] leading-snug whitespace-normal ${SIG_STYLES[type] ?? SIG_STYLES['sig-wait']}`}>
      {text}
    </span>
  )
}

function pnlColor(v: number) {
  if (v > 0) return 'text-red-400 font-semibold'
  if (v < 0) return 'text-green-400 font-semibold'
  return 'text-gray-500'
}

function fmtPnl(v: number) {
  if (v === 0) return '—'
  return `${v > 0 ? '+' : '-'}NT$${Math.abs(v).toLocaleString()}`
}

function fmtPrice(v: number | null, isUS: boolean) {
  if (!v) return '—'
  return isUS ? '$' + v.toFixed(2) : v.toLocaleString()
}

function kTrendColor(state: string): string {
  if (state.includes('超買') || state.includes('轉強')) return 'text-red-400'
  if (state.includes('超賣') || state.includes('轉弱')) return 'text-blue-400'
  return 'text-gray-500'
}

function KTrendCell({ state, k }: { state: string; k: number | null }) {
  if (!state || state === '—') return <span className="text-gray-600">—</span>
  return (
    <span className={`font-medium whitespace-nowrap ${kTrendColor(state)}`}>
      {state} <span className="font-mono text-[11px] opacity-80">{k?.toFixed(1) ?? ''}</span>
    </span>
  )
}

function holdColor(h: string) {
  if (h === '多單') return 'text-red-400 font-semibold'
  if (h === '空單') return 'text-green-400 font-semibold'
  return 'text-gray-500'
}

function dirColor(d: string) {
  return d === '多單' ? 'text-red-400' : 'text-green-400'
}

// Realized P&L for one trade (needs exit)
function calcRealized(t: Trade, isUS: boolean, usdTwd: number): number | null {
  if (!t.exit_price || !t.entry_price || !t.shares) return null
  const raw = t.direction === '多單'
    ? (t.exit_price - t.entry_price) * t.shares
    : (t.entry_price - t.exit_price) * t.shares
  return isUS ? Math.round(raw * usdTwd) : Math.round(raw)
}

// Unrealized P&L for one trade vs current price
function calcUnrealized(t: Trade, currentClose: number, isUS: boolean, usdTwd: number): number | null {
  if (!t.entry_price || !t.shares) return null
  const raw = t.direction === '多單'
    ? (currentClose - t.entry_price) * t.shares
    : (t.entry_price - currentClose) * t.shares
  return isUS ? Math.round(raw * usdTwd) : Math.round(raw)
}

// ─────────────────────────────────────────────
//  Exit form (inline per trade row)
// ─────────────────────────────────────────────

// defaultDate: today in YYYY-MM-DD, defaultPrice: latest close
function ExitForm({
  trade, isUS, defaultDate, defaultPrice, onSave, onCancel,
}: {
  trade: Trade; isUS: boolean
  defaultDate: string; defaultPrice: number
  onSave: (exitDate: string, exitPrice: number) => Promise<void>
  onCancel: () => void
}) {
  const [exitDate,  setExitDate]  = useState(defaultDate)
  const [exitPrice, setExitPrice] = useState(String(defaultPrice))
  const [saving,    setSaving]    = useState(false)

  const handleSave = async () => {
    if (!exitDate || !exitPrice) return
    setSaving(true)
    try { await onSave(exitDate, parseFloat(exitPrice)) }
    finally { setSaving(false) }
  }

  // Compute preview P&L
  const previewPnl = (() => {
    const ep = parseFloat(exitPrice)
    if (!ep || !trade.entry_price || !trade.shares) return null
    const raw = trade.direction === '多單'
      ? (ep - trade.entry_price) * trade.shares
      : (trade.entry_price - ep) * trade.shares
    return isUS ? Math.round(raw * 32) : Math.round(raw)
  })()

  return (
    <tr className="bg-[#1c2128] border-b border-[#21262d]">
      <td colSpan={10} className="px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">出場日期（自動帶入今日）</label>
            <input type="date" value={exitDate} onChange={e => setExitDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="bg-[#0d1117] border border-[#58a6ff] rounded px-3 py-1.5 text-sm [color-scheme:dark] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">
              出場價格 {isUS ? '(USD)' : '(TWD)'}
              <span className="ml-1 text-[#8b949e]">（預設最新收盤）</span>
            </label>
            <input type="number" step="0.01" value={exitPrice} onChange={e => setExitPrice(e.target.value)}
              className="bg-[#0d1117] border border-[#58a6ff] rounded px-3 py-1.5 text-sm focus:outline-none w-32"
            />
          </div>
          {previewPnl !== null && (
            <div className="flex flex-col justify-end">
              <label className="block text-xs text-[#8b949e] mb-1">預估實現損益</label>
              <div className={`px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${previewPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {previewPnl >= 0 ? '+' : '-'}NT${Math.abs(previewPnl).toLocaleString()}
              </div>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button onClick={handleSave} disabled={saving || !exitDate || !exitPrice}
              className="px-4 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded text-sm font-medium disabled:opacity-40">
              {saving ? '儲存中...' : '✓ 確認出場'}
            </button>
            <button onClick={onCancel} className="px-3 py-1.5 text-[#8b949e] hover:text-white text-sm">取消</button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────

function SimulatePage() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  const [market,       setMarket]       = useState<'TW' | 'US'>((searchParams.get('market') as 'TW' | 'US') || 'TW')
  const [inputSymbol,  setInputSymbol]  = useState(searchParams.get('symbol') || '')
  const [data,         setData]         = useState<SimData | null>(null)
  const [trades,       setTrades]       = useState<Trade[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [customShares, setCustomShares] = useState('')
  const [exitingId,    setExitingId]    = useState<number | null>(null)

  // Date range (empty = last 30 trading days)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd,   setRangeEnd]   = useState('')

  // 台股自動完成
  const [twStockList,     setTwStockList]     = useState<StockItem[]>([])
  const [suggestions,     setSuggestions]     = useState<StockItem[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Entry form
  const [formDir,    setFormDir]    = useState<'多單' | '空單'>('多單')
  const [formDate,   setFormDate]   = useState('')
  const [formPrice,  setFormPrice]  = useState('')
  const [formShares, setFormShares] = useState('')
  const [formNotes,  setFormNotes]  = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadData = useCallback(async (sym: string, mkt: string, start?: string, end?: string) => {
    setLoading(true); setError(null)
    try {
      const [sim, tr] = await Promise.all([
        getSimulationData(sym, mkt, start || undefined, end || undefined),
        getMyTrades(sym, mkt),
      ])
      setData(sim); setTrades(tr); setCustomShares(String(sim.default_shares))
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const sym = searchParams.get('symbol')
    const mkt = (searchParams.get('market') as 'TW' | 'US') || 'TW'
    if (sym) { setInputSymbol(sym); setMarket(mkt); loadData(sym, mkt, rangeStart, rangeEnd) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadData])

  // 載入台股清單（切換到 TW 時才載，只載一次）
  useEffect(() => {
    if (market === 'TW' && twStockList.length === 0) {
      getTWStockList().then(setTwStockList).catch(() => {})
    }
  }, [market]) // eslint-disable-line react-hooks/exhaustive-deps

  // 根據輸入更新自動完成建議
  useEffect(() => {
    if (market !== 'TW' || !inputSymbol || twStockList.length === 0) {
      setSuggestions([]); return
    }
    const q = inputSymbol.trim()
    if (!q) { setSuggestions([]); return }
    const lower = q.toLowerCase()
    const matches = twStockList.filter(s =>
      s.symbol.startsWith(q) ||          // 代號前綴
      s.name.includes(q)                 // 名稱包含
    ).slice(0, 8)
    setSuggestions(matches)
  }, [inputSymbol, market, twStockList])

  const handleSearch = (sym?: string) => {
    const s = (sym ?? inputSymbol).trim().toUpperCase()
    if (!s) return
    setShowSuggestions(false)
    router.push(`/simulate?symbol=${s}&market=${market}`)
  }

  const handleSuggestionClick = (item: StockItem) => {
    setInputSymbol(item.symbol)
    setShowSuggestions(false)
    router.push(`/simulate?symbol=${item.symbol}&market=${market}`)
  }

  // Apply date range to currently loaded symbol
  const handleRangeApply = () => {
    const sym = inputSymbol.trim().toUpperCase()
    if (!sym) return
    loadData(sym, market, rangeStart, rangeEnd)
  }

  // Quick preset: set rangeStart relative to today
  const applyPreset = (days: number | null) => {
    if (days === null) {
      setRangeStart(''); setRangeEnd('')
      const sym = inputSymbol.trim().toUpperCase()
      if (sym) loadData(sym, market, '', '')
    } else {
      const end   = new Date()
      const start = new Date(end)
      start.setDate(start.getDate() - days)
      const fmt = (d: Date) => d.toISOString().split('T')[0]
      setRangeStart(fmt(start)); setRangeEnd(fmt(end))
      const sym = inputSymbol.trim().toUpperCase()
      if (sym) loadData(sym, market, fmt(start), fmt(end))
    }
  }

  const refreshTrades = async () => {
    if (!data) return
    setTrades(await getMyTrades(data.symbol, data.market))
  }

  const isUS       = data?.market === 'US'
  const hasData    = !!data && data.rows.length > 0
  const sharesNum  = parseInt(customShares) || data?.default_shares || 1
  const scaleFactor = data ? sharesNum / data.default_shares : 1
  const scaledPnl  = (raw: number) => Math.round(raw * scaleFactor)

  const openTrades = useMemo(() => trades.filter(t => !t.exit_date), [trades])

  // Per-row state: includes closed trades (shows exit-day realized P&L in table)
  const computeMyState = (row: SimRow): {
    hold: string; entry: number | null; pnl: number | null; isExitDay: boolean; dir: string
  } => {
    if (!data || !trades.length) return { hold: '空手', entry: null, pnl: null, isExitDay: false, dir: '多單' }

    // All trades active on this row date: entered on or before, and either open or exit on/after
    const active = trades.filter(t =>
      t.entry_date && t.entry_date <= row.date &&
      (!t.exit_date || t.exit_date >= row.date)
    )
    if (!active.length) return { hold: '空手', entry: null, pnl: null, isExitDay: false, dir: '多單' }

    const t = active[active.length - 1]
    const isExitDay = t.exit_date === row.date

    if (isExitDay) {
      const pnl = calcRealized(t, isUS, data.usd_twd) ?? 0
      return { hold: '出場', entry: t.entry_price, pnl, isExitDay: true, dir: t.direction }
    }
    const pnl = calcUnrealized(t, row.close, isUS, data.usd_twd)
    return { hold: t.direction, entry: t.entry_price, pnl, isExitDay: false, dir: t.direction }
  }

  // Auto summary
  const autoSummary = useMemo(() => {
    if (!data?.rows.length) return { hold: '—', pnl: 0 }
    const last = data.rows[data.rows.length - 1]
    return { hold: last.auto_hold, pnl: scaledPnl(last.auto_pnl_twd) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, scaleFactor])

  // My trades analysis
  const myAnalysis = useMemo(() => {
    if (!data || !trades.length) return null
    const lastClose  = data.rows[data.rows.length - 1].close
    const closed     = trades.filter(t => t.exit_date)
    const open       = trades.filter(t => !t.exit_date)

    const realizedList = closed.map(t => calcRealized(t, isUS, data.usd_twd) ?? 0)
    const totalRealized = realizedList.reduce((s, v) => s + v, 0)
    const realizedWins  = realizedList.filter(v => v > 0).length
    const realizedLoss  = realizedList.filter(v => v < 0).length

    const unrealizedList = open.map(t => calcUnrealized(t, lastClose, isUS, data.usd_twd) ?? 0)
    const totalUnrealized = unrealizedList.reduce((s, v) => s + v, 0)

    return {
      closedCount: closed.length,
      openCount:   open.length,
      totalRealized, realizedWins, realizedLoss,
      totalUnrealized,
      netPnl: totalRealized + totalUnrealized,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, trades, isUS])

  // Strategy verdict
  const verdict = useMemo(() => {
    if (!myAnalysis || !data?.rows.length) return null
    const autoExits = data.rows.filter(r => r.auto_hold === '空手' && r.auto_pnl_twd !== 0)
    const autoRealized = autoExits.reduce((s, r) => s + scaledPnl(r.auto_pnl_twd), 0)
    const last = data.rows[data.rows.length - 1]
    const autoUnrealized = last.auto_hold !== '空手' ? scaledPnl(last.auto_pnl_twd) : 0
    const autoWins = autoExits.filter(r => scaledPnl(r.auto_pnl_twd) > 0).length
    const autoLoss = autoExits.filter(r => scaledPnl(r.auto_pnl_twd) < 0).length
    const autoNet  = autoRealized + autoUnrealized
    const diff     = autoNet - myAnalysis.netPnl
    return { autoRealized, autoUnrealized, autoNet, autoWins, autoLoss, diff, winner: diff > 0 ? 'auto' : diff < 0 ? 'my' : 'tie' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, myAnalysis, scaleFactor])

  // Add trade
  const handleAddTrade = async () => {
    if (!data || !formDate || !formPrice || !formShares) return
    setSubmitting(true)
    try {
      const price  = parseFloat(formPrice)
      const shares = parseInt(formShares)
      const cost   = isUS ? Math.round(price * shares * data.usd_twd) : price * shares
      const body: TradeIn = { direction: formDir, entry_date: formDate, entry_price: price, shares, cost, notes: formNotes }
      await addMyTrade(data.symbol, data.market, body)
      await refreshTrades()
      setFormDate(''); setFormPrice(''); setFormShares(''); setFormNotes('')
    } finally { setSubmitting(false) }
  }

  // Record exit
  const handleExit = async (id: number, exitDate: string, exitPrice: number) => {
    await recordExit(id, { exit_date: exitDate, exit_price: exitPrice })
    await refreshTrades()
    setExitingId(null)
  }

  const handleDelete = async (id: number) => {
    await deleteMyTrade(id)
    setTrades(prev => prev.filter(t => t.id !== id))
  }

  const formCost = formPrice && formShares
    ? 'NT$' + (isUS
        ? Math.round(parseFloat(formPrice) * parseInt(formShares) * (data?.usd_twd ?? 32))
        : Math.round(parseFloat(formPrice) * parseInt(formShares))
      ).toLocaleString()
    : '—'

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">
      <nav className="border-b border-[#21262d] px-4 py-3 flex items-center gap-4">
        <Link href="/" className="text-[#58a6ff] text-sm hover:underline">← 台股選股</Link>
        <Link href="/scan-us" className="text-[#8b949e] text-sm hover:text-white transition-colors">🇺🇸 美股選股</Link>
        <Link href="/trades"
          className="px-3 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg transition-colors text-[#e6edf3]">
          📋 交易紀錄
        </Link>
        <span className="text-[#8b949e] text-sm">策略選股</span>
      </nav>

      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

        {/* Search */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
          <h1 className="text-lg font-bold mb-4">📊 模擬交易分析</h1>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex rounded-lg overflow-hidden border border-[#30363d]">
              {(['TW', 'US'] as const).map(m => (
                <button key={m} onClick={() => setMarket(m)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${market === m ? 'bg-[#58a6ff] text-[#0d1117]' : 'bg-[#0d1117] text-[#8b949e] hover:bg-[#21262d]'}`}>
                  {m === 'TW' ? '🇹🇼 台股' : '🇺🇸 美股'}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <input
                type="text"
                value={inputSymbol}
                onChange={e => { setInputSymbol(e.target.value); setShowSuggestions(true) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSearch()
                  if (e.key === 'Escape') setShowSuggestions(false)
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder={market === 'TW' ? '台股代碼或名稱（如 2330 或 台積電）' : '美股代碼（如 NVDA）'}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
              />
              {/* 自動完成下拉 */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden">
                  {suggestions.map(s => (
                    <button
                      key={s.symbol}
                      onMouseDown={() => handleSuggestionClick(s)}
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-[#21262d] transition-colors text-left"
                    >
                      <span className="font-mono text-sm font-bold text-[#58a6ff] w-14 shrink-0">{s.symbol}</span>
                      <span className="text-sm text-[#e6edf3]">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => handleSearch()} disabled={loading}
              className="px-5 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? '查詢中...' : '查詢'}
            </button>
          </div>
        </div>

        {error && <div className="bg-red-950 border border-red-700 text-red-400 rounded-xl p-4 text-sm">⚠️ {error}</div>}
        {loading && <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-8 text-center text-[#8b949e]">載入中，請稍候...</div>}

        {/* Header */}
        {hasData && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-bold font-mono">{data!.symbol}</span>
            {data!.name && (
              <span className="text-lg font-semibold text-[#e6edf3]">{data!.name}</span>
            )}
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${isUS ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300'}`}>
              {isUS ? '美股' : '台股'}
            </span>
            {isUS && <span className="text-[#8b949e] text-sm">USD/TWD：{data!.usd_twd.toFixed(2)}</span>}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-[#8b949e]">🤖 自動策略股數：</span>
              <input type="number" min="1" value={customShares} onChange={e => setCustomShares(e.target.value)}
                className="w-24 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-[#58a6ff]"
              />
              <span className="text-xs text-[#8b949e]">股</span>
            </div>
          </div>
        )}

        {/* Inline K-line chart */}
        {hasData && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            {/* Chart header */}
            <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#8b949e]">K線趨勢分析</span>
              <div className="flex gap-3 text-[10px] text-[#8b949e]">
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: '#f0c040' }} />MA5</span>
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: '#26c6da' }} />MA60</span>
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: '#ec407a' }} />MA100</span>
              </div>
            </div>
            <MiniChart symbol={data!.symbol_full} height={320} />
          </div>
        )}

        {/* Date range picker */}
        {hasData && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-xs text-[#8b949e] self-center">📅 顯示區間</span>
              {/* Quick presets */}
              {[
                { label: '近30日', days: null },
                { label: '近1月', days: 30 },
                { label: '近3月', days: 90 },
                { label: '近6月', days: 180 },
              ].map(p => (
                <button key={p.label}
                  onClick={() => applyPreset(p.days)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors border ${
                    (p.days === null && !rangeStart)
                      ? 'bg-[#58a6ff] text-[#0d1117] border-[#58a6ff]'
                      : 'bg-[#0d1117] text-[#8b949e] border-[#30363d] hover:border-[#58a6ff] hover:text-[#58a6ff]'
                  }`}>
                  {p.label}
                </button>
              ))}
              <span className="text-[#8b949e] text-xs self-center">或自訂：</span>
              <div className="flex items-center gap-2">
                <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                  max={rangeEnd || new Date().toISOString().split('T')[0]}
                  className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs [color-scheme:dark] focus:outline-none focus:border-[#58a6ff]"
                />
                <span className="text-[#8b949e] text-xs">至</span>
                <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                  min={rangeStart} max={new Date().toISOString().split('T')[0]}
                  className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs [color-scheme:dark] focus:outline-none focus:border-[#58a6ff]"
                />
                <button onClick={handleRangeApply} disabled={!rangeStart || !rangeEnd || loading}
                  className="px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded text-xs font-medium disabled:opacity-40">
                  套用
                </button>
              </div>
              {rangeStart && rangeEnd && (
                <span className="text-xs text-[#8b949e]">
                  共 {Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86400000)} 天
                </span>
              )}
            </div>
          </div>
        )}

        {/* Strategy table */}
        {hasData && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#21262d] text-sm font-semibold text-[#8b949e]">
              策略指標表（{rangeStart && rangeEnd ? `${rangeStart} ～ ${rangeEnd}，共 ${data!.rows.length} 個交易日` : `近 ${data!.rows.length} 個交易日`}）
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[1200px]">
                <thead>
                  <tr className="bg-[#0d1117] text-[#8b949e] text-left">
                    <th className="px-3 py-2 whitespace-nowrap">日期</th>
                    <th className="px-3 py-2 text-right">開盤</th>
                    <th className="px-3 py-2 text-right">收盤</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">漲跌</th>
                    <th className="px-3 py-2 text-right text-blue-400">MA5</th>
                    <th className="px-3 py-2 text-right text-orange-400">MA100</th>
                    <th className="px-3 py-2">K趨勢</th>
                    <th className="px-3 py-2">走勢</th>
                    <th className="px-3 py-2">PPP</th>
                    <th className="px-3 py-2">短期訊號</th>
                    <th className="px-3 py-2 border-l-2 border-[#58a6ff]/30 text-blue-300">🤖 持倉</th>
                    <th className="px-3 py-2 text-right text-blue-300">進場價</th>
                    <th className="px-3 py-2 text-right text-blue-300 whitespace-nowrap">損益(TWD)</th>
                    <th className="px-3 py-2 border-l-2 border-yellow-500/30 text-yellow-300">👤 持倉</th>
                    <th className="px-3 py-2 text-right text-yellow-300">進場價</th>
                    <th className="px-3 py-2 text-right text-yellow-300 whitespace-nowrap">損益(TWD)</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.rows.map((row, i) => {
                    const myState    = computeMyState(row)
                    const isBull     = row.trend.includes('多')
                    const autoPnl    = scaledPnl(row.auto_pnl_twd)
                    const myHoldColor = myState.isExitDay
                      ? 'text-amber-400 font-semibold'
                      : holdColor(myState.hold)
                    // 漲跌（vs 前一日收盤；第一行無前日）
                    const prevClose  = i > 0 ? data!.rows[i - 1].close : null
                    const chg        = prevClose != null ? row.close - prevClose : null
                    const chgPct     = prevClose != null && prevClose !== 0 ? chg! / prevClose * 100 : null
                    const chgUp      = chg != null ? chg >= 0 : null
                    const chgColor   = chgUp === true ? 'text-red-400' : chgUp === false ? 'text-green-400' : 'text-[#8b949e]'
                    return (
                      <tr key={row.date}
                        className={`border-b border-[#21262d] hover:bg-[#1c2128] ${i === data!.rows.length - 1 ? 'font-semibold' : ''} ${myState.isExitDay ? 'bg-amber-950/10' : ''}`}>
                        <td className="px-3 py-2 font-mono whitespace-nowrap text-[#8b949e]">{row.date}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtPrice(row.open, isUS)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${row.close >= row.open ? 'text-red-400' : 'text-green-400'}`}>{fmtPrice(row.close, isUS)}</td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${chgColor}`}>
                          {chg != null ? (
                            <span>
                              {chgUp ? '▲' : '▼'} {chg >= 0 ? '+' : ''}{isUS ? chg.toFixed(2) : chg.toFixed(2)}<br />
                              <span className="text-[10px] opacity-80">({chgPct! >= 0 ? '+' : ''}{chgPct!.toFixed(2)}%)</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-blue-400">{row.ma5 ? fmtPrice(row.ma5, isUS) : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-orange-400">{row.ma100 ? fmtPrice(row.ma100, isUS) : '—'}</td>
                        <td className="px-3 py-2"><KTrendCell state={row.k_state} k={row.k} /></td>
                        <td className="px-3 py-2"><SigBadge text={row.trend} type={isBull ? 'sig-long' : 'sig-short'} /></td>
                        <td className="px-3 py-2 max-w-[140px]"><span className="text-[11px] text-[#8b949e] leading-tight block whitespace-normal">{row.ppp}</span></td>
                        <td className="px-3 py-2 max-w-[180px]"><SigBadge text={row.sig} type={sigClass(row.sig)} /></td>
                        <td className={`px-3 py-2 border-l-2 border-[#58a6ff]/20 ${holdColor(row.auto_hold)}`}>{row.auto_hold}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#8b949e]">{fmtPrice(row.auto_entry || null, isUS)}</td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${pnlColor(autoPnl)}`}>{fmtPnl(autoPnl)}</td>
                        <td className={`px-3 py-2 border-l-2 border-yellow-500/20 ${myHoldColor}`}>{myState.hold}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#8b949e]">{myState.entry ? fmtPrice(myState.entry, isUS) : '—'}</td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${myState.pnl !== null ? pnlColor(myState.pnl) : 'text-gray-500'}`}>
                          {myState.pnl !== null ? fmtPnl(myState.pnl) : '—'}
                          {myState.isExitDay && <span className="text-[10px] text-amber-500 ml-1">實</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Comparison + Summary */}
        {hasData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#161b22] border border-[#58a6ff]/30 rounded-xl p-5">
              <div className="text-[#58a6ff] font-semibold mb-4">🤖 自動策略績效</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[#8b949e]">目前持倉</span><span className={holdColor(autoSummary.hold)}>{autoSummary.hold}</span></div>
                <div className="flex justify-between"><span className="text-[#8b949e]">最新損益</span><span className={`whitespace-nowrap ${pnlColor(autoSummary.pnl)}`}>{fmtPnl(autoSummary.pnl)}</span></div>
                <div className="flex justify-between"><span className="text-[#8b949e]">計算股數</span><span>{sharesNum.toLocaleString()} 股</span></div>
              </div>
            </div>
            <div className="bg-[#161b22] border border-yellow-500/30 rounded-xl p-5">
              <div className="text-yellow-400 font-semibold mb-4">👤 我的交易績效</div>
              {!myAnalysis ? (
                <div className="text-[#8b949e] text-sm">尚無交易記錄</div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-[#8b949e]">已出場（實現損益）</span><span className={`whitespace-nowrap ${pnlColor(myAnalysis.totalRealized)}`}>{fmtPnl(myAnalysis.totalRealized)}</span></div>
                  <div className="flex justify-between"><span className="text-[#8b949e]">持倉中（浮動損益）</span><span className={`whitespace-nowrap ${pnlColor(myAnalysis.totalUnrealized)}`}>{myAnalysis.openCount > 0 ? fmtPnl(myAnalysis.totalUnrealized) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-[#8b949e]">出場次數 勝/敗</span><span><span className="text-red-400">{myAnalysis.realizedWins}勝</span> / <span className="text-green-400">{myAnalysis.realizedLoss}敗</span></span></div>
                  <div className="flex justify-between font-semibold border-t border-[#21262d] pt-2"><span>淨損益</span><span className={`whitespace-nowrap ${pnlColor(myAnalysis.netPnl)}`}>{fmtPnl(myAnalysis.netPnl)}</span></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Verdict */}
        {hasData && verdict && myAnalysis && myAnalysis.closedCount + myAnalysis.openCount > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
            <div className="font-semibold mb-4">📋 策略績效總結</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div className="space-y-2">
                <div className="text-[#58a6ff] font-medium mb-2">🤖 自動策略</div>
                <div className="flex justify-between text-[#8b949e]"><span>已實現</span><span className={`whitespace-nowrap ${pnlColor(verdict.autoRealized)}`}>{fmtPnl(verdict.autoRealized)}</span></div>
                <div className="flex justify-between text-[#8b949e]"><span>未實現</span><span className={`whitespace-nowrap ${pnlColor(verdict.autoUnrealized)}`}>{verdict.autoUnrealized !== 0 ? fmtPnl(verdict.autoUnrealized) : '—'}</span></div>
                <div className="flex justify-between text-[#8b949e]"><span>勝/敗</span><span><span className="text-red-400">{verdict.autoWins}勝</span> / <span className="text-green-400">{verdict.autoLoss}敗</span></span></div>
                <div className="flex justify-between font-semibold border-t border-[#21262d] pt-2"><span>淨損益</span><span className={`whitespace-nowrap ${pnlColor(verdict.autoNet)}`}>{fmtPnl(verdict.autoNet)}</span></div>
              </div>
              <div className="space-y-2">
                <div className="text-yellow-400 font-medium mb-2">👤 我的交易</div>
                <div className="flex justify-between text-[#8b949e]"><span>已實現</span><span className={`whitespace-nowrap ${pnlColor(myAnalysis.totalRealized)}`}>{fmtPnl(myAnalysis.totalRealized)}</span></div>
                <div className="flex justify-between text-[#8b949e]"><span>未實現</span><span className={`whitespace-nowrap ${pnlColor(myAnalysis.totalUnrealized)}`}>{myAnalysis.openCount > 0 ? fmtPnl(myAnalysis.totalUnrealized) : '—'}</span></div>
                <div className="flex justify-between text-[#8b949e]"><span>勝/敗</span><span><span className="text-red-400">{myAnalysis.realizedWins}勝</span> / <span className="text-green-400">{myAnalysis.realizedLoss}敗</span></span></div>
                <div className="flex justify-between font-semibold border-t border-[#21262d] pt-2"><span>淨損益</span><span className={`whitespace-nowrap ${pnlColor(myAnalysis.netPnl)}`}>{fmtPnl(myAnalysis.netPnl)}</span></div>
              </div>
              <div className="flex flex-col justify-center items-center gap-3">
                <div className={`w-full rounded-lg p-4 text-center font-semibold ${
                  verdict.winner === 'auto' ? 'bg-blue-950 border border-blue-700 text-blue-300'
                  : verdict.winner === 'my' ? 'bg-yellow-950 border border-yellow-700 text-yellow-300'
                  : 'bg-[#21262d] border border-[#30363d] text-[#8b949e]'
                }`}>
                  {verdict.winner === 'auto' && '🤖 自動策略較佳'}
                  {verdict.winner === 'my'   && '👤 我的交易較佳'}
                  {verdict.winner === 'tie'  && '🤝 兩策略相當'}
                </div>
                {verdict.winner !== 'tie' && (
                  <div className="text-xs text-[#8b949e] text-center">
                    領先差距：<span className={`whitespace-nowrap font-semibold ${pnlColor(Math.abs(verdict.diff))}`}>NT${Math.abs(verdict.diff).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Add trade form */}
        {hasData && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
            <div className="font-semibold mb-4">➕ 新增我的交易記錄</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Direction selector */}
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">交易方向</label>
                <div className="flex rounded-lg overflow-hidden border border-[#30363d]">
                  {(['多單', '空單'] as const).map(d => (
                    <button key={d} onClick={() => setFormDir(d)}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        formDir === d
                          ? d === '多單' ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'
                          : 'bg-[#0d1117] text-[#8b949e] hover:bg-[#21262d]'
                      }`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">進場日期</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff] [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">進場價格 {isUS ? '(USD)' : '(TWD)'}</label>
                <input type="number" step="0.01" placeholder={isUS ? '如 125.50' : '如 880'}
                  value={formPrice} onChange={e => setFormPrice(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">進場股數</label>
                <input type="number" placeholder={isUS ? '如 50' : '如 1000'}
                  value={formShares} onChange={e => setFormShares(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">進場成本 (TWD)</label>
                <div className="w-full bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2 text-sm text-[#8b949e]">{formCost}</div>
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">備註（選填）</label>
                <input type="text" placeholder="如 突破" value={formNotes} onChange={e => setFormNotes(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
                />
              </div>
            </div>
            <div className="mt-4">
              <button onClick={handleAddTrade} disabled={submitting || !formDate || !formPrice || !formShares}
                className="px-5 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {submitting ? '儲存中...' : '儲存記錄'}
              </button>
            </div>
          </div>
        )}

        {/* Saved trades */}
        {hasData && trades.length > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#21262d] text-sm font-semibold text-[#8b949e]">
              已儲存的交易記錄（{trades.length} 筆，持倉中 {openTrades.length} 筆）
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0d1117] text-[#8b949e] text-xs text-left">
                    <th className="px-4 py-2">方向</th>
                    <th className="px-4 py-2">進場日期</th>
                    <th className="px-4 py-2 text-right">進場價</th>
                    <th className="px-4 py-2 text-right">股數</th>
                    <th className="px-4 py-2">出場日期</th>
                    <th className="px-4 py-2 text-right">出場價</th>
                    <th className="px-4 py-2 text-right">損益</th>
                    <th className="px-4 py-2">狀態</th>
                    <th className="px-4 py-2">備註</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const lastClose = data!.rows[data!.rows.length - 1].close
                    const isClosed  = !!t.exit_date
                    const pnl       = isClosed
                      ? calcRealized(t, isUS, data!.usd_twd) ?? 0
                      : calcUnrealized(t, lastClose, isUS, data!.usd_twd) ?? 0

                    return (
                      <>
                        <tr key={t.id} className="border-b border-[#21262d] hover:bg-[#1c2128]">
                          <td className={`px-4 py-3 font-semibold ${dirColor(t.direction)}`}>{t.direction}</td>
                          <td className="px-4 py-3 font-mono text-[#8b949e]">{t.entry_date ?? '—'}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtPrice(t.entry_price, isUS)}</td>
                          <td className="px-4 py-3 text-right">{t.shares?.toLocaleString() ?? '—'}</td>
                          <td className="px-4 py-3 font-mono text-[#8b949e]">{t.exit_date ?? <span className="text-yellow-600">持倉中</span>}</td>
                          <td className="px-4 py-3 text-right font-mono">{t.exit_price ? fmtPrice(t.exit_price, isUS) : '—'}</td>
                          <td className={`px-4 py-3 text-right font-mono whitespace-nowrap ${pnlColor(pnl)}`}>
                            {fmtPnl(pnl)}{!isClosed && <span className="text-[10px] text-[#8b949e] ml-1">浮</span>}
                          </td>
                          <td className="px-4 py-3">
                            {isClosed
                              ? <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e]">已出場</span>
                              : <span className="text-xs px-2 py-0.5 rounded bg-yellow-950 text-yellow-400 border border-yellow-800">持倉中</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-[#8b949e] text-xs">{t.notes || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              {!isClosed && (
                                <button onClick={() => setExitingId(exitingId === t.id ? null : t.id)}
                                  className={`text-xs px-2 py-1 border rounded transition-colors ${
                                    exitingId === t.id
                                      ? 'border-[#8b949e] text-[#8b949e] bg-[#21262d]'
                                      : 'border-blue-700 text-blue-400 hover:bg-blue-950'
                                  }`}>
                                  {exitingId === t.id ? '取消' : '出場'}
                                </button>
                              )}
                              <button onClick={() => handleDelete(t.id)}
                                className="text-xs px-2 py-1 border border-red-800 text-red-400 rounded hover:bg-red-950 transition-colors">
                                刪除
                              </button>
                            </div>
                          </td>
                        </tr>
                        {exitingId === t.id && (
                          <ExitForm
                            trade={t} isUS={isUS}
                            defaultDate={new Date().toISOString().split('T')[0]}
                            defaultPrice={data!.rows[data!.rows.length - 1].close}
                            onSave={(d, p) => handleExit(t.id, d, p)}
                            onCancel={() => setExitingId(null)}
                          />
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasData && !loading && !error && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-12 text-center">
            <div className="text-4xl mb-4">📈</div>
            <div className="text-[#8b949e] text-sm">請輸入股票代碼並按「查詢」開始分析</div>
            <div className="text-[#8b949e] text-xs mt-2">台股範例：2330、0050、6415　｜　美股範例：NVDA、TSLA、AAPL</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-[#8b949e]">載入中...</div>}>
      <SimulatePage />
    </Suspense>
  )
}
