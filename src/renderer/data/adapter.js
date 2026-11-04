/**
 * 数据层适配器（M1：为 Android 端铺路）
 *
 * 背景：渲染层现有 187 处 `window.openexam.*` 调用、20 个文件。
 * 目标：把它们统一收口到 dataAdapter，内部按运行平台分发：
 *   - 桌面（Electron）：转发到 preload 暴露的 IPC
 *   - Android（Capacitor）：M3 阶段接入 SQLite 插件，方法签名保持一致
 *
 * 迁移方式：把 `window.openexam.db.x(...)` 改成 `dataAdapter.db.x(...)`，
 * 逐个文件替换即可，行为完全不变（桌面端仍是同一套 IPC）。
 */

const BRIDGE_KEY = 'openexam';

export function getBridge() {
  return typeof window !== 'undefined' ? window[BRIDGE_KEY] : undefined;
}

export function isDesktopRuntime() {
  return Boolean(getBridge()?.db);
}

export function isMobileRuntime() {
  return !isDesktopRuntime() && Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

/**
 * 桌面适配器：零维护转发所有分组与方法。
 * 返回 Proxy，访问 dataAdapter.db.getPapers() 等价于 window.openexam.db.getPapers()。
 */
function createDesktopAdapter() {
  return new Proxy({}, {
    get(target, group) {
      const source = getBridge()?.[group];
      if (!source) return undefined;
      return new Proxy({}, {
        get(__, method) {
          const value = source[method];
          if (typeof value !== 'function') return value;
          return (...args) => value.apply(source, args);
        },
        has(__, method) {
          return method in source;
        },
      });
    },
    has(target, group) {
      return Boolean(getBridge()?.[group]);
    },
  });
}

/**
 * 移动端适配器占位：M3 阶段用 Capacitor SQLite 实现同名方法，
 * 在此之前调用会抛出明确错误，避免静默失败。
 */
function createUnsupportedAdapter() {
  const fail = (group) => {
    throw new Error(`当前平台未注入 ${group} 数据实现（Android 版在 M3 阶段接入）`);
  };
  return new Proxy({}, { get: (_, group) => new Proxy({}, { get: () => () => fail(String(group)) }) });
}

export const dataAdapter = isDesktopRuntime() ? createDesktopAdapter() : createUnsupportedAdapter();

export default dataAdapter;
