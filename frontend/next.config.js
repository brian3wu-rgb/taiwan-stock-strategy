/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 模式：Docker 部署用；Vercel 會自動忽略此設定
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
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
