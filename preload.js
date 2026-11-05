const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openexam", {
  setTheme: (theme) => {
    if (theme === "dark" || theme === "light") {
      document.documentElement.dataset.theme = theme;
    }
  },

  // 数据库 API
  db: {
    getPapers: () => ipcRenderer.invoke("db:getPapers"),
    getQuestions: (paperId) => ipcRenderer.invoke("db:getQuestions", paperId),
    getQuestionsByIds: (ids) => ipcRenderer.invoke("db:getQuestionsByIds", ids),
    savePracticeRecord: (record) => ipcRenderer.invoke("db:savePracticeRecord", record),
    getPracticeRecords: (options) => ipcRenderer.invoke("db:getPracticeRecords", options),
    addWrongQuestion: (data) => ipcRenderer.invoke("db:addWrongQuestion", data),
    getWrongQuestions: (options) => ipcRenderer.invoke("db:getWrongQuestions", options),
    reviewWrongQuestion: (input) => ipcRenderer.invoke("db:reviewWrongQuestion", input),
    setWrongQuestionCause: (questionId, cause) =>
      ipcRenderer.invoke("db:setWrongQuestionCause", { questionId, cause }),
    saveTrainingAttempt: (payload) => ipcRenderer.invoke("db:saveTrainingAttempt", payload),
    getTrainingAttempts: (limit) => ipcRenderer.invoke("db:getTrainingAttempts", limit),
    getCategoryStats: (options) => ipcRenderer.invoke("db:getCategoryStats", options),
    getSubjectStats: () => ipcRenderer.invoke("db:getSubjectStats"),
    getAdaptiveQuestions: (options) => ipcRenderer.invoke("db:getAdaptiveQuestions", options),
    listTrackConfig: () => ipcRenderer.invoke("db:listTrackConfig"),
    saveTrack: (payload) => ipcRenderer.invoke("db:saveTrack", payload),
    deleteTrack: (key) => ipcRenderer.invoke("db:deleteTrack", key),
    saveTrackSubject: (payload) => ipcRenderer.invoke("db:saveTrackSubject", payload),
    deleteTrackSubject: (key) => ipcRenderer.invoke("db:deleteTrackSubject", key),
    saveTrackCategory: (payload) => ipcRenderer.invoke("db:saveTrackCategory", payload),
    deleteTrackCategory: (subjectKey, key) => ipcRenderer.invoke("db:deleteTrackCategory", { subjectKey, key }),
    getSmartRecommend: (options) => ipcRenderer.invoke("db:getSmartRecommend", options),
    getSubCategoryStats: (category, options) => ipcRenderer.invoke("db:getSubCategoryStats", category, options),
    getPracticeStats: () => ipcRenderer.invoke("db:getPracticeStats"),
    getSubjectiveStats: () => ipcRenderer.invoke("db:getSubjectiveStats"),
    importPaper: (paperData, questions) => ipcRenderer.invoke("db:importPaper", { paperData, questions }),
    saveAIPaper: (paperData, questions) => ipcRenderer.invoke("db:saveAIPaper", { paperData, questions }),
    getImportedPapers: () => ipcRenderer.invoke("db:getImportedPapers"),
    getSavedAIPapers: () => ipcRenderer.invoke("db:getSavedAIPapers"),
    renameSavedPaper: (paperId, title) => ipcRenderer.invoke("db:renameSavedPaper", { paperId, title }),
    deleteSavedPaper: (paperId) => ipcRenderer.invoke("db:deleteSavedPaper", { paperId }),
    getQuestionsByCategory: (category, subCategory, limit, shuffle, options) =>
      ipcRenderer.invoke("db:getQuestionsByCategory", { category, subCategory, limit, shuffle, subject: options?.subject }),
    getCategoryMaterialStats: (category) =>
      ipcRenderer.invoke("db:getCategoryMaterialStats", category || "ziliao"),
    getDailyStats: (days) => ipcRenderer.invoke("db:getDailyStats", days),
    getStreakDays: () => ipcRenderer.invoke("db:getStreakDays"),
    getTodayStats: () => ipcRenderer.invoke("db:getTodayStats"),
    getHeatmapData: (days) => ipcRenderer.invoke("db:getHeatmapData", days),
    getGrowthData: () => ipcRenderer.invoke("db:getGrowthData"),
    getAppSetting: (key) => ipcRenderer.invoke("db:getAppSetting", key),
    setAppSetting: (key, value) => ipcRenderer.invoke("db:setAppSetting", { key, value }),
    getAISettings: () => ipcRenderer.invoke("db:getAISettings"),
    saveAISettings: (settings) => ipcRenderer.invoke("db:saveAISettings", settings),
    getAIConnectionState: () => ipcRenderer.invoke("db:getAIConnectionState"),
    saveAIConnectionState: (state) => ipcRenderer.invoke("db:saveAIConnectionState", state),
    createAIChatSession: (input) => ipcRenderer.invoke("db:createAIChatSession", input),
    getAIChatSessions: (limit) => ipcRenderer.invoke("db:getAIChatSessions", limit),
    getAIChatMessages: (sessionId, limit) => ipcRenderer.invoke("db:getAIChatMessages", sessionId, limit),
    addAIChatMessage: (input) => ipcRenderer.invoke("db:addAIChatMessage", input),
    renameAIChatSession: (sessionId, title) => ipcRenderer.invoke("db:renameAIChatSession", sessionId, title),
    deleteAIChatSession: (sessionId) => ipcRenderer.invoke("db:deleteAIChatSession", sessionId),
    exportAllData: () => ipcRenderer.invoke("db:exportAllData"),
    exportBackupFile: (clientState) => ipcRenderer.invoke("db:exportBackupFile", clientState),
    importBackupFile: () => ipcRenderer.invoke("db:importBackupFile"),
    resetUserData: () => ipcRenderer.invoke("db:resetUserData"),
    clearAllData: () => ipcRenderer.invoke("db:clearAllData"),
  },

  // 备考待办
  todo: {
    getTemplates: () => ipcRenderer.invoke("todo:getTemplates"),
    saveTemplate: (input) => ipcRenderer.invoke("todo:saveTemplate", input),
    deleteTemplate: (templateId) => ipcRenderer.invoke("todo:deleteTemplate", templateId),
    reorderTemplates: (ids) => ipcRenderer.invoke("todo:reorderTemplates", ids),
    getDaily: (date) => ipcRenderer.invoke("todo:getDaily", date),
    addInstance: (input) => ipcRenderer.invoke("todo:addInstance", input),
    updateInstance: (input) => ipcRenderer.invoke("todo:updateInstance", input),
    deleteInstance: (id) => ipcRenderer.invoke("todo:deleteInstance", id),
    bumpProgress: (kind, amount, date) => ipcRenderer.invoke("todo:bumpProgress", { kind, amount, date }),
    carryOver: (ids, date) => ipcRenderer.invoke("todo:carryOver", { ids, date }),
    getStreak: (days) => ipcRenderer.invoke("todo:getStreak", days),
  },

  // 笔记与知识库
  note: {
    save: (input) => ipcRenderer.invoke("note:save", input),
    list: (options) => ipcRenderer.invoke("note:list", options),
    get: (id) => ipcRenderer.invoke("note:get", id),
    remove: (id) => ipcRenderer.invoke("note:delete", id),
    search: (keyword, options) => ipcRenderer.invoke("note:search", { keyword, options }),
    tags: () => ipcRenderer.invoke("note:tags"),
  },

  // 申论
  essay: {
    savePrompt: (input) => ipcRenderer.invoke("essay:savePrompt", input),
    listPrompts: (options) => ipcRenderer.invoke("essay:listPrompts", options),
    getPrompt: (id) => ipcRenderer.invoke("essay:getPrompt", id),
    deletePrompt: (id) => ipcRenderer.invoke("essay:deletePrompt", id),
    saveAttempt: (input) => ipcRenderer.invoke("essay:saveAttempt", input),
    listAttempts: (options) => ipcRenderer.invoke("essay:listAttempts", options),
    getAttempt: (id) => ipcRenderer.invoke("essay:getAttempt", id),
    deleteAttempt: (id) => ipcRenderer.invoke("essay:deleteAttempt", id),
    recommend: (options) => ipcRenderer.invoke("essay:recommend", options),
    saveDraft: (payload) => ipcRenderer.invoke("essay:saveDraft", payload),
    getDraft: (promptId) => ipcRenderer.invoke("essay:getDraft", promptId),
    deleteDraft: (promptId) => ipcRenderer.invoke("essay:deleteDraft", promptId),
  },

  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo"),
    getUpdateState: () => ipcRenderer.invoke("app:getUpdateState"),
    checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
    quitAndInstallUpdate: () => ipcRenderer.invoke("app:quitAndInstallUpdate"),
    openReleasePage: () => ipcRenderer.invoke("app:openReleasePage"),
    openExternal: (targetUrl) => ipcRenderer.invoke("app:openExternal", targetUrl),
    getProfile: () => ipcRenderer.invoke("app:getProfile"),
    saveProfile: (input) => ipcRenderer.invoke("app:saveProfile", input),
    onUpdateState: (handler) => {
      if (typeof handler !== "function") return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("app:update-state", listener);
      return () => ipcRenderer.removeListener("app:update-state", listener);
    },
  },

  paper: {
    exportPdf: (payload) => ipcRenderer.invoke("paper:exportPdf", payload),
  },

  // 题库包（跨设备共享题目，不含学习数据与 AI 配置）
  pack: {
    exportToFile: (options) => ipcRenderer.invoke("pack:exportToFile", options),
    importFromFile: () => ipcRenderer.invoke("pack:importFromFile"),
  },

  // AI API
  ai: {
    testConnection: (settings) => ipcRenderer.invoke("ai:testConnection", settings),
    recognizeQuestions: (settings, imageBase64, mimeType) =>
      ipcRenderer.invoke("ai:recognizeQuestions", { settings, imageBase64, mimeType }),
    chat: (settings, messages) =>
      ipcRenderer.invoke("ai:chat", { settings, messages }),
    chatStreamStart: (settings, messages, requestId) =>
      ipcRenderer.invoke("ai:chatStreamStart", { settings, messages, requestId }),
    chatStreamCancel: (requestId) =>
      ipcRenderer.invoke("ai:chatStreamCancel", requestId),
    onChatStreamEvent: (handler) => {
      if (typeof handler !== "function") return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("ai:chatStream:event", listener);
      return () => ipcRenderer.removeListener("ai:chatStream:event", listener);
    },
    generatePaper: (settings, config) =>
      ipcRenderer.invoke("ai:generatePaper", { settings, config }),
    gradeEssay: (settings, payload) =>
      ipcRenderer.invoke("ai:gradeEssay", { settings, payload }),
    gradeSubjective: (settings, payload) =>
      ipcRenderer.invoke("ai:gradeSubjective", { settings, payload }),
    recognizeEssay: (settings, imageBase64, mimeType) =>
      ipcRenderer.invoke("ai:recognizeEssay", { settings, imageBase64, mimeType }),
    analyzeWrongCause: (settings, payload) =>
      ipcRenderer.invoke("ai:analyzeWrongCause", { settings, payload }),
    createVariant: (settings, payload) =>
      ipcRenderer.invoke("ai:createVariant", { settings, payload }),
    reviewVariant: (settings, variant) =>
      ipcRenderer.invoke("ai:reviewVariant", { settings, variant }),
  }
});
