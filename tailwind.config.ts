import type { Config } from 'tailwindcss';

/**
 * FlowCare design tokens.
 *
 * `brand` is derived from the product logo (#3DBBB9). The ramp is tuned so
 * that 600 and above clear WCAG AA against white for text, while 500 is the
 * fill colour used behind white text on large controls.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effbfa', 100: '#d7f4f2', 200: '#b3e9e6', 300: '#80d8d5',
          400: '#4ec4c2', 500: '#3dbbb9', 600: '#1f9997', 700: '#1a7a79',
          800: '#196261', 900: '#195152', 950: '#082f30',
        },
        ink: {
          50: '#f7f8fa', 100: '#eef0f4', 200: '#dde1e9', 300: '#c3cad7',
          400: '#94a0b5', 500: '#6c7a93', 600: '#546178', 700: '#434e61',
          800: '#333c4b', 900: '#1f2733', 950: '#121821',
        },
        // Semantic accents, used sparingly and always with a text label too,
        // never colour alone (see docs/security.md on accessibility).
        success: {
          50: '#ecfdf5', 100: '#d1fae5', 500: '#10b981', 600: '#059669', 700: '#047857', 900: '#064e3b',
        },
        warn: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 900: '#78350f',
        },
        danger: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 900: '#7f1d1d',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        raised: '0 4px 6px -1px rgba(16,24,40,.07), 0 2px 4px -2px rgba(16,24,40,.05)',
        pop: '0 12px 24px -8px rgba(16,24,40,.14), 0 4px 10px -4px rgba(16,24,40,.08)',
        brand: '0 6px 16px -6px rgba(61,187,185,.55)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'soft-pulse': {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '.62', transform: 'scale(.955)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .32s cubic-bezier(.22,1,.36,1) both',
        'fade-in': 'fade-in .24s ease-out both',
        'scale-in': 'scale-in .18s cubic-bezier(.22,1,.36,1) both',
        'slide-up': 'slide-up .26s cubic-bezier(.22,1,.36,1) both',
        'soft-pulse': 'soft-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
