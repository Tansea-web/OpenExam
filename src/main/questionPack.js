/**
 * 题库包（openexam.pack.v1）
 *
 * 用途：跨设备/跨人共享题目，不携带任何学习记录、错题、AI 配置与个人设置。
 * 结构：
 * {
 *   schemaVersion: 'openexam.pack.v1',
 *   exportedAt, app: { name, version },
 *   scope: { subject, label },
 *   papers: [{ id, title, year, type, subject, questions: [...] }],
 *   taxonomy: {                 // 可选：目标 / 科目 / 分类定义，接收方导入时自动补齐
 *     tracks: [...], subjects: [...], categories: [...]
 *   }
 * }
 *
 * taxonomy 是向后兼容的可选字段：旧版客户端会忽略它，新版也能读不带它的老包。
 */

const PACK_VERSION = 'openexam.pack.v1';
// 内置题库约 1.8 万题，全量导出也要能一次导入；仍保留上限防止超大文件
const MAX_QUESTIONS = 30000;
const MAX_TRACKS = 20;
const MAX_SUBJECTS = 60;
const MAX_CATEGORIES = 300;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value, max = 80) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeKey(value) {
  const key = safeText(value, 64);
  return KEY_RE.test(key) ? key : '';
}

function safeInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option, index) => {
      if (typeof option === 'string') {
        return { key: String.fromCharCode(65 + index), content: option.trim() };
      }
      if (!isPlainObject(option)) return null;
      return {
        key: String(option.key || String.fromCharCode(65 + index)).trim().slice(0, 2),
        content: String(option.content || option.text || '').trim(),
      };
    })
    .filter((option) => option && option.content);
}

function normalizeQuestion(raw, index) {
  const source = isPlainObject(raw) ? raw : {};
  const options = normalizeOptions(source.options);
  const answer = String(source.answer || '').trim().toUpperCase();
  return {
    id: String(source.id || `q_${index + 1}`),
    content: String(source.content || source.stem || '').trim(),
    options,
    answer,
    analysis: String(source.analysis || '').trim(),
    category: String(source.category || '').trim(),
    subCategory: String(source.subCategory || source.sub_category || '').trim(),
    type: String(source.type || 'single').trim(),
  };
}

/** 规范化可选的目标/科目/分类定义，非法项静默丢弃，不阻塞题目导入 */
function normalizeTaxonomy(input) {
  if (!isPlainObject(input)) return null;

  const tracks = (Array.isArray(input.tracks) ? input.tracks : []).slice(0, MAX_TRACKS)
    .map((item) => {
      const row = isPlainObject(item) ? item : {};
      return {
        key: safeKey(row.key),
        label: safeText(row.label, 40),
        shortLabel: safeText(row.shortLabel || row.label, 20),
        features: (Array.isArray(row.features) ? row.features : [])
          .map((feature) => safeText(feature, 24)).filter(Boolean).slice(0, 20),
        sort: safeInt(row.sort),
        enabled: row.enabled !== false,
      };
    })
    .filter((row) => row.key && row.label);

  const trackKeys = new Set(tracks.map((row) => row.key));
  const subjects = (Array.isArray(input.subjects) ? input.subjects : []).slice(0, MAX_SUBJECTS)
    .map((item) => {
      const row = isPlainObject(item) ? item : {};
      return {
        key: safeKey(row.key),
        trackKey: safeKey(row.trackKey || row.track_key),
        label: safeText(row.label, 40),
        emptySubject: Boolean(row.emptySubject || row.empty_subject),
        sort: safeInt(row.sort),
      };
    })
    .filter((row) => row.key && row.label && trackKeys.has(row.trackKey));

  const subjectKeys = new Set(subjects.map((row) => row.key));
  const categories = (Array.isArray(input.categories) ? input.categories : []).slice(0, MAX_CATEGORIES)
    .map((item) => {
      const row = isPlainObject(item) ? item : {};
      return {
        subjectKey: safeKey(row.subjectKey || row.subject_key),
        key: safeKey(row.key),
        name: safeText(row.name, 40),
        color: safeText(row.color, 60) || 'var(--accent)',
        sort: safeInt(row.sort),
      };
    })
    .filter((row) => row.key && row.name && subjectKeys.has(row.subjectKey));

  if (!tracks.length && !subjects.length && !categories.length) return null;
  return { tracks, subjects, categories };
}

/**
 * 导出时收集与本包题目相关的目标/科目/分类。
 * 只带 papers 里实际用到的科目，不把导出者其它目标全带出去。
 */
function buildTaxonomy(papers, trackConfig) {
  if (!trackConfig || typeof trackConfig.listTrackConfig !== 'function') return null;
  let cfg;
  try {
    cfg = trackConfig.listTrackConfig();
  } catch (error) {
    return null;
  }

  const subjectKeys = new Set(
    (Array.isArray(papers) ? papers : [])
      .map((paper) => safeText(paper && paper.subject, 64) || 'xingce')
  );

  const subjects = (cfg.subjects || [])
    .filter((subject) => subjectKeys.has(subject.key))
    .map((subject) => ({
      key: subject.key,
      trackKey: subject.trackKey,
      label: subject.label,
      emptySubject: Boolean(subject.emptySubject),
      sort: subject.sort,
    }));

  const trackKeys = new Set(subjects.map((subject) => subject.trackKey));
  const tracks = (cfg.tracks || [])
    .filter((track) => trackKeys.has(track.key))
    .map((track) => ({
      key: track.key,
      label: track.label,
      shortLabel: track.shortLabel,
      features: Array.isArray(track.features) ? track.features : [],
      sort: track.sort,
      enabled: track.enabled !== false,
    }));

  const categories = (cfg.categories || [])
    .filter((category) => subjectKeys.has(category.subjectKey))
    .map((category) => ({
      subjectKey: category.subjectKey,
      key: category.key,
      name: category.name,
      color: category.color,
      sort: category.sort,
    }));

  return normalizeTaxonomy({ tracks, subjects, categories });
}

/**
 * 导入时补齐缺失的目标 / 科目 / 分类。
 * 只新增，不覆盖接收方已有的同名配置，也不删除任何东西。
 */
function applyTaxonomy(pack, trackConfig) {
  const result = { tracks: 0, subjects: 0, categories: 0, errors: [] };
  const taxonomy = pack && pack.taxonomy;
  if (!taxonomy || !trackConfig || typeof trackConfig.listTrackConfig !== 'function') return result;

  let existing;
  try {
    existing = trackConfig.listTrackConfig();
  } catch (error) {
    result.errors.push(`读取现有目标失败：${error.message}`);
    return result;
  }

  const trackKeys = new Set((existing.tracks || []).map((row) => row.key));
  const subjectKeys = new Set((existing.subjects || []).map((row) => row.key));
  const categoryKeys = new Set((existing.categories || []).map((row) => `${row.subjectKey}::${row.key}`));

  (taxonomy.tracks || []).forEach((row) => {
    if (trackKeys.has(row.key)) return;
    try {
      const saved = trackConfig.saveTrack({
        key: row.key, label: row.label, shortLabel: row.shortLabel,
        features: row.features, sort: row.sort, enabled: row.enabled,
      });
      if (saved && saved.success !== false) {
        trackKeys.add(row.key);
        result.tracks += 1;
      }
    } catch (error) {
      result.errors.push(`目标 ${row.key}: ${error.message}`);
    }
  });

  (taxonomy.subjects || []).forEach((row) => {
    if (subjectKeys.has(row.key) || !trackKeys.has(row.trackKey)) return;
    try {
      const saved = trackConfig.saveSubject({
        key: row.key, trackKey: row.trackKey, label: row.label,
        emptySubject: row.emptySubject, sort: row.sort,
      });
      if (saved && saved.success !== false) {
        subjectKeys.add(row.key);
        result.subjects += 1;
      }
    } catch (error) {
      result.errors.push(`科目 ${row.key}: ${error.message}`);
    }
  });

  (taxonomy.categories || []).forEach((row) => {
    const id = `${row.subjectKey}::${row.key}`;
    if (categoryKeys.has(id) || !subjectKeys.has(row.subjectKey)) return;
    try {
      const saved = trackConfig.saveCategory({
        subjectKey: row.subjectKey, key: row.key, name: row.name,
        color: row.color, sort: row.sort,
      });
      if (saved && saved.success !== false) {
        categoryKeys.add(id);
        result.categories += 1;
      }
    } catch (error) {
      result.errors.push(`分类 ${row.key}: ${error.message}`);
    }
  });

  return result;
}

/**
 * 校验并规范化题库包，返回 { valid, errors, pack }
 */
function validatePack(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ['文件不是一个合法的 JSON 对象'], pack: null };
  }
  if (String(input.schemaVersion || '') !== PACK_VERSION) {
    errors.push(`版本不匹配：需要 ${PACK_VERSION}，实际 ${input.schemaVersion || '(空)'}`);
  }

  const rawPapers = Array.isArray(input.papers) ? input.papers : [];
  if (!rawPapers.length) errors.push('题库包里没有试卷');

  const papers = [];
  let totalQuestions = 0;

  rawPapers.forEach((rawPaper, paperIndex) => {
    const paper = isPlainObject(rawPaper) ? rawPaper : {};
    const title = String(paper.title || '').trim();
    if (!title) {
      errors.push(`第 ${paperIndex + 1} 套试卷缺少标题`);
      return;
    }
    const questions = (Array.isArray(paper.questions) ? paper.questions : [])
      .map((question, index) => normalizeQuestion(question, index))
      .filter((question) => question.content && question.options.length >= 2);

    if (!questions.length) {
      errors.push(`试卷「${title}」没有可用题目（缺题干或选项少于 2 项）`);
      return;
    }

    const badAnswer = questions.filter((question) => !question.options.some((option) => option.key === question.answer));
    if (badAnswer.length) {
      errors.push(`试卷「${title}」有 ${badAnswer.length} 道题的答案不在选项中`);
      return;
    }

    totalQuestions += questions.length;
    papers.push({
      id: String(paper.id || `pack_${paperIndex + 1}`),
      title,
      year: Number(paper.year) || new Date().getFullYear(),
      type: String(paper.type || 'imported'),
      subject: String(paper.subject || '').trim(),
      questions,
    });
  });

  if (totalQuestions > MAX_QUESTIONS) {
    errors.push(`题目数量 ${totalQuestions} 超过单次导入上限 ${MAX_QUESTIONS}`);
  }

  const taxonomy = normalizeTaxonomy(input.taxonomy);
  return {
    valid: errors.length === 0,
    errors,
    pack: errors.length === 0
      ? { schemaVersion: PACK_VERSION, papers, totalQuestions, ...(taxonomy ? { taxonomy } : {}) }
      : null,
  };
}

module.exports = {
  PACK_VERSION,
  MAX_QUESTIONS,
  validatePack,
  normalizeQuestion,
  normalizeOptions,
  normalizeTaxonomy,
  buildTaxonomy,
  applyTaxonomy,
};
