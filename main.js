const { app, BrowserWindow, nativeTheme, ipcMain, nativeImage, protocol } = require("electron");
const path = require("path");
const database = require("./src/main/database.js");
const trackConfig = require("./src/main/trackConfig.js");
const backup = require("./src/main/backup.js");
const paperExport = require("./src/main/paperExport.js");
const updater = require("./src/main/updater.js");
const questionAssets = require("./src/main/questionAssets.js");
const dataBackup = require("./src/main/dataBackup.js");

const APP_ICON_PATH = path.join(__dirname, "src", "renderer", "assets", "openexam-app-icon.png");
const APP_ICON = nativeImage.createFromPath(APP_ICON_PATH);

protocol.registerSchemesAsPrivileged([{
  scheme: questionAssets.ASSET_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
}]);

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 680,
    minWidth: 1000,
    minHeight: 580,
    backgroundColor: "#ffffff",
    show: false,
    icon: APP_ICON_PATH,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 22 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once("ready-to-show", () => win.show());

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
    if (['1', 'true', 'yes'].includes(String(process.env.OPENEXAM_DEVTOOLS || '').toLowerCase())) {
      win.webContents.openDevTools({ mode: "detach" });
    }

    // Forward renderer console errors to terminal
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (level >= 2) { // warnings and errors
        console.error(`[Renderer] ${message}`);
      }
    });

    // Do not fs.watch + app.exit() here: under `concurrently -k` that kills Vite and leaves a blank Electron window.
    return;
  }

  win.loadFile(path.join(__dirname, "dist", "index.html"));
};

app.whenReady().then(() => {
  nativeTheme.themeSource = "light";

  if (!APP_ICON.isEmpty()) {
    app.setName("OpenExam");
    if (process.platform === "darwin" && app.dock?.setIcon) {
      app.dock.setIcon(APP_ICON);
    }
  }

  questionAssets.registerProtocol();

  // 初始化数据库
  database.initDatabase();

  // 每日自动备份（失败不阻塞启动）
  try {
    const result = backup.runDailyBackup({
      createBackup: (targetPath) => database.createBackupCopy(targetPath),
      backupDir: backup.getBackupDir(app.getPath("userData")),
      getSetting: (key) => database.getAppPreference(key)?.value ?? null,
    });
    if (result?.file) {
      console.log(`[backup] 今日备份完成: ${result.file}`);
    } else if (result?.skipped && result.reason !== "already-backed-up") {
      console.log(`[backup] 今日备份跳过: ${result.reason}`);
    }
  } catch (error) {
    console.error("[backup] 每日备份失败:", error.message);
  }

  createWindow();
  updater.initUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// IPC 处理器 - 数据库操作
ipcMain.handle("db:getPapers", () => {
  return database.getPapers();
});

ipcMain.handle("db:getQuestions", (event, paperId) => {
  return database.getQuestionsByPaperId(paperId);
});

ipcMain.handle("db:getQuestionsByIds", (event, ids) => {
  return database.getQuestionsByIds(ids || []);
});

ipcMain.handle("db:savePracticeRecord", (event, record) => {
  database.savePracticeRecord(record);
  return true;
});

ipcMain.handle("db:getPracticeRecords", (event, options) => {
  return database.getPracticeRecords(options || {});
});

ipcMain.handle("db:addWrongQuestion", (event, { questionId, paperId, userAnswer, correctAnswer, subject, cause }) => {
  database.addWrongQuestion(questionId, paperId, userAnswer, correctAnswer, subject, cause);
  return true;
});

/* ─── 学习目标配置（目标 → 科目 → 分类） ─── */
ipcMain.handle("db:listTrackConfig", () => trackConfig.listTrackConfig());
ipcMain.handle("db:saveTrack", (event, payload) => trackConfig.saveTrack(payload || {}));
ipcMain.handle("db:deleteTrack", (event, key) => trackConfig.deleteTrack(key));
ipcMain.handle("db:saveTrackSubject", (event, payload) => trackConfig.saveSubject(payload || {}));
ipcMain.handle("db:deleteTrackSubject", (event, key) => trackConfig.deleteSubject(key));
ipcMain.handle("db:saveTrackCategory", (event, payload) => trackConfig.saveCategory(payload || {}));
ipcMain.handle("db:deleteTrackCategory", (event, { subjectKey, key } = {}) => trackConfig.deleteCategory(subjectKey, key));

ipcMain.handle("db:getWrongQuestions", (event, options) => {
  return database.getWrongQuestions(options || {});
});

ipcMain.handle("db:reviewWrongQuestion", (event, input) => {
  return database.reviewWrongQuestion(input?.questionId, input?.outcome);
});

ipcMain.handle("db:setWrongQuestionCause", (event, { questionId, cause } = {}) => {
  return database.setWrongQuestionCause(questionId, cause);
});

ipcMain.handle("db:getCategoryStats", (event, options) => {
  return database.getCategoryStats(options || {});
});

ipcMain.handle("db:getSubjectStats", () => {
  return database.getSubjectStats();
});

ipcMain.handle("db:getAdaptiveQuestions", (event, options) => {
  return database.getAdaptiveQuestions(options || {});
});

ipcMain.handle("db:getSmartRecommend", (event, options) => {
  return database.getSmartRecommend(options || {});
});

ipcMain.handle("db:getSubCategoryStats", (event, category, options) => {
  return database.getSubCategoryStats(category, options || {});
});

ipcMain.handle("db:getPracticeStats", () => {
  return database.getPracticeStats();
});

ipcMain.handle("db:importPaper", (event, { paperData, questions }) => {
  return database.importPaper(paperData, questions);
});

ipcMain.handle("db:saveAIPaper", (event, { paperData, questions }) => {
  return database.saveAIPaper(paperData, questions);
});

ipcMain.handle("db:getImportedPapers", () => {
  return database.getImportedPapers();
});

ipcMain.handle("db:getSavedAIPapers", () => {
  return database.getSavedAIPapers();
});

ipcMain.handle("db:renameSavedPaper", (event, { paperId, title }) => {
  return database.renameSavedPaper(paperId, title);
});

ipcMain.handle("db:deleteSavedPaper", (event, { paperId }) => {
  return database.deleteSavedPaper(paperId);
});

ipcMain.handle("db:getQuestionsByCategory", (event, { category, subCategory, limit, shuffle, subject }) => {
  return database.getQuestionsByCategory(category, subCategory, limit, shuffle, { subject });
});

ipcMain.handle("db:getCategoryMaterialStats", (event, category) => {
  return database.getCategoryMaterialStats(category || "ziliao");
});

ipcMain.handle("db:getDailyStats", (event, days) => {
  return database.getDailyStats(days || 7);
});

ipcMain.handle("db:getStreakDays", () => {
  return database.getStreakDays();
});

ipcMain.handle("db:getTodayStats", () => {
  return database.getTodayStats();
});

ipcMain.handle("db:getHeatmapData", (event, days) => {
  return database.getHeatmapData(days || 90);
});

ipcMain.handle("db:getGrowthData", () => {
  return database.getGrowthData();
});

ipcMain.handle("db:getAppSetting", (event, key) => {
  return database.getAppPreference(key);
});

ipcMain.handle("db:setAppSetting", (event, { key, value } = {}) => {
  return database.setAppPreference(key, value);
});

ipcMain.handle("db:getAISettings", () => {
  return database.getAISettings();
});

ipcMain.handle("db:saveAISettings", (event, settings) => {
  return database.saveAISettings(settings);
});

ipcMain.handle("db:getAIConnectionState", () => {
  return database.getAIConnectionState();
});

ipcMain.handle("db:saveAIConnectionState", (event, state) => {
  return database.saveAIConnectionState(state);
});

ipcMain.handle("db:createAIChatSession", (event, input) => {
  return database.createAIChatSession(input || {});
});

ipcMain.handle("db:getAIChatSessions", (event, limit) => {
  return database.getAIChatSessions(limit || 30);
});

ipcMain.handle("db:getAIChatMessages", (event, sessionId, limit) => {
  return database.getAIChatMessages(sessionId, limit || 300);
});

ipcMain.handle("db:addAIChatMessage", (event, input) => {
  return database.addAIChatMessage(input || {});
});

ipcMain.handle("db:renameAIChatSession", (event, sessionId, title) => {
  return database.renameAIChatSession(sessionId, title);
});

ipcMain.handle("db:deleteAIChatSession", (event, sessionId) => {
  return database.deleteAIChatSession(sessionId);
});

ipcMain.handle("db:exportAllData", () => {
  return database.exportAllData();
});

ipcMain.handle("db:exportBackupFile", async (event, clientState) => {
  const snapshot = database.exportAllData();
  const payload = {
    ...snapshot,
    kind: "openexam-backup",
    version: 2,
    app: { name: "OpenExam", version: app.getVersion() },
    client_state: clientState && typeof clientState === "object" ? clientState : {},
  };
  const result = await dataBackup.saveBackupFile(BrowserWindow.fromWebContents(event.sender), payload);
  return result?.canceled ? { canceled: true } : { ...result, stats: snapshot.stats };
});

ipcMain.handle("db:importBackupFile", async (event) => {
  const opened = await dataBackup.openBackupFile(BrowserWindow.fromWebContents(event.sender));
  if (opened?.canceled) return { canceled: true };

  const result = database.importAllData(opened.payload || {});
  return {
    canceled: false,
    filePath: opened.filePath,
    importedAt: result.imported_at,
    stats: result.stats,
    clientState: opened.payload?.client_state && typeof opened.payload.client_state === "object"
      ? opened.payload.client_state
      : {},
  };
});

ipcMain.handle("db:resetUserData", () => {
  return database.resetUserData();
});

ipcMain.handle("db:clearAllData", () => {
  return database.clearAllData();
});

// IPC 处理器 - 备考待办 / 笔记
ipcMain.handle("todo:getTemplates", () => {
  return database.getTodoTemplates();
});

ipcMain.handle("todo:saveTemplate", (event, input) => {
  return database.saveTodoTemplate(input || {});
});

ipcMain.handle("todo:deleteTemplate", (event, templateId) => {
  return database.deleteTodoTemplate(templateId);
});

ipcMain.handle("todo:reorderTemplates", (event, ids) => {
  return database.reorderTodoTemplates(ids || []);
});

ipcMain.handle("todo:getDaily", (event, date) => {
  return database.getDailyTodos(date);
});

ipcMain.handle("todo:addInstance", (event, input) => {
  return database.addTodoInstance(input || {});
});

ipcMain.handle("todo:updateInstance", (event, input) => {
  return database.updateTodoInstance(input || {});
});

ipcMain.handle("todo:deleteInstance", (event, id) => {
  return database.deleteTodoInstance(id);
});

ipcMain.handle("todo:bumpProgress", (event, { kind, amount, date } = {}) => {
  return database.bumpTodoProgress(kind, amount, date);
});

ipcMain.handle("todo:carryOver", (event, { ids, date } = {}) => {
  return database.carryOverTodos(ids, date);
});

ipcMain.handle("todo:getStreak", (event, days) => {
  return database.getTodoStreak(days);
});

ipcMain.handle("note:save", (event, input) => {
  return database.saveNote(input || {});
});

ipcMain.handle("note:list", (event, options) => {
  return database.getNotes(options || {});
});

ipcMain.handle("note:get", (event, id) => {
  return database.getNote(id);
});

ipcMain.handle("note:delete", (event, id) => {
  return database.deleteNote(id);
});

ipcMain.handle("note:search", (event, { keyword, options } = {}) => {
  return database.searchNotes(keyword, options || {});
});

ipcMain.handle("note:tags", () => {
  return database.getNoteTags();
});

// IPC 处理器 - 申论
ipcMain.handle("essay:savePrompt", (event, input) => database.saveEssayPrompt(input || {}));
ipcMain.handle("essay:listPrompts", (event, options) => database.getEssayPrompts(options || {}));
ipcMain.handle("essay:getPrompt", (event, id) => database.getEssayPrompt(id));
ipcMain.handle("essay:deletePrompt", (event, id) => database.deleteEssayPrompt(id));
ipcMain.handle("essay:saveAttempt", (event, input) => database.saveEssayAttempt(input || {}));
ipcMain.handle("essay:listAttempts", (event, options) => database.getEssayAttempts(options || {}));
ipcMain.handle("essay:getAttempt", (event, id) => database.getEssayAttempt(id));
ipcMain.handle("essay:deleteAttempt", (event, id) => database.deleteEssayAttempt(id));
ipcMain.handle("essay:recommend", (event, options) => database.getEssayRecommendation(options || {}));
ipcMain.handle("essay:saveDraft", (event, { promptId, content, wordCount } = {}) =>
  database.saveEssayDraft(promptId, content, wordCount)
);
ipcMain.handle("essay:getDraft", (event, promptId) => database.getEssayDraft(promptId));
ipcMain.handle("essay:deleteDraft", (event, promptId) => database.deleteEssayDraft(promptId));

ipcMain.handle("app:getInfo", () => {
  return updater.getAppInfo();
});

ipcMain.handle("app:getUpdateState", () => {
  return updater.getUpdateState();
});

ipcMain.handle("app:checkForUpdates", async () => {
  return updater.checkForUpdates();
});

ipcMain.handle("app:quitAndInstallUpdate", () => {
  return updater.quitAndInstallUpdate();
});

ipcMain.handle("app:openReleasePage", async () => {
  return updater.openReleasePage();
});

ipcMain.handle("app:openExternal", async (event, targetUrl) => {
  return updater.openExternal(targetUrl);
});

ipcMain.handle("app:getProfile", () => {
  return database.getUserProfile();
});

ipcMain.handle("app:saveProfile", (event, input) => {
  return database.saveUserProfile(input || {});
});

ipcMain.handle("paper:exportPdf", async (event, payload) => {
  return paperExport.exportPaperPdf(BrowserWindow.fromWebContents(event.sender), payload || {});
});

// AI 相关 IPC 处理器
const aiService = require("./src/main/ai/index.js");
const activeChatStreams = new Map();

function emitChatStreamEvent(sender, payload) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("ai:chatStream:event", payload);
}

ipcMain.handle("ai:testConnection", async (event, settings) => {
  return aiService.testConnection(database.resolveAISecrets(settings));
});

ipcMain.handle("ai:recognizeQuestions", async (event, { settings, imageBase64, mimeType }) => {
  return aiService.recognizeQuestions(database.resolveAISecrets(settings), imageBase64, mimeType);
});

ipcMain.handle("ai:chat", async (event, { settings, messages }) => {
  return aiService.chat(database.resolveAISecrets(settings), messages);
});

ipcMain.handle("ai:chatStreamStart", async (event, { settings, messages, requestId }) => {
  const id = String(requestId || "").trim();
  if (!id) return { success: false, error: "requestId 不能为空" };

  const sender = event.sender;
  const previous = activeChatStreams.get(id);
  if (previous) {
    previous.abortController.abort();
    activeChatStreams.delete(id);
  }

  const abortController = new AbortController();
  activeChatStreams.set(id, { abortController, senderId: sender.id });

  (async () => {
    try {
      const result = await aiService.chatStream(database.resolveAISecrets(settings), messages, {
        signal: abortController.signal,
        onDelta: (delta) => {
          emitChatStreamEvent(sender, { requestId: id, type: "delta", delta: String(delta || "") });
        },
      });

      if (!abortController.signal.aborted) {
        emitChatStreamEvent(sender, {
          requestId: id,
          type: "done",
          content: String(result?.content || ""),
          success: Boolean(result?.success),
        });
      }
    } catch (error) {
      emitChatStreamEvent(sender, {
        requestId: id,
        type: abortController.signal.aborted ? "cancelled" : "error",
        error: error?.message || "流式请求失败",
      });
    } finally {
      const current = activeChatStreams.get(id);
      if (current && current.abortController === abortController) {
        activeChatStreams.delete(id);
      }
    }
  })();

  return { success: true };
});

ipcMain.handle("ai:chatStreamCancel", async (event, requestId) => {
  const id = String(requestId || "").trim();
  if (!id) return { success: false };
  const holder = activeChatStreams.get(id);
  if (!holder) return { success: false };
  holder.abortController.abort();
  activeChatStreams.delete(id);
  return { success: true };
});

ipcMain.handle("ai:gradeEssay", async (event, { settings, payload }) => {
  return aiService.gradeEssay(database.resolveAISecrets(settings), payload || {});
});

ipcMain.handle("ai:recognizeEssay", async (event, { settings, imageBase64, mimeType }) => {
  return aiService.recognizeEssay(database.resolveAISecrets(settings), imageBase64, mimeType);
});

ipcMain.handle("ai:generatePaper", async (event, { settings, config }) => {
  const requestId = `ipc_gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  console.info(`[IPC][Generate][${requestId}] start`, {
    provider: settings?.aiProvider || "",
    model: settings?.model || settings?.customModel || "",
    apiFormat: settings?.apiFormat || "",
    track: config?.track,
    focus: config?.focus,
    mode: config?.mode,
    count: config?.count,
    category: config?.category,
    mixedCategories: Array.isArray(config?.mixedCategories) ? config.mixedCategories.join(",") : "",
    difficulty: config?.difficulty,
  });

  const result = await aiService.generatePaper(database.resolveAISecrets(settings), config);

  console.info(`[IPC][Generate][${requestId}] done`, {
    elapsedMs: Date.now() - startedAt,
    success: Boolean(result?.success),
    questions: Array.isArray(result?.questions) ? result.questions.length : 0,
    debugId: result?.debugId || "",
    error: result?.success ? "" : String(result?.error || ""),
  });

  return result;
});

app.on("window-all-closed", () => {
  database.closeDatabase();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
