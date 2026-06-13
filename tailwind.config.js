/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Aptos", "SF Pro Text", "Segoe UI", "sans-serif"],
        display: ["Aptos Display", "Aptos", "SF Pro Display", "sans-serif"]
      },
      boxShadow: {
        field: "0 20px 60px rgba(15, 23, 42, 0.18)"
      }
    }
  },
  plugins: []
}
