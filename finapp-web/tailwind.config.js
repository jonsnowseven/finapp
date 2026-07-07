/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand gold (Midnight Gold system). 500 = bright institutional gold.
        gold: {
          400: '#ffe16d', // highlights / hover text
          500: '#ffd700', // brand + primary CTA
          600: '#e9c400', // charts / dim brand
          700: '#b99e00', // pressed
        },
        // Semantic dark surfaces (tonal layering, not shadows).
        void: '#0a0a0a',          // app / sidebar background
        surface: '#171717',       // cards & containers (lifted off void)
        'surface-2': '#0f0f0f',   // inputs (recessed, darker than card)
        'surface-3': '#242424',   // hover / elevated
        line: '#282828',          // neutral 1px borders
        'line-2': '#393939',      // stronger / active border
        ink: '#e6e3e1',           // primary text
        'ink-muted': '#9a9488',   // secondary / warm-gray text
        'ink-faint': '#6f6a60',   // tertiary / placeholder
        // Functional
        gain: '#3ce36a',          // inflow / positive
        loss: '#ff6b6b',          // outflow / negative
        info: '#5cb8ff',          // neutral accent (blue)
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      letterSpacing: {
        caps: '0.08em',
      },
    },
  },
  plugins: [],
}
