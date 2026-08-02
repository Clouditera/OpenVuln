/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Clouditera 设计规范（fish 提供 .bossmode-attachments 设计规范-颜色与字体.md）
        surface: {
          DEFAULT: "#FFFFFF",   // N1 大可视区
          raised: "#FFFFFF",    // N1 列表 BG
          sunken: "#F8F8F8",    // N3 可视区 2
          header: "#F8FAFE",    // N2 标题 BG
        },
        line: "#E7E8EB",        // N5 分割线
        ink: {
          DEFAULT: "#0A1730",   // B7 文字主色
          secondary: "#616D7E", // N9 文字/次
          tertiary: "#BBC3CC",  // N7 文字辅助
        },
        accent: {
          50: "#EEF7FF",   // B1
          100: "#D4E8FF",  // B2 hover/底色
          200: "#A9D1FF",  // B3 边框
          600: "#298CFF",  // B4 主色
          700: "#1871F5",  // B5 按钮 hover
          800: "#145BE1",  // B6 点击
        },
        // 功能色（规范）：严重/高危/中危/低危 + 中性 info
        sev: {
          critical: { ink: "#8F1D1D", bg: "#F9E9E9", bar: "#C22828" },
          high:     { ink: "#C22828", bg: "#FEEDED", bar: "#F24F4F" },
          medium:   { ink: "#C24E0E", bg: "#FFF1EB", bar: "#FF733C" },
          low:      { ink: "#8A6D0B", bg: "#FEF9EA", bar: "#F7C530" },
          // info：VH 兜底档，公众 UI 不展示，仅防御保留
          info:     { ink: "#616D7E", bg: "#F8F9FA", bar: "#BBC3CC" },
        },
        // Pulse 深色页（/pulse）：规范 N10 导航深蓝
        pulse: {
          bg: "#1B2033", panel: "#252C46", line: "#364061",
          ink: "#FFFFFF", secondary: "#BBC3CC",
        },
        "sev-dark": { high: "#F24F4F", medium: "#FF733C", low: "#F7C530", info: "#BBC3CC" },
        "accent-dark": "#28D1FF", // 规范「进行中」蓝，深底链接/箭头
        ai: { DEFAULT: "#9285FF", bg: "#F4F2FF", ink: "#5B4BD6" }, // 规范「特殊」紫，AI 专用
        success: { DEFAULT: "#3AD186", bg: "#EBFBF3", ink: "#1B8A56" },
        danger: "#C22828",
        warning: "#FF733C",
        running: { DEFAULT: "#28D1FF", bg: "#E5FAFF", ink: "#0E7A9E" },
      },
      fontFamily: {
        // 规范：英文 Roboto，中文思源黑体（系统回退链承载，UI 英文优先）
        display: ["Roboto", '"Source Han Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
        sans: ["Roboto", '"Source Han Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      maxWidth: {
        "6xl": "72rem",
      },
    },
  },
  plugins: [],
};
