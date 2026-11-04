/**
 * 生成 PWA 构建所需的静态资源目录（build/web-public）。
 * 题库种子体积较大，不适合进仓库，构建前临时拷贝。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'web-public');
const PUBLIC_SRC = path.join(ROOT, 'src', 'web', 'public');
const LOGO = path.join(ROOT, 'src', 'renderer', 'assets', 'openexam-logo.png');

function copyDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirectory(source, target);
    else fs.copyFileSync(source, target);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDirectory(PUBLIC_SRC, OUT);

// 题库不再随包分发：首屏只初始化空库，题目由「导入题库包」按需载入
if (fs.existsSync(LOGO)) {
  fs.copyFileSync(LOGO, path.join(OUT, 'icon-512.png'));
}

// sql.js 以普通脚本加载，避免被 Rollup 把 require('fs') 静态化
const SQL_DIST = path.join(ROOT, 'node_modules', 'sql.js', 'dist');
fs.mkdirSync(path.join(OUT, 'sql'), { recursive: true });
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) {
  const source = path.join(SQL_DIST, file);
  if (!fs.existsSync(source)) {
    console.error(`[web] 缺少 ${source}，请先 npm i sql.js`);
    process.exit(1);
  }
  fs.copyFileSync(source, path.join(OUT, 'sql', file));
}

console.log('[web] 静态资源已准备：build/web-public（不含题库，题目由用户导入）');
