/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep midnight-navy chrome (sidebar, header)
        navy: {
          950: '#060B18',
          900: '#0A1224',
          800: '#0F1A33',
          700: '#16254A',
          600: '#22345E',
          500: '#33497A',
          300: '#8FA0C4',
          200: '#B7C3DC',
          100: '#DCE3F0',
        },
        // Warm analytical canvas
        canvas: { DEFAULT: '#F4F2EC', raised: '#FBFAF6', sunken: '#ECE9E0' },
        line: { DEFAULT: '#DFDBCF', strong: '#C9C4B5' },
        // Graphite typography (all pass WCAG AA on canvas/raised)
        ink: { 900: '#161A24', 800: '#232937', 700: '#363D4E', 600: '#4A5265', 500: '#5B6376' },
        // Electric cyan + renewable teal accents (700-level for text on light backgrounds)
        cyan: { 300: '#67E8F9', 400: '#22D3EE', 500: '#06B6D4', 600: '#0891B2', 700: '#0E7490' },
        teal: { 400: '#2DD4BF', 500: '#14B8A6', 600: '#0D9488', 700: '#0F766E', 800: '#115E59' },
        // Reserved for adverse errors and data warnings only
        warn: { 50: '#FDF4DC', 100: '#FBE8B4', 600: '#B45309', 700: '#92400E' },
        bad: { 50: '#FDECEC', 100: '#F9D3D3', 600: '#B91C1C', 700: '#991B1B' },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px' },
      boxShadow: {
        panel: '0 1px 0 rgba(22,26,36,0.04)',
        pop: '0 8px 24px -8px rgba(6,11,24,0.35), 0 0 0 1px rgba(6,11,24,0.08)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in': {
          from: { transform: 'translateX(16px)', opacity: '0' },
          to: { transform: 'none', opacity: '1' },
        },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out both',
        'slide-in': 'slide-in 180ms ease-out both',
        pulse2: 'pulse2 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
