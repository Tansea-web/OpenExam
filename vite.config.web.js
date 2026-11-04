const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");
const path = require("path");

/**
 * PWA / 浏览器构建
 *
 * 与桌面构建（vite.config.js）互不影响：
 *   - 把 src/main/database.js 这套 CJS 业务 SQL 打包进渲染层；
 *   - 用 src/web/shims 里的替身顶掉 better-sqlite3 / electron / fs / path；
 *   - 产物输出到 dist-web，供 GitHub Pages / 任意静态托管使用。
 */
module.exports = defineConfig({
  base: "./",
  root: path.resolve(__dirname, "src/renderer"),
  publicDir: path.resolve(__dirname, "build/web-public"),
  plugins: [
    react(),
    {
      name: "openexam-pwa-html",
      transformIndexHtml(html) {
        return html.replace(
          "</head>",
          [
            '    <link rel="manifest" href="manifest.webmanifest" />',
            '    <meta name="theme-color" content="#6d5efb" />',
            '    <meta name="apple-mobile-web-app-capable" content="yes" />',
            '    <meta name="apple-mobile-web-app-title" content="OpenExam" />',
            '    <link rel="apple-touch-icon" href="icon-512.png" />',
            "  </head>",
          ].join("\n"),
        );
      },
    },
  ],
  define: {
    __OPENEXAM_WEB__: "true",
  },
  resolve: {
    alias: {
      "better-sqlite3": path.resolve(__dirname, "src/web/shims/better-sqlite3.js"),
      electron: path.resolve(__dirname, "src/web/shims/electron.js"),
      fs: path.resolve(__dirname, "src/web/shims/fs.js"),
      path: path.resolve(__dirname, "src/web/shims/path.js"),
      zlib: path.resolve(__dirname, "src/web/shims/zlib.js"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-web"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5190,
    strictPort: true,
  },
});
