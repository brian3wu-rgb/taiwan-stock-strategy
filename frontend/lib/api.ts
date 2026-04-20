/**
 * api.ts — 後端 API 呼叫封裝
 * 所有 fetch 統一從這裡發出，方便切換 BASE_URL。
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ─────────────────────────────────────────────
//  型別定義
// ─────────────────────────────────────────────

export interface ScanResult {
  symbol:          string
  name:            string
  signal:          'LONG' | 'SHORT'
  price:           number
  ma5:             number | null
  ma100:           number | null
  cross_proximity: number | null   // 越小 = 越接近交叉點
  volume_ratio:    number | null   // 今日量 / 20日均量
  scan_date:       string
}

export interface ScanResponse {
  results:   ScanResult[]
  scan_date: string | null
  total:     number
}

export interface ScanStatus {
  running:  boolean
  last_run: string | null
  progress: string
}

export interface CandlePoint {
  time:  string
  open:  number
  high:  number
  low:   number
  close: number
  ma5:   number | null
  ma60:  number | null
  ma100: number | null
}

export interface ChartData {
  symbol:  string
  candles: CandlePoint[]
}

// ─────────────────────────────────────────────
//  API 函式
// ─────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API POST ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', cache: 'no-store' })
  if (!res.ok) throw new Error(`API DELETE ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

/** 取得最新掃描結果 */
export const getScanResults  = (signal?: string) =>
  get<ScanResponse>(`/scan${signal ? `?signal=${signal}` : ''}`)

/** 觸發背景掃描 */
export const triggerScan     = () => post<{ message: string }>('/scan/trigger')

/** 查詢掃描進度 */
export const getScanStatus   = () => get<ScanStatus>('/scan/status')

/** 取得圖表資料 */
export const getChartData    = (symbol: string) =>
  get<ChartData>(`/chart/${encodeURIComponent(symbol)}`)

// ─────────────────────────────────────────────
//  模擬交易型別 & API
// ─────────────────────────────────────────────

export interface SimRow {
  date:         string
  open:         number
  high:         number
  low:          number
  close:        number
  ma5:          number | null
  ma20:         number | null
  ma60:         number | null
  ma100:        number | null
  k:            number | null
  k_state:      string
  trend:        string
  ppp:          string
  sig:          string
  auto_hold:    string    // '多單' | '空單' | '空手'
  auto_entry:   number
  auto_pnl_twd: number
  cross_sig:    string | null  // 'LONG' | 'SHORT' | null（近3日MA100穿越訊號）
}

export interface SimData {
  symbol:         string
  symbol_full:    string
  market:         string   // 'TW' | 'US'
  usd_twd:        number
  default_shares: number
  rows:           SimRow[]
}

export interface Trade {
  id:          number
  symbol:      string
  market:      string
  direction:   string        // '多單' | '空單'
  entry_date:  string | null
  entry_price: number | null
  shares:      number | null
  cost:        number | null
  exit_date:   string | null
  exit_price:  number | null
  notes:       string | null
  created_at:  string
}

export interface TradeIn {
  direction:   string
  entry_date:  string
  entry_price: number
  shares:      number
  cost:        number
  notes?:      string
}

export interface ExitIn {
  exit_date:  string
  exit_price: number
}

/** 取得模擬交易資料（start_date / end_date 不傳則預設最近 30 個交易日） */
export const getSimulationData = (
  symbol: string, market: string,
  startDate?: string, endDate?: string,
) => {
  const params = new URLSearchParams({ market })
  if (startDate) params.set('start_date', startDate)
  if (endDate)   params.set('end_date',   endDate)
  return get<SimData>(`/simulate/${encodeURIComponent(symbol)}?${params}`)
}

/** 取得已儲存的交易記錄 */
export const getMyTrades = (symbol: string, market: string) =>
  get<Trade[]>(`/simulate/${encodeURIComponent(symbol)}/trades?market=${market}`)

/** 新增交易記錄 */
export const addMyTrade = (symbol: string, market: string, body: TradeIn) =>
  post<{ id: number }>(
    `/simulate/${encodeURIComponent(symbol)}/trades?market=${market}`,
    body,
  )

/** 記錄出場 */
export const recordExit = (id: number, body: ExitIn) =>
  post<{ updated: boolean }>(`/simulate/trades/${id}/exit`, body)

/** 刪除交易記錄 */
export const deleteMyTrade = (id: number) =>
  del<{ deleted: boolean }>(`/simulate/trades/${id}`)
