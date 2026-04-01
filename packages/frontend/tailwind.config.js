/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        spotify: {
          green: "#1DB954",
          dark: "#121212",
          gray: "#181818",
          light: "#282828",
          text: "#B3B3B3",
        },
      },
      fontFamily: {
        display: ['"Poppins"', "sans-serif"],
        body: ['"Inter"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
