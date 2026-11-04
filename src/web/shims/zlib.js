/**
 * zlib 替身：种子库解压在 bridge 里用 DecompressionStream 提前完成，
 * database.js 的 gunzip 分支不会被走到。
 */
module.exports = {
  gunzipSync() {
    throw new Error('浏览器环境请使用 bridge 预解压的种子数据库');
  },
  gzipSync(data) {
    return data;
  },
};
