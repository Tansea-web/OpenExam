/**
 * esbuild 打包入口：把主进程的数据层与目标配置模块一起打成浏览器可用的 ESM。
 * 产物由 scripts/build-web-database.js 生成，bridge.js 动态导入。
 */
module.exports = {
  database: require('../main/database.js'),
  trackConfig: require('../main/trackConfig.js'),
};
