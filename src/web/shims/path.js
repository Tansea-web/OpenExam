/**
 * path 的浏览器替身（POSIX 风格），只覆盖 database.js 用到的 join / resolve 等。
 */
function normalize(parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map(String)
    .join('/');
  const isAbsolute = joined.startsWith('/');
  const segments = [];
  for (const segment of joined.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length && segments[segments.length - 1] !== '..') segments.pop();
      else if (!isAbsolute) segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  return `${isAbsolute ? '/' : ''}${segments.join('/')}` || (isAbsolute ? '/' : '.');
}

module.exports = {
  sep: '/',
  join: (...parts) => normalize(parts),
  resolve: (...parts) => `/${normalize(parts)}`.replace(/\/+/g, '/'),
  dirname: (target) => {
    const value = String(target || '').replace(/\\/g, '/');
    const index = value.lastIndexOf('/');
    return index <= 0 ? '/' : value.slice(0, index);
  },
  basename: (target, ext) => {
    const value = String(target || '').replace(/\\/g, '/');
    const base = value.slice(value.lastIndexOf('/') + 1);
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (target) => {
    const base = String(target || '');
    const index = base.lastIndexOf('.');
    return index <= 0 ? '' : base.slice(index);
  },
};
