/**
 * 把主进程的 database.js（CJS + better-sqlite3）打成一份可在浏览器运行的 ESM。
 *
 * 做法：用 esbuild 打包，把 better-sqlite3 / electron / fs / path / zlib
 * 别名到 src/web/shims 下的浏览器替身。
 * 产物：src/web/generated/database.js（构建生成，不入库）
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHIMS = path.join(ROOT, 'src', 'web', 'shims');
const OUT_DIR = path.join(ROOT, 'src', 'web', 'generated');
const OUT_FILE = path.join(OUT_DIR, 'database.js');

fs.mkdirSync(OUT_DIR, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'web', 'entry.js')],
  outfile: OUT_FILE,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  logLevel: 'warning',
  alias: {
    'better-sqlite3': path.join(SHIMS, 'better-sqlite3.js'),
    electron: path.join(SHIMS, 'electron.js'),
    fs: path.join(SHIMS, 'fs.js'),
    path: path.join(SHIMS, 'path.js'),
    zlib: path.join(SHIMS, 'zlib.js'),
  },
  define: {
    __dirname: '"/"',
    'process.env.NODE_ENV': '"production"',
  },
});

const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
console.log(`[web] 数据层已打包：src/web/generated/database.js（${size}KB）`);
