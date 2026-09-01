/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./*.html",
    "./src/**/*.{html,js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        black: '#000000',
        bg: '#08080c',
        s1: '#0e0e14',
        s2: '#14141e',
        s3: '#1a1a28',
        s4: '#22223a',

        border: 'rgba(255,255,255,0.06)',
        border2: 'rgba(255,255,255,0.12)',
        border3: 'rgba(255,255,255,0.20)',

        violet: { DEFAULT: '#8b5cf6', bright: '#a78bfa' },
        cyan: { DEFAULT: '#06b6d4', bright: '#22d3ee' },

        white: '#f0f0f5',
        text: '#c8c8d4',
        muted: '#6b6b80',
        dim: '#3a3a50',

        danger: '#f87171',
        success: '#4ade80',
        warn: '#fbbf24',
      },
      // sp-1..sp-16 (4/8/12/16/20/24/32/40/48/64px) already line up 1:1 with
      // Tailwind's default spacing scale (1,2,3,4,5,6,8,10,12,16) — no
      // override needed there. Radii don't line up, so they're extended:
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
        mono: ['DejaVu Sans Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
