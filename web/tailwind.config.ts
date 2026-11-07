import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0B0C",
        surface: "#141416",
        raised: "#1C1C1F",
        line: "#26262A",
        text: "#EDEDEF",
        "text-2": "#9A9AA1",
        "text-3": "#5E5E66",
        signal: "#FF5A1F",
        ok: "#3DD68C",
        warn: "#F5B544",
        err: "#F2555A",
        clay: "#D9D6CF",
      },
      fontFamily: {
        sans: ["var(--font-inter-tight)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        serif: ["var(--font-instrument-serif)", "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        label: ["11px", { lineHeight: "14px", letterSpacing: "0.06em" }],
        s: ["13px", { lineHeight: "18px" }],
        m: ["15px", { lineHeight: "22px" }],
        l: ["20px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
        xl: ["32px", { lineHeight: "38px", letterSpacing: "-0.01em" }],
        hero: ["40px", { lineHeight: "46px", letterSpacing: "-0.01em" }],
      },
      fontWeight: { book: "450", medium: "550" },
      borderRadius: { chip: "6px", btn: "10px", panel: "14px", prompt: "22px" },
      boxShadow: { float: "0 8px 32px rgb(0 0 0 / 0.4)" },
      transitionTimingFunction: { out: "cubic-bezier(.22,1,.36,1)", io: "cubic-bezier(.65,0,.35,1)" },
    },
  },
  plugins: [],
};
export default config;
