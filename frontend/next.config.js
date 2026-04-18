/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 部署需要 standalone 模式
  output: 'standalone',
  // API 反向代理（開發時避免 CORS 問題）
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
