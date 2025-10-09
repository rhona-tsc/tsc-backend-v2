/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],

  extend: {
    animation: {
      'ping-once': 'ping 0.5s linear 1',
    },
  }
}

