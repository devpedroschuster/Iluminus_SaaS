/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        iluminus: {
          terracota: '#D98E73',
          verde: '#8A9A5B',
          fundo: '#FDF8F5',
          texto: '#2D2D2D'
        }
      }
    },
  },
  plugins: [],
}