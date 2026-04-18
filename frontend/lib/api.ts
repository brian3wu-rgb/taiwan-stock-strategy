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

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', cache: 'no-store' })
  if (!res.ok) throw new Error(`API POST ${path} → ${res.status}`)
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
