/**
 * fs 的极简替身：用内存虚拟文件系统承接 database.js 的初始化读写。
 * 真实数据落盘由 bridge 的 IndexedDB 快照负责。
 */
const state = () => (globalThis.__OPENEXAM_WEB__ || {});

function ensureFiles() {
  const ctx = globalThis.__OPENEXAM_WEB__ || (globalThis.__OPENEXAM_WEB__ = {});
  if (!ctx.files) ctx.files = {};
  return ctx.files;
}

function normalizePath(target) {
  return String(target || '').replace(/\\/g, '/');
}

function toBuffer(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(0);
}

module.exports = {
  existsSync(target) {
    return Boolean(ensureFiles()[normalizePath(target)]);
  },
  mkdirSync() {},
  readFileSync(target, encoding) {
    const file = ensureFiles()[normalizePath(target)];
    if (!file) {
      const error = new Error(`ENOENT: no such file or directory, open '${target}'`);
      error.code = 'ENOENT';
      throw error;
    }
    if (!encoding) return file;
    return new TextDecoder(encoding === 'utf8' || encoding === 'utf-8' ? 'utf-8' : encoding).decode(file);
  },
  writeFileSync(target, data) {
    ensureFiles()[normalizePath(target)] = toBuffer(data);
  },
  appendFileSync(target, data) {
    const files = ensureFiles();
    const key = normalizePath(target);
    const prev = files[key] || new Uint8Array(0);
    const next = toBuffer(data);
    const merged = new Uint8Array(prev.length + next.length);
    merged.set(prev, 0);
    merged.set(next, prev.length);
    files[key] = merged;
  },
  copyFileSync(from, to) {
    const files = ensureFiles();
    files[normalizePath(to)] = files[normalizePath(from)] || new Uint8Array(0);
  },
  rmSync() {},
  unlinkSync() {},
  statSync() {
    return { size: 0, mtimeMs: Date.now(), isFile: () => true, isDirectory: () => false };
  },
  readdirSync() {
    return [];
  },
};

// 供 shim 自身使用
module.exports.__state = state;
