/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', 
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // A custom premium gold palette
        gold: {
          400: '#FDE047', // Bright gold for text/highlights
          500: '#D4AF37', // Classic metallic gold for borders/branding
          600: '#AA8C2C', // Deeper gold for hover states
        }
      }
    },
  },
  plugins: [],
}
