/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Flowtech brand — controlled red used for primary actions, active
        // states and focus accents. Maps the pervasive `brand` token from the
        // former indigo ramp onto Flowtech's crimson.
        brand: {
          50: '#FDEDEE', 100: '#FAD8DA', 200: '#F3C4C6', 300: '#E79A9D',
          400: '#D9686C', 500: '#CE3438', 600: '#C52E33', 700: '#AA252A',
          800: '#8A1E22', 900: '#6E1A1D', 950: '#40100F',
        },
        // Neutral surfaces — warm charcoal/greys tuned to the Flowtech palette
        // (App Background #F7F7F5, Surface #FFFFFF, Border #E5E5E2, text #202020).
        surface: {
          0: '#ffffff', 50: '#f7f7f5', 100: '#f0f0ee', 200: '#e5e5e2',
          300: '#d4d4d0', 400: '#a3a3a0', 500: '#7a7a7a', 600: '#555555',
          700: '#3a3a3a', 800: '#202020', 900: '#151515',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Manrope', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.05)',
        drawer: '-8px 0 24px -4px rgb(0 0 0 / 0.12)',
        pop: '0 10px 30px -6px rgb(0 0 0 / 0.15)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-in-right': { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        'slide-up': { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-in-right': 'slide-in-right 0.25s cubic-bezier(0.16,1,0.3,1)',
        'slide-up': 'slide-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
