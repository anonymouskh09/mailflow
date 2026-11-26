/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        ground: '#F7F7F8',
        line: '#E4E4E7',
        soft: '#F0F0F2',
        ink: '#18181B',
        muted: '#52525B',
        subtle: '#71717A',
        accent: { DEFAULT: '#4F46E5', dark: '#3730A3', soft: '#EEF2FF', ring: '#C7D2FE' },
      },
      borderRadius: { card: '12px' },
    },
  },
  plugins: [],
};
