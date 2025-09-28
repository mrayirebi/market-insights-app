import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e14',
        panel: 'rgba(23, 27, 41, 0.6)',
        positive: '#22c55e',
        negative: '#ef4444',
        info: '#60a5fa',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glass: '0 10px 30px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
} satisfies Config
