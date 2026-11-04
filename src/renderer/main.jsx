import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { DialogProvider } from "./components/DialogProvider.jsx";
import { AchievementUnlockProvider } from "./components/AchievementUnlockCeremony.jsx";
import "./styles.css";
// 移动端覆盖样式，必须在 styles.css 之后加载
import "./styles-mobile.css";

const container = document.getElementById("root");
const root = createRoot(container);

function renderApp() {
  root.render(
    <DialogProvider>
      <AchievementUnlockProvider>
        <App />
      </AchievementUnlockProvider>
    </DialogProvider>
  );
}

async function bootstrap() {
  // 桌面端由 preload 注入 window.openexam；浏览器 / PWA 走 sql.js 桥接
  if (__OPENEXAM_WEB__ && !window.openexam) {
    container.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font:14px/1.6 system-ui;color:#6b7280">正在加载本地题库…</div>';
    try {
      const { initWebBridge } = await import("../web/bridge.js");
      await initWebBridge();
    } catch (error) {
      console.error("[pwa] 初始化失败", error?.stack || error?.message || error);
      container.innerHTML = `<div style="display:grid;place-items:center;height:100vh;padding:24px;font:14px/1.7 system-ui;color:#b91c1c;text-align:center">本地数据初始化失败<br/><span style="color:#6b7280">${String(error?.message || error)}</span></div>`;
      return;
    }
  }

  renderApp();

  if (__OPENEXAM_WEB__ && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(new URL("sw.js", document.baseURI).href, { scope: "./" })
        .catch((error) => console.warn("[pwa] Service Worker 注册失败", error));
    });
  }
}

bootstrap();
