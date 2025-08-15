/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: { brand: { start: "#FF7AC6", mid: "#FFB86B", end: "#F9F871" } },
      boxShadow: { glow: "0 0 24px rgba(255, 184, 107, 0.35)", glowPink: "0 0 28px rgba(255,122,198,0.35)" }
    }
  },
  plugins: []
}
