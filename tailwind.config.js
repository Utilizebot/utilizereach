/** @type {import('tailwindcss').Config} */

// Brand colour scales come from CSS variables (src/index.css :root) so each
// brand can be themed at runtime (src/lib/config.ts applyBrandTheme). The
// variables' DEFAULT values are exactly the stock palette, so the app renders
// identically for a brand without a custom colour:
//   --brand-*       = Tailwind blue   (brand role: primary actions, links,
//                     active states, focus rings)
//   --brand-deep-*  = Tailwind indigo (paired accent in two-tone gradients,
//                     e.g. from-blue-600 to-indigo-600)
//   --brand-primary / --brand-accent (+ -dark / -light) = primary / accent
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (prefix) => Object.fromEntries(SHADES.map((s) => [s, v(`${prefix}-${s}`)]));

const brand = scale('brand');
const brandDeep = scale('brand-deep');

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        // Brand role (runtime-themeable)
        brand,
        'brand-deep': brandDeep,
        blue: brand,
        indigo: brandDeep,
        primary: {
          DEFAULT: v('brand-primary'),     // #0066CC
          dark: v('brand-primary-dark'),   // #0052A3
          light: v('brand-primary-light'), // #3385D6
        },
        secondary: {
          DEFAULT: '#2C3E50',
          light: '#34495E',
        },
        accent: {
          DEFAULT: v('brand-accent'),      // #00A8FF
          light: v('brand-accent-light'),  // #33BAFF
        },
      },
      // Tailwind cannot parse a CSS-variable colour for its default ring
      // colour (it would silently fall back to #93c5fd), so reproduce the
      // stock default: blue-500 at the ring opacity.
      ringColor: {
        DEFAULT: ({ opacityValue }) =>
          opacityValue === undefined
            ? 'rgb(var(--brand-500))'
            : `rgb(var(--brand-500) / ${opacityValue})`,
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
}
