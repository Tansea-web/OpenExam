/**
 * electron 模块的浏览器替身：只提供 database.js 初始化所需的少量能力。
 */
module.exports = {
  app: {
    getPath: () => '/userdata',
    getVersion: () => '0.3.0',
    getName: () => 'OpenExam',
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('浏览器环境不支持安全存储，请勿在 PWA 中保存 API Key');
    },
    decryptString: () => '',
  },
};
