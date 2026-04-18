import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '台股策略選股系統',
  description: '均線交叉 + K線反轉 + 量能過濾，自動掃描台股訊號',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-[#0d1117] text-[#e6edf3] antialiased">
        {children}
      </body>
    </html>
  )
}
