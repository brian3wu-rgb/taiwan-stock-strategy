import ChartView from '@/components/ChartView'

interface Props {
  params:      { symbol: string }
  searchParams: { signal?: string; date?: string }
}

/**
 * 圖表頁（Server Component）
 * 從 URL params 取得 symbol、訊號類型、訊號日期後，
 * 傳給 Client Component ChartView 做初始化。
 */
export default function ChartPage({ params, searchParams }: Props) {
  const symbol     = decodeURIComponent(params.symbol)
  const signal     = searchParams.signal  // "LONG" | "SHORT" | undefined
  const signalDate = searchParams.date    // "YYYY-MM-DD" | undefined

  return (
    <ChartView
      symbol={symbol}
      signal={signal as 'LONG' | 'SHORT' | undefined}
      signalDate={signalDate}
    />
  )
}
