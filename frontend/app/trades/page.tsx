'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getAllTrades, deleteMyTrade, getTWStockList, Trade } from '@/lib/api'

// 美股名稱（從 scanner US_STOCKS 對應，前端直接 hardcode 避免額外 API）
const US_NAMES: Record<string, string> = {
  AAPL:'Apple', MSFT:'Microsoft', NVDA:'NVIDIA', AMZN:'Amazon', META:'Meta',
  GOOG:'Alphabet', TSLA:'Tesla', AVGO:'Broadcom', COST:'Costco',
  AMD:'AMD', QCOM:'Qualcomm', TXN:'Texas Instruments', MU:'Micron',
  AMAT:'Applied Materials', LRCX:'Lam Research', KLAC:'KLA Corp',
  ADI:'Analog Devices', MCHP:'Microchip', ON:'ON Semiconductor',
  MPWR:'Monolithic Power', MRVL:'Marvell', INTC:'Intel',
  ASML:'ASML', ARM:'Arm Holdings', NXPI:'NXP Semi', GFS:'GlobalFoundries',
  SWKS:'Skyworks', QRVO:'Qorvo', ENTG:'Entegris', TSM:'TSMC ADR',
  STM:'STMicro', CRUS:'Cirrus Logic', ACLS:'Axcelis', COHU:'Cohu',
  MKSI:'MKS Instruments', POWI:'Power Integrations',
  ADBE:'Adobe', CSCO:'Cisco', SNPS:'Synopsys', CDNS:'Cadence',
  PANW:'Palo Alto', FTNT:'Fortinet', CRWD:'CrowdStrike',
  TEAM:'Atlassian', WDAY:'Workday', ZS:'Zscaler',
  NFLX:'Netflix', MELI:'MercadoLibre', PDD:'PDD Holdings',
  ABNB:'Airbnb', EBAY:'eBay', PYPL:'PayPal', ORLY:"O'Reilly",
  ROST:'Ross Stores', DLTR:'Dollar Tree', MNST:'Monster Bev',
  SBUX:'Starbucks', LULU:'Lululemon',
  AMGN:'Amgen', BKNG:'Booking', ISRG:'Intuitive Surgical',
  REGN:'Regeneron', BIIB:'Biogen', ILMN:'Illumina', MRNA:'Moderna',
  DXCM:'DexCom', IDXX:'IDEXX', GEHC:'GE HealthCare', ALGN:'Align Tech',
  PCAR:'PACCAR', PAYX:'Paychex', FAST:'Fastenal', ODFL:'Old Dominion',
  VRSK:'Verisk', CTSH:'Cognizant', ANSS:'ANSYS', MDLZ:'Mondelez',
  KDP:'Keurig Dr Pepper', EXC:'Exelon', XEL:'Xcel Energy',
  CEG:'Constellation Energy', ENPH:'Enphase', EA:'Electronic Arts',
  TTWO:'Take-Two',
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function pnlColor(v: number) {
  if (v > 0) return 'text-red-400 font-semibold'
  if (v < 0) return 'text-green-400 font-semibold'
  return 'text-gray-500'
}

function fmtPnl(v: number) {
  if (v === 0) return '—'
  return `${v > 0 ? '+' : '-'}NT$${Math.abs(v).toLocaleString()}`
}

function calcRealized(t: Trade): number {
  if (!t.exit_price || !t.entry_price || !t.shares) return 0
  const raw = t.direction === '多單'
    ? (t.exit_price - t.entry_price) * t.shares
    : (t.entry_price - t.exit_price) * t.shares
  return Math.round(raw)
}

// ─────────────────────────────────────────────
//  統計卡片
// ─────────────────────────────────────────────

function StatCard({ label, value, color, sub }: {
  label: string; value: number | string; color: string; sub?: string
}) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
      <div className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-[#8b949e] mt-1">{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────
//  主頁面
// ─────────────────────────────────────────────

type FilterType = 'ALL' | 'OPEN' | 'CLOSED'

export default function TradesPage() {
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [filter,  setFilter]  = useState<FilterType>('ALL')
  const [nameMap, setNameMap] = useState<Record<string, string>>(US_NAMES)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      setTrades(await getAllTrades())
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // 台股名稱查詢（有 TW 交易才載）
  useEffect(() => {
    if (trades.some(t => t.market === 'TW')) {
      getTWStockList().then(list => {
        setNameMap(prev => {
          const next = { ...prev }
          list.forEach(s => { next[s.symbol] = s.name })
          return next
        })
      }).catch(() => {})
    }
  }, [trades])

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此筆交易記錄？')) return
    await deleteMyTrade(id)
    setTrades(prev => prev.filter(t => t.id !== id))
  }

  // ── 統計 ──────────────────────────────────
  const closed = trades.filter(t => !!t.exit_date)
  const open   = trades.filter(t => !t.exit_date)

  const totalRealized   = closed.reduce((sum, t) => sum + calcRealized(t), 0)
  const wins            = closed.filter(t => calcRealized(t) > 0).length
  const losses          = closed.filter(t => calcRealized(t) < 0).length
  const winRate         = closed.length > 0 ? Math.round(wins / closed.length * 100) : null

  const filtered = filter === 'ALL' ? trades : filter === 'OPEN' ? open : closed

  // ── 過濾按鈕 ────────────────────────────────
  const filters: [FilterType, string, string][] = [
    ['ALL',    `全部 (${trades.length})`,  'bg-blue-600 text-white'],
    ['OPEN',   `持倉中 (${open.length})`,  'bg-yellow-600 text-white'],
    ['CLOSED', `已出場 (${closed.length})`, 'bg-[#30363d] text-white'],
  ]

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">

      {/* ── Header ── */}
      <header className="bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[#58a6ff] text-sm hover:underline">← 台股選股</Link>
            <Link href="/scan-us" className="text-[#8b949e] text-sm hover:text-white transition-colors">🇺🇸 美股選股</Link>
            <span className="text-sm font-semibold">📋 交易紀錄</span>
          </div>
          <button onClick={load}
            className="px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg transition-colors">
            重新整理
          </button>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">

        {/* ── 統計卡 ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="全部交易" value={trades.length}  color="text-white" />
          <StatCard label="持倉中"   value={open.length}    color="text-yellow-400" />
          <StatCard label="已實現損益"
            value={totalRealized !== 0 ? fmtPnl(totalRealized) : '—'}
            color={totalRealized > 0 ? 'text-red-400' : totalRealized < 0 ? 'text-green-400' : 'text-[#8b949e]'}
          />
          <StatCard label="勝率"
            value={winRate !== null ? `${winRate}%` : '—'}
            color="text-[#e3b341]"
            sub={closed.length > 0 ? `${wins} 勝 / ${losses} 敗` : undefined}
          />
        </div>

        {/* ── 篩選標籤 ── */}
        <div className="flex gap-2 flex-wrap">
          {filters.map(([f, label, activeClass]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === f ? activeClass : 'bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── 錯誤 ── */}
        {error && (
          <div className="bg-red-950/30 border border-red-800/50 text-red-400 rounded-xl p-4 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ── 載入中 ── */}
        {loading && (
          <div className="flex items-center justify-center py-24 text-[#8b949e] gap-3">
            <div className="w-5 h-5 border-2 border-[#30363d] border-t-blue-400 rounded-full animate-spin" />
            載入中...
          </div>
        )}

        {/* ── 空狀態 ── */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">📭</div>
            <div className="text-[#8b949e] text-sm">
              {trades.length === 0 ? '尚無交易記錄' : '此篩選條件沒有結果'}
            </div>
            {trades.length === 0 && (
              <Link href="/simulate"
                className="inline-block mt-4 px-4 py-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg text-sm text-[#58a6ff] transition-colors">
                前往策略選股建立記錄 →
              </Link>
            )}
          </div>
        )}

        {/* ── 交易紀錄表 ── */}
        {!loading && filtered.length > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#21262d] text-sm font-semibold text-[#8b949e]">
              共 {filtered.length} 筆記錄
              {filter === 'OPEN' && <span className="ml-2 text-yellow-500 text-xs">▸ 浮動損益請點「查看」進入個股策略頁</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="bg-[#0d1117] text-[#8b949e] text-xs text-left">
                    <th className="px-4 py-2.5 whitespace-nowrap">股票</th>
                    <th className="px-4 py-2.5">方向</th>
                    <th className="px-4 py-2.5">進場日期</th>
                    <th className="px-4 py-2.5 text-right">進場價</th>
                    <th className="px-4 py-2.5 text-right">股數</th>
                    <th className="px-4 py-2.5">出場日期</th>
                    <th className="px-4 py-2.5 text-right">出場價</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">損益</th>
                    <th className="px-4 py-2.5">狀態</th>
                    <th className="px-4 py-2.5">備註</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const isClosed = !!t.exit_date
                    const pnl      = isClosed ? calcRealized(t) : null
                    const simHref  = `/simulate?symbol=${t.symbol}&market=${t.market}`

                    return (
                      <tr key={t.id} className="border-b border-[#21262d] hover:bg-[#1c2128] transition-colors">

                        {/* 股票 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link href={simHref}
                              className="font-mono font-bold text-[#58a6ff] hover:underline">
                              {t.symbol}
                            </Link>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              t.market === 'US'
                                ? 'bg-blue-900/60 text-blue-300'
                                : 'bg-purple-900/60 text-purple-300'
                            }`}>
                              {t.market}
                            </span>
                          </div>
                          {nameMap[t.symbol] && (
                            <div className="text-[10px] text-[#8b949e] mt-0.5 pl-0.5">
                              {nameMap[t.symbol]}
                            </div>
                          )}
                        </td>

                        {/* 方向 */}
                        <td className={`px-4 py-3 font-semibold ${
                          t.direction === '多單' ? 'text-red-400' : 'text-green-400'
                        }`}>
                          {t.direction}
                        </td>

                        {/* 進場日期 */}
                        <td className="px-4 py-3 font-mono text-[#8b949e] text-xs whitespace-nowrap">
                          {t.entry_date ?? '—'}
                        </td>

                        {/* 進場價 */}
                        <td className="px-4 py-3 text-right font-mono">
                          {t.entry_price != null ? t.entry_price.toLocaleString() : '—'}
                        </td>

                        {/* 股數 */}
                        <td className="px-4 py-3 text-right">
                          {t.shares != null ? t.shares.toLocaleString() : '—'}
                        </td>

                        {/* 出場日期 */}
                        <td className="px-4 py-3 font-mono text-[#8b949e] text-xs whitespace-nowrap">
                          {t.exit_date ?? '—'}
                        </td>

                        {/* 出場價 */}
                        <td className="px-4 py-3 text-right font-mono">
                          {t.exit_price != null ? t.exit_price.toLocaleString() : '—'}
                        </td>

                        {/* 損益 */}
                        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                          {pnl !== null ? (
                            <span className={pnlColor(pnl)}>{fmtPnl(pnl)}</span>
                          ) : (
                            <Link href={simHref}
                              className="text-yellow-500 hover:text-yellow-300 text-xs whitespace-nowrap transition-colors">
                              查看浮動 →
                            </Link>
                          )}
                        </td>

                        {/* 狀態 */}
                        <td className="px-4 py-3">
                          {isClosed ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e]">已出場</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-yellow-950 text-yellow-400 border border-yellow-800">持倉中</span>
                          )}
                        </td>

                        {/* 備註 */}
                        <td className="px-4 py-3 text-[#8b949e] text-xs max-w-[100px] truncate">
                          {t.notes || '—'}
                        </td>

                        {/* 操作 */}
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <Link href={simHref}
                              className="text-xs px-2.5 py-1 border border-[#58a6ff]/40 text-[#58a6ff] rounded hover:bg-[#58a6ff]/10 transition-colors whitespace-nowrap">
                              查看
                            </Link>
                            <button onClick={() => handleDelete(t.id)}
                              className="text-xs px-2.5 py-1 border border-red-800/60 text-red-400 rounded hover:bg-red-950/40 transition-colors">
                              刪除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── 已出場合計列 ── */}
            {filter !== 'OPEN' && closed.length > 0 && (
              <div className="px-4 py-3 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between text-sm">
                <span className="text-[#8b949e]">
                  已出場 {closed.length} 筆合計
                  {winRate !== null && <span className="ml-3">勝率 <span className="text-[#e3b341] font-semibold">{winRate}%</span>（{wins}勝/{losses}敗）</span>}
                </span>
                <span className={`font-bold text-base whitespace-nowrap ${pnlColor(totalRealized)}`}>
                  {totalRealized !== 0 ? fmtPnl(totalRealized) : '—'}
                </span>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
