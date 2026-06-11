/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // support class-based dark mode
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0b0d',
          secondary: '#121318',
          tertiary: '#1a1b23',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          focus: 'rgba(81, 150, 255, 0.4)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        premium: '0 10px 30px -10px rgba(0, 0, 0, 0.7)',
      }
    },
  },
  plugins: [],
}
