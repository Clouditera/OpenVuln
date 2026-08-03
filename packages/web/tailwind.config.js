/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── 深色视觉语言（对齐协作者着陆页，task-5ee34751 fish 定稿）──
        surface: {
          DEFAULT: "#000000",   // 页面底（openvuln-home bg-black）
          raised: "#111216",    // 卡片（composer bg）
          sunken: "#15161b",    // 井/hover（focus-within bg）
          header: "#030303",    // 顶栏（pill bg）
        },
        line: "#26272c",        // 分隔线/边框（#26272c ~ #2f3037）
        ink: {
          DEFAULT: "#f0f2f6",   // 主文字
          secondary: "#acacb0", // 次文字
          tertiary: "#696a70",  // 辅助/placeholder
        },
        // 交互蓝：深色底链接/聚焦/进行中（Clouditera 规范深底 accent）
        accent: {
          50: "rgba(40, 209, 255, 0.10)",
          100: "rgba(40, 209, 255, 0.16)",
          200: "rgba(40, 209, 255, 0.28)",
          600: "#28D1FF",  // 深底主色（原 accent-dark）
          700: "#5CDDFF",  // hover 亮一档
          800: "#8AE6FF",
        },
        // 功能色深底版：亮 ink + 半透明 bg，bar 用亮色
        sev: {
          critical: { ink: "#FF6B6B", bg: "rgba(242, 79, 79, 0.16)", bar: "#F24F4F" },
          high:     { ink: "#F24F4F", bg: "rgba(242, 79, 79, 0.12)", bar: "#F24F4F" },
          medium:   { ink: "#FF8A5C", bg: "rgba(255, 115, 60, 0.13)", bar: "#FF733C" },
          low:      { ink: "#F7C530", bg: "rgba(247, 197, 48, 0.12)", bar: "#F7C530" },
          // info：VH 兜底档，公众 UI 不展示，仅防御保留
          info:     { ink: "#acacb0", bg: "rgba(172, 172, 176, 0.10)", bar: "#696a70" },
        },
        ai: { DEFAULT: "#9285FF", bg: "rgba(146, 133, 255, 0.13)", ink: "#A79DFF" }, // AI 紫（深底）
        success: { DEFAULT: "#3AD186", bg: "rgba(58, 209, 134, 0.12)", ink: "#3AD186" },
        danger: "#F24F4F",
        warning: "#FF733C",
        running: { DEFAULT: "#28D1FF", bg: "rgba(40, 209, 255, 0.12)", ink: "#28D1FF" },
      },
      fontFamily: {
        // 协作者体系：系统字栈（着陆页 openvuln-home 同族）
        display: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', '"Noto Sans"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', '"Noto Sans"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      maxWidth: {
        "6xl": "72rem",
      },
    },
  },
  plugins: [],
};
