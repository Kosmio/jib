/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  safelist: [
    "bg-secondary",
    "bg-white",
    "bg-primary",
    "after:bg-secondary",
    "after:bg-primary",
    "hover:text-primary",
    "text-white",
    "shadow-gray-light",
  ],
  theme: {
    extend: {
      fontSize: {
        h1: "5rem",
        h2: "3.157rem",
        h3: "2.369rem",
      },
      padding: {
        75: "75px",
      },
      margin: {
        75: "75px",
      },
      lineHeight: {
        h2: "4rem",
      },
      container: {
        center: true,
      },
      screens: {
        sm: "480px",
        md: "768px",
        lg: "976px",
        mlg: "1125px",
        xl: "1275px",
        '2xl': "1440px"
      },
      colors: {
        primary: "#404F9D",
        secondary: "#ED751D",
        "gray-light": "#F7F8FA",
      },
      fontFamily: {
        sans: ["Poppins", "sans-serif"],
      },
      boxShadow: {
        cta: "-8px 8px 0px",
      },
      keyframes: {
        slideup: {
          "0%": { opacity: 0, transform: "translateY(250px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        slideup: "slideup 1s ease 0s 1 normal forwards",
      },
    },
  },
  plugins: [],
};
