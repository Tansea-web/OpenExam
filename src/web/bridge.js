/**
 * PWA 数据桥：在浏览器里实现与 preload 同名的 window.openexam。
 *
 * 组成：
 *   1. sql.js（WASM SQLite）承载 src/main/database.js 的同一套业务 SQL；
 *   2. 种子题库从 data/openexam.seed.db.gz 加载（只读）；
 *   3. 用户数据（练习记录、错题、笔记、待办…）以「表快照」形式存进 IndexedDB，
 *      写操作后防抖快照，冷启动时恢复；
 *   4. AI / PDF / 更新等桌面能力在 PWA 中降级。
 */
/**
 * sql.js 以普通 <script> 方式加载（不走打包器）。
 * 原因：它的 UMD 分支里有 require('fs')/'path'，被打包器静态化后会在浏览器里报错。
 */
const SQLJS_URL = new URL('sql/sql-wasm.js', document.baseURI).href;
const SQLJS_WASM_URL = new URL('sql/sql-wasm.wasm', document.baseURI).href;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`加载脚本失败：${src}`));
    document.head.appendChild(script);
  });
}

async function loadSqlJs() {
  if (!window.initSqlJs) await loadScript(SQLJS_URL);
  if (!window.initSqlJs) throw new Error('sql.js 未挂载到 window');
  return window.initSqlJs({ locateFile: () => SQLJS_WASM_URL });
}

const SEED_URL = new URL('data/openexam.seed.db.gz', document.baseURI).href;
const IDB_NAME = 'openexam-pwa';
const IDB_STORE = 'kv';
const SNAPSHOT_KEY = 'snapshot-v1';
const SEED_TABLES = new Set(['papers', 'questions']);
const SNAPSHOT_DELAY = 1200;

/* ───────────────────────── IndexedDB ───────────────────────── */

function openIdb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ───────────────────────── 快照 ───────────────────────── */

function captureSnapshot(raw) {
  const result = raw.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const names = result.length ? result[0].values.map((row) => row[0]) : [];
  const tables = {};
  for (const name of names) {
    if (SEED_TABLES.has(name)) continue;
    const table = raw.exec(`SELECT * FROM "${name}"`);
    if (!table.length) {
      tables[name] = [];
      continue;
    }
    const { columns, values } = table[0];
    tables[name] = values.map((value) => {
      const row = {};
      columns.forEach((column, index) => { row[column] = value[index]; });
      return row;
    });
  }
  return { version: 1, savedAt: Date.now(), tables };
}

function restoreSnapshot(raw, snapshot) {
  if (!snapshot?.tables) return;
  raw.exec('PRAGMA foreign_keys = OFF');
  for (const [name, rows] of Object.entries(snapshot.tables)) {
    try {
      raw.exec(`DELETE FROM "${name}"`);
    } catch (error) {
      continue;
    }
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(',');
    const columnList = columns.map((column) => `"${column}"`).join(',');
    const statement = raw.prepare(`INSERT INTO "${name}" (${columnList}) VALUES (${placeholders})`);
    for (const row of rows) {
      statement.run(columns.map((column) => (row[column] === undefined ? null : row[column])));
    }
    statement.free();
  }
  raw.exec('PRAGMA foreign_keys = ON');
}

/* ───────────────────────── 种子库 ───────────────────────── */

async function loadSeedBytes() {
  let response;
  try {
    response = await fetch(SEED_URL, { cache: 'force-cache' });
  } catch (error) {
    throw new Error(`种子题库请求失败（${SEED_URL}）：${error?.message || error}`);
  }
  if (!response.ok) throw new Error(`种子题库加载失败（${response.status}）：${SEED_URL}`);
  const payload = new Uint8Array(await response.arrayBuffer());

  // 静态服务器可能已经按 Content-Encoding 解压过，这里按 gzip 魔数判断是否需要二次解压
  const isGzip = payload.length > 2 && payload[0] === 0x1f && payload[1] === 0x8b;
  if (!isGzip) return payload;

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持 DecompressionStream，请升级浏览器');
  }
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/* ───────────────────────── 桥接对象 ───────────────────────── */

function createBridge(database, trackConfig, ctx) {
  const call = (name, ...args) => {
    const fn = database[name];
    if (typeof fn !== 'function') {
      console.warn(`[pwa] database.${name} 未实现`);
      return undefined;
    }
    return fn(...args);
  };

  const unsupported = (feature) => async () => ({
    success: false,
    error: `${feature} 暂不支持 PWA 版本，请在桌面端使用`,
  });

  const db = {
    getPapers: () => call('getPapers'),
    getQuestions: (paperId) => call('getQuestionsByPaperId', paperId),
    getQuestionsByIds: (ids) => call('getQuestionsByIds', ids),
    savePracticeRecord: (record) => { call('savePracticeRecord', record); return true; },
    getPracticeRecords: (options) => call('getPracticeRecords', options || {}),
    addWrongQuestion: (data = {}) => {
      call('addWrongQuestion', data.questionId, data.paperId, data.userAnswer, data.correctAnswer, data.subject, data.cause);
      return true;
    },
    getWrongQuestions: (options) => call('getWrongQuestions', options || {}),
    reviewWrongQuestion: (input) => call('reviewWrongQuestion', input),
    setWrongQuestionCause: (questionId, cause) => call('setWrongQuestionCause', questionId, cause),
    saveTrainingAttempt: (payload) => call('saveTrainingAttempt', payload),
    getTrainingAttempts: (limit) => call('getTrainingAttempts', limit),
    getCategoryStats: (options) => call('getCategoryStats', options || {}),
    getSubjectStats: () => call('getSubjectStats'),
    getAdaptiveQuestions: (options) => call('getAdaptiveQuestions', options || {}),
    listTrackConfig: () => trackConfig.listTrackConfig(),
    saveTrack: (payload) => trackConfig.saveTrack(payload || {}),
    deleteTrack: (key) => trackConfig.deleteTrack(key),
    saveTrackSubject: (payload) => trackConfig.saveSubject(payload || {}),
    deleteTrackSubject: (key) => trackConfig.deleteSubject(key),
    saveTrackCategory: (payload) => trackConfig.saveCategory(payload || {}),
    deleteTrackCategory: (subjectKey, key) => trackConfig.deleteCategory(subjectKey, key),
    getSmartRecommend: (options) => call('getSmartRecommend', options || {}),
    getSubCategoryStats: (category, options) => call('getSubCategoryStats', category, options || {}),
    getPracticeStats: () => call('getPracticeStats'),
    importPaper: (paperData, questions) => call('importPaper', paperData, questions),
    saveAIPaper: (paperData, questions) => call('saveAIPaper', paperData, questions),
    getImportedPapers: () => call('getImportedPapers'),
    getSavedAIPapers: () => call('getSavedAIPapers'),
    renameSavedPaper: (paperId, title) => call('renameSavedPaper', paperId, title),
    deleteSavedPaper: (paperId) => call('deleteSavedPaper', paperId),
    getQuestionsByCategory: (category, subCategory, limit, shuffle, options) =>
      call('getQuestionsByCategory', category, subCategory, limit, shuffle, options || {}),
    getCategoryMaterialStats: (category) => call('getCategoryMaterialStats', category || 'ziliao'),
    getDailyStats: (days) => call('getDailyStats', days),
    getStreakDays: () => call('getStreakDays'),
    getTodayStats: () => call('getTodayStats'),
    getHeatmapData: (days) => call('getHeatmapData', days),
    getGrowthData: () => call('getGrowthData'),
    getAppSetting: (key) => call('getAppPreference', key),
    setAppSetting: (key, value) => call('setAppPreference', key, value),
    getAISettings: () => call('getAISettings'),
    saveAISettings: (settings) => call('saveAISettings', settings),
    getAIConnectionState: () => call('getAIConnectionState'),
    saveAIConnectionState: (state) => call('saveAIConnectionState', state),
    createAIChatSession: (input) => call('createAIChatSession', input),
    getAIChatSessions: (limit) => call('getAIChatSessions', limit),
    getAIChatMessages: (sessionId, limit) => call('getAIChatMessages', sessionId, limit),
    addAIChatMessage: (input) => call('addAIChatMessage', input),
    renameAIChatSession: (sessionId, title) => call('renameAIChatSession', sessionId, title),
    deleteAIChatSession: (sessionId) => call('deleteAIChatSession', sessionId),
    exportAllData: () => call('exportAllData'),
    exportBackupFile: async () => {
      const data = call('exportAllData');
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `openexam-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return { success: true };
    },
    importBackupFile: unsupported('导入备份'),
    resetUserData: () => call('resetUserData'),
    clearAllData: () => call('clearAllData'),
    saveSnapshot: async () => {
      await idbSet(SNAPSHOT_KEY, captureSnapshot(ctx.rawDb));
      return true;
    },
  };

  const todo = {
    getTemplates: () => call('getTodoTemplates'),
    saveTemplate: (input) => call('saveTodoTemplate', input),
    deleteTemplate: (id) => call('deleteTodoTemplate', id),
    reorderTemplates: (ids) => call('reorderTodoTemplates', ids),
    getDaily: (date) => call('getDailyTodos', date),
    addInstance: (input) => call('addTodoInstance', input),
    updateInstance: (input) => call('updateTodoInstance', input),
    deleteInstance: (id) => call('deleteTodoInstance', id),
    bumpProgress: (kind, amount, date) => call('bumpTodoProgress', kind, amount, date),
    carryOver: (ids, date) => call('carryOverTodos', ids, date),
    getStreak: (days) => call('getTodoStreak', days),
  };

  const note = {
    save: (input) => call('saveNote', input),
    list: (options) => call('getNotes', options || {}),
    get: (id) => call('getNote', id),
    remove: (id) => call('deleteNote', id),
    search: (keyword, options) => call('searchNotes', keyword, options || {}),
    tags: () => call('getNoteTags'),
  };

  const essay = {
    savePrompt: (input) => call('saveEssayPrompt', input),
    listPrompts: (options) => call('getEssayPrompts', options || {}),
    getPrompt: (id) => call('getEssayPrompt', id),
    deletePrompt: (id) => call('deleteEssayPrompt', id),
    saveAttempt: (input) => call('saveEssayAttempt', input),
    listAttempts: (options) => call('getEssayAttempts', options || {}),
    getAttempt: (id) => call('getEssayAttempt', id),
    deleteAttempt: (id) => call('deleteEssayAttempt', id),
    recommend: (options) => call('recommendEssayPrompt', options || {}),
    saveDraft: (payload) => call('saveEssayDraft', payload),
    getDraft: (promptId) => call('getEssayDraft', promptId),
    deleteDraft: (promptId) => call('deleteEssayDraft', promptId),
  };

  const app = {
    getInfo: () => ({ version: '0.3.0', name: 'OpenExam PWA', platform: 'web' }),
    getUpdateState: () => ({ status: 'idle', canAutoInstall: false }),
    checkForUpdates: async () => ({ status: 'idle', canAutoInstall: false }),
    quitAndInstallUpdate: async () => false,
    openReleasePage: async () => false,
    openExternal: (targetUrl) => { window.open(targetUrl, '_blank', 'noopener'); return true; },
    getProfile: () => call('getUserProfile'),
    saveProfile: (input) => call('saveUserProfile', input),
    onUpdateState: () => () => {},
  };

  const ai = {
    testConnection: unsupported('AI 连接'),
    recognizeQuestions: unsupported('AI 识题'),
    chat: unsupported('AI 对话'),
    chatStreamStart: unsupported('AI 流式对话'),
    chatStreamCancel: async () => true,
    onChatStreamEvent: () => () => {},
    generatePaper: unsupported('AI 出卷'),
    gradeEssay: unsupported('AI 批改'),
    recognizeEssay: unsupported('AI 识别'),
    analyzeWrongCause: unsupported('AI 归因'),
    createVariant: unsupported('AI 变式'),
    reviewVariant: unsupported('AI 变式'),
  };

  return {
    setTheme: (theme) => {
      if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    },
    db,
    todo,
    note,
    essay,
    app,
    ai,
    paper: { exportPdf: unsupported('导出 PDF') },
    pack: { exportToFile: unsupported('导出题库包'), importFromFile: unsupported('导入题库包') },
  };
}

/* ───────────────────────── 入口 ───────────────────────── */

export async function initWebBridge() {
  if (typeof window === 'undefined' || window.openexam) return window.openexam;

  console.info('[pwa] 加载 sql.js', SQLJS_URL);
  const SQL = await loadSqlJs();
  console.info('[pwa] sql.js 就绪，开始读取种子题库');
  const seedBytes = await loadSeedBytes();
  console.info(`[pwa] 种子题库已解压：${(seedBytes.length / 1024 / 1024).toFixed(1)}MB`);

  const ctx = {
    sqlJs: SQL,
    dbBytes: seedBytes,
    rawDb: null,
    files: { '/userdata/openexam.db': seedBytes },
  };
  globalThis.__OPENEXAM_WEB__ = ctx;

  let saveTimer = null;
  let saving = false;
  const flush = async () => {
    if (!ctx.rawDb || saving) return;
    saving = true;
    try {
      await idbSet(SNAPSHOT_KEY, captureSnapshot(ctx.rawDb));
    } catch (error) {
      console.warn('[pwa] 快照保存失败', error);
    } finally {
      saving = false;
    }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, SNAPSHOT_DELAY);
  };
  ctx.markDirty = scheduleSave;

  const module = await import('./generated/database.js');
  const { database, trackConfig } = module.default || module;

  database.initDatabase();

  const snapshot = await idbGet(SNAPSHOT_KEY);
  if (snapshot) {
    restoreSnapshot(ctx.rawDb, snapshot);
    console.info('[pwa] 已恢复本地学习数据', snapshot.savedAt);
  }

  window.openexam = createBridge(database, trackConfig, ctx);
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  return window.openexam;
}
