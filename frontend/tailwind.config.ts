import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1a1a2e',
        muted: '#6B7280',
        panel: 'transparent',
        brand: {
          50: '#E3F2FD',
          100: '#BBDEFB',
          300: '#64B5F6',
          500: '#2196F3',
          600: '#1E88E5',
          700: '#0D47A1',
        },
        alert: {
          50: '#FFEBEE',
          200: '#EF9A9A',
          500: '#F44336',
          600: '#D32F2F',
        },
        orange: '#FF8533',
        ok: {
          50: '#E8F5E9',
          200: '#A5D6A7',
          500: '#4CAF50',
          600: '#388E3C',
        },
      },
      boxShadow: {
        kiosk: '0 8px 32px rgba(33, 150, 243, 0.18)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      fontFamily: {
        display: ['"Inter"', '"Segoe UI"', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
      },
    },
  },
  plugins: [],
  safelist: ['text-orange'],
};

export default config;
