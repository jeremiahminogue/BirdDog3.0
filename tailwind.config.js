/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./client/src/**/*.{svelte,js,ts}"],
  theme: { extend: {} },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        birddog: {
          "primary": "#1d5191",
          "primary-content": "#ffffff",
          "secondary": "#0066FF",
          "secondary-content": "#ffffff",
          "accent": "#FF6B00",
          "accent-content": "#ffffff",
          "neutral": "#1d1d1f",
          "neutral-content": "#f5f5f7",
          "base-100": "#ffffff",
          "base-200": "#f5f5f7",
          "base-300": "#e8e8ed",
          "base-content": "#1d1d1f",
          "info": "#0071e3",
          "success": "#30d158",
          "warning": "#ff9f0a",
          "error": "#ff3b30",
        },
      },
    ],
  },
};
