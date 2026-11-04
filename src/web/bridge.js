/**
 * PWA 数据桥：在浏览器里实现与 preload 同名的 window.openexam。
 *
 * 组成：
 *   1. sql.js（WASM SQLite）承载 src/main/database.js 的同一套业务 SQL；
 *   2. 首屏只初始化空库（不内置题库），题目由用户通过「导入题库包」按需载入；
 *   3. 数据与题库分开持久化到 IndexedDB：用户数据写后防抖快照，题库只在导入时存；
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

const IDB_NAME = 'openexam-pwa';
const IDB_STORE = 'kv';
const USER_SNAPSHOT_KEY = 'snapshot-user-v2';
const BANK_SNAPSHOT_KEY = 'snapshot-bank-v2';
const BANK_TABLES = new Set(['papers', 'questions']);
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

function captureSnapshot(raw, bankOnly = false) {
  const result = raw.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const names = result.length ? result[0].values.map((row) => row[0]) : [];
  const tables = {};
  for (const name of names) {
    if (bankOnly ? !BANK_TABLES.has(name) : BANK_TABLES.has(name)) continue;
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

/* ───────────────────────── 文件工具 ───────────────────────── */

function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] || null));
    window.addEventListener('focus', () => setTimeout(() => done(null), 400), { once: true });
    input.click();
  });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───────────────────────── 桥接对象 ───────────────────────── */

function createBridge(database, trackConfig, questionPack, ctx) {
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
    pack: {
      // 供拖放 / 自动化调用：直接吃题库包文本
      async importFromText(text) {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          return { success: false, error: `文件不是合法 JSON：${error.message}` };
        }
        const checked = questionPack.validatePack(parsed);
        if (!checked.valid) {
          return { success: false, error: checked.errors.slice(0, 3).join('；'), errors: checked.errors };
        }
        const result = call('importQuestionPack', checked.pack);
        await ctx.saveBank();
        return { success: result.importedPapers > 0, ...result };
      },
      async importFromFile() {
        const file = await pickJsonFile();
        if (!file) return { success: false, canceled: true };
        const result = await window.openexam.pack.importFromText(await file.text());
        if (result.success) result.fileName = file.name;
        return result;
      },
      async exportToFile(options = {}) {
        const subject = String(options?.subject || '').trim();
        const data = call('exportQuestionPack', { subject });
        if (!data?.paperCount) return { success: false, error: '该范围下没有可导出的试卷' };
        const pack = {
          schemaVersion: questionPack.PACK_VERSION,
          exportedAt: new Date().toISOString(),
          app: { name: 'OpenExam', version: '0.3.0' },
          scope: { subject, label: subject ? '单科目' : '全部题库' },
          papers: data.papers,
        };
        downloadJson(`openexam-pack-${new Date().toISOString().slice(0, 10)}.json`, pack);
        return { success: true, paperCount: data.paperCount, questionCount: data.questionCount };
      },
    },
  };
}

/* ───────────────────────── 入口 ───────────────────────── */

export async function initWebBridge() {
  if (typeof window === 'undefined' || window.openexam) return window.openexam;

  const SQL = await loadSqlJs();

  // 首屏只建空库：不再下载 10MB 种子，也不需要解压 50MB
  const emptyDb = new Uint8Array(0);
  const ctx = {
    sqlJs: SQL,
    dbBytes: emptyDb,
    rawDb: null,
    files: { '/userdata/openexam.db': emptyDb },
  };
  globalThis.__OPENEXAM_WEB__ = ctx;

  let saveTimer = null;
  let saving = false;
  const flush = async () => {
    if (!ctx.rawDb || saving) return;
    saving = true;
    try {
      await idbSet(USER_SNAPSHOT_KEY, captureSnapshot(ctx.rawDb));
    } catch (error) {
      console.warn('[pwa] 学习数据快照保存失败', error);
    } finally {
      saving = false;
    }
  };
  const saveBank = async () => {
    if (!ctx.rawDb) return;
    try {
      await idbSet(BANK_SNAPSHOT_KEY, captureSnapshot(ctx.rawDb, true));
    } catch (error) {
      console.warn('[pwa] 题库快照保存失败', error);
    }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, SNAPSHOT_DELAY);
  };
  ctx.markDirty = scheduleSave;
  ctx.saveBank = saveBank;

  const module = await import('./generated/database.js');
  const { database, trackConfig, questionPack } = module.default || module;

  database.initDatabase();

  const bankSnapshot = await idbGet(BANK_SNAPSHOT_KEY);
  // 兼容旧版（内置种子题库）用户：保留他们已有的学习记录
  const userSnapshot = (await idbGet(USER_SNAPSHOT_KEY)) || (await idbGet('snapshot-v1'));
  if (bankSnapshot) {
    restoreSnapshot(ctx.rawDb, bankSnapshot);
    console.info('[pwa] 已恢复导入的题库', bankSnapshot.savedAt);
  }
  if (userSnapshot) {
    restoreSnapshot(ctx.rawDb, userSnapshot);
    console.info('[pwa] 已恢复本地学习数据', userSnapshot.savedAt);
  }

  window.openexam = createBridge(database, trackConfig, questionPack, ctx);
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  return window.openexam;
}
