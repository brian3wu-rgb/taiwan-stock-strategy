import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // 深色主題調色盤
        surface: {
          DEFAULT: '#0d1117',
          card:    '#161b22',
          hover:   '#1c2128',
        },
        border: {
          DEFAULT: '#30363d',
          subtle:  '#21262d',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
