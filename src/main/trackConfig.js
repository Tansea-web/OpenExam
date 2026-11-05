/**
 * 学习目标配置：study_tracks / track_subjects / track_categories
 *
 * 「目标 → 科目 → 分类」三层结构，papers.subject 指向科目 key。
 * 内置三目标首次启动幂等写入，之后由用户在设置页维护，数据库是唯一真源。
 */

const FEATURE_KEYS = [
  'today',
  'practice',
  'papers',
  'essay',
  'vocab',
  'notes',
  'wrong',
  'analytics',
  'ai',
  'growth',
];

const GONGKAO_FEATURES = ['today', 'practice', 'papers', 'essay', 'vocab', 'notes', 'wrong', 'analytics', 'ai', 'growth'];
const RUANKAO_FEATURES = ['today', 'practice', 'papers', 'notes', 'wrong', 'analytics', 'ai', 'growth'];

const XINGCE_CATEGORIES = [
  { key: 'yanyu', name: '言语理解', color: 'var(--category-yanyu)', sort: 10 },
  { key: 'shuliang', name: '数量关系', color: 'var(--category-shuliang)', sort: 20 },
  { key: 'panduan', name: '判断推理', color: 'var(--category-panduan)', sort: 30 },
  { key: 'ziliao', name: '资料分析', color: 'var(--category-ziliao)', sort: 40 },
  { key: 'changshi', name: '常识判断', color: 'var(--category-changshi)', sort: 50 },
];

const COMPUTER_CATEGORIES = [
  { key: 'cs_net', name: '计算机网络', color: 'var(--info)', sort: 10 },
  { key: 'cs_base', name: '计算机基础', color: 'var(--category-ziliao)', sort: 20 },
  { key: 'cs_security', name: '网络安全', color: 'var(--danger)', sort: 30 },
  { key: 'cs_os', name: '操作系统', color: 'var(--category-panduan)', sort: 40 },
  { key: 'cs_db', name: '数据库', color: 'var(--success)', sort: 50 },
  { key: 'cs_prog', name: '程序设计', color: 'var(--category-yanyu)', sort: 60 },
  { key: 'cs_office', name: '办公软件', color: 'var(--category-shuliang)', sort: 70 },
];

const BUILTIN_TRACKS = [
  {
    key: 'gongkao',
    label: '公务员',
    shortLabel: '考公',
    features: GONGKAO_FEATURES,
    sort: 10,
    subjects: [
      {
        key: 'xingce',
        label: '行测',
        emptySubject: 1,
        sort: 10,
        categories: XINGCE_CATEGORIES,
      },
    ],
  },
  {
    key: 'shiye',
    label: '事业单位',
    shortLabel: '事业',
    features: GONGKAO_FEATURES,
    sort: 20,
    subjects: [
      {
        key: 'shiye',
        label: '职测/综合',
        emptySubject: 0,
        sort: 10,
        categories: XINGCE_CATEGORIES,
      },
    ],
  },
  {
    // 软考不是官方内置目标：用户可以改名、换科目，也可以整个删除
    key: 'ruankao',
    label: '软考',
    shortLabel: '软考',
    features: RUANKAO_FEATURES,
    sort: 30,
    builtin: 0,
    subjects: [
      {
        key: 'computer',
        label: '网络工程师',
        emptySubject: 0,
        sort: 10,
        builtin: 0,
        categories: COMPUTER_CATEGORIES.map((item) => ({ ...item, builtin: 0 })),
      },
    ],
  },
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS study_tracks (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    short_label TEXT,
    features TEXT,
    sort INTEGER DEFAULT 0,
    builtin INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS track_subjects (
    key TEXT PRIMARY KEY,
    track_key TEXT NOT NULL,
    label TEXT NOT NULL,
    empty_subject INTEGER DEFAULT 0,
    sort INTEGER DEFAULT 0,
    builtin INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_track_subjects_track ON track_subjects(track_key);

  CREATE TABLE IF NOT EXISTS track_categories (
    subject_key TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    question_kinds TEXT,
    sort INTEGER DEFAULT 0,
    builtin INTEGER DEFAULT 0,
    PRIMARY KEY (subject_key, key)
  );
  CREATE INDEX IF NOT EXISTS idx_track_categories_subject ON track_categories(subject_key);
`;

let db = null;

function normalizeFeatures(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || '').split(',');
  const seen = new Set();
  return list
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!FEATURE_KEYS.includes(item) || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function parseFeatures(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeFeatures(parsed);
  } catch (error) {
    return normalizeFeatures(raw);
  }
}

function mapTrack(row) {
  if (!row) return null;
  return {
    key: row.key,
    label: row.label,
    shortLabel: row.short_label || row.label,
    features: parseFeatures(row.features),
    sort: Number(row.sort) || 0,
    builtin: Boolean(row.builtin),
    enabled: row.enabled !== 0,
  };
}

function mapSubject(row) {
  if (!row) return null;
  return {
    key: row.key,
    trackKey: row.track_key,
    label: row.label,
    emptySubject: Boolean(row.empty_subject),
    sort: Number(row.sort) || 0,
    builtin: Boolean(row.builtin),
    questionCount: 0,
  };
}

// 分类支持的题型：客观题 / 主观题
const QUESTION_KINDS = ['objective', 'subjective'];

function normalizeQuestionKinds(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const result = [];
  list.forEach((item) => {
    const key = String(item || '').trim().toLowerCase();
    if (!QUESTION_KINDS.includes(key) || seen.has(key)) return;
    seen.add(key);
    result.push(key);
  });
  return result.length ? result : ['objective'];
}

function parseQuestionKinds(raw) {
  if (!raw) return ['objective'];
  try {
    return normalizeQuestionKinds(JSON.parse(raw));
  } catch (error) {
    return normalizeQuestionKinds(raw);
  }
}

function mapCategory(row) {
  if (!row) return null;
  return {
    key: row.key,
    subjectKey: row.subject_key,
    name: row.name,
    color: row.color || 'var(--accent)',
    questionKinds: parseQuestionKinds(row.question_kinds),
    sort: Number(row.sort) || 0,
    builtin: Boolean(row.builtin),
  };
}

function seedBuiltin() {
  const insertTrack = db.prepare(`
    INSERT OR IGNORE INTO study_tracks (key, label, short_label, features, sort, builtin, enabled)
    VALUES (@key, @label, @shortLabel, @features, @sort, @builtin, 1)
  `);
  const insertSubject = db.prepare(`
    INSERT OR IGNORE INTO track_subjects (key, track_key, label, empty_subject, sort, builtin)
    VALUES (@key, @trackKey, @label, @emptySubject, @sort, @builtin)
  `);
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO track_categories (subject_key, key, name, color, sort, builtin)
    VALUES (@subjectKey, @key, @name, @color, @sort, @builtin)
  `);

  db.transaction(() => {
    BUILTIN_TRACKS.forEach((track) => {
      insertTrack.run({
        key: track.key,
        label: track.label,
        shortLabel: track.shortLabel,
        features: JSON.stringify(track.features),
        sort: track.sort,
        builtin: track.builtin === 0 ? 0 : 1,
      });
      track.subjects.forEach((subject) => {
        insertSubject.run({
          key: subject.key,
          trackKey: track.key,
          label: subject.label,
          emptySubject: subject.emptySubject ? 1 : 0,
          sort: subject.sort,
          builtin: subject.builtin === 0 ? 0 : 1,
        });
        subject.categories.forEach((category) => {
          insertCategory.run({
            subjectKey: subject.key,
            key: category.key,
            name: category.name,
            color: category.color,
            sort: category.sort,
            builtin: category.builtin === 0 ? 0 : 1,
          });
        });
      });
    });
  })();
}

function initTrackConfig(database) {
  db = database;
  db.exec(SCHEMA);

  // 老库补列：分类支持哪些题型（objective / subjective）
  const categoryColumns = db.pragma('table_info(track_categories)');
  if (Array.isArray(categoryColumns) && categoryColumns.length
    && !categoryColumns.some((column) => column.name === 'question_kinds')) {
    db.exec('ALTER TABLE track_categories ADD COLUMN question_kinds TEXT');
  }

  seedBuiltin();

  // 历史库里软考曾被当作内置目标，放开为可编辑 / 可删除（builtin 是系统字段，用户改不了）
  db.prepare(`UPDATE study_tracks SET builtin = 0 WHERE key = 'ruankao' AND builtin = 1`).run();
  db.prepare(`UPDATE track_subjects SET builtin = 0 WHERE key = 'computer' AND builtin = 1`).run();
  db.prepare(`UPDATE track_categories SET builtin = 0 WHERE subject_key = 'computer' AND builtin = 1`).run();
}

function countSubjectPapers(subjectKey) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total FROM papers
    WHERE COALESCE(NULLIF(TRIM(subject), ''), 'xingce') = ?
  `).get(subjectKey);
  return Number(row?.total || 0);
}

function listTrackConfig() {
  const tracks = db.prepare('SELECT * FROM study_tracks ORDER BY sort ASC, created_at ASC').all().map(mapTrack);
  const subjects = db.prepare('SELECT * FROM track_subjects ORDER BY sort ASC, key ASC').all().map(mapSubject);
  const categories = db.prepare('SELECT * FROM track_categories ORDER BY sort ASC, key ASC').all().map(mapCategory);

  const counts = new Map(
    db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(subject), ''), 'xingce') AS subject, COUNT(*) AS total
      FROM papers GROUP BY subject
    `).all().map((row) => [row.subject, Number(row.total) || 0])
  );

  subjects.forEach((subject) => {
    // eslint-disable-next-line no-param-reassign
    subject.questionCount = counts.get(subject.key) || 0;
    // 科目可用题型 = 其下分类题型的并集
    const kinds = new Set();
    categories
      .filter((category) => category.subjectKey === subject.key)
      .forEach((category) => (category.questionKinds || ['objective']).forEach((kind) => kinds.add(kind)));
    // eslint-disable-next-line no-param-reassign
    subject.questionKinds = kinds.size ? [...kinds] : ['objective'];
  });

  return { tracks, subjects, categories };
}

function saveTrack(input = {}) {
  const label = String(input.label || '').trim();
  if (!label) return { success: false, error: 'EMPTY_LABEL' };

  const key = String(input.key || '').trim() || `track_${Date.now()}`;
  const features = normalizeFeatures(input.features);
  const existing = db.prepare('SELECT builtin FROM study_tracks WHERE key = ?').get(key);

  // 新目标默认排到最后，而不是插到最前；已有目标沿用传入的 sort
  let sortValue = Number(input.sort);
  if (!Number.isFinite(sortValue) || sortValue <= 0) {
    const row = db.prepare('SELECT COALESCE(MAX(sort), 0) AS maxSort FROM study_tracks').get();
    sortValue = (Number(row?.maxSort) || 0) + 10;
  }

  db.prepare(`
    INSERT INTO study_tracks (key, label, short_label, features, sort, builtin, enabled)
    VALUES (@key, @label, @shortLabel, @features, @sort, 0, @enabled)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label,
      short_label = excluded.short_label,
      features = excluded.features,
      sort = excluded.sort,
      enabled = excluded.enabled
  `).run({
    key,
    label,
    shortLabel: String(input.shortLabel || label).trim() || label,
    features: JSON.stringify(features),
    sort: sortValue,
    enabled: input.enabled === false ? 0 : 1,
  });

  return { success: true, track: mapTrack(db.prepare('SELECT * FROM study_tracks WHERE key = ?').get(key)), created: !existing };
}

function deleteTrack(key) {
  const track = db.prepare('SELECT * FROM study_tracks WHERE key = ?').get(key);
  if (!track) return { success: false, error: 'NOT_FOUND' };
  if (Number(track.builtin) === 1) return { success: false, error: 'BUILTIN_PROTECTED' };

  const subjects = db.prepare('SELECT * FROM track_subjects WHERE track_key = ?').all(key);
  const total = subjects.reduce((sum, subject) => sum + countSubjectPapers(subject.key), 0);
  if (total > 0) return { success: false, error: 'HAS_PAPERS', questionCount: total };

  db.transaction(() => {
    subjects.forEach((subject) => {
      db.prepare('DELETE FROM track_categories WHERE subject_key = ?').run(subject.key);
    });
    db.prepare('DELETE FROM track_subjects WHERE track_key = ?').run(key);
    db.prepare('DELETE FROM study_tracks WHERE key = ?').run(key);
  })();

  return { success: true };
}

function saveSubject(input = {}) {
  const label = String(input.label || '').trim();
  const trackKey = String(input.trackKey || '').trim();
  if (!label) return { success: false, error: 'EMPTY_LABEL' };
  if (!trackKey) return { success: false, error: 'EMPTY_TRACK' };
  if (!db.prepare('SELECT key FROM study_tracks WHERE key = ?').get(trackKey)) {
    return { success: false, error: 'TRACK_NOT_FOUND' };
  }

  const key = String(input.key || '').trim() || `sub_${Date.now()}`;
  const existing = db.prepare('SELECT builtin FROM track_subjects WHERE key = ?').get(key);

  db.prepare(`
    INSERT INTO track_subjects (key, track_key, label, empty_subject, sort, builtin)
    VALUES (@key, @trackKey, @label, @emptySubject, @sort, 0)
    ON CONFLICT(key) DO UPDATE SET
      track_key = excluded.track_key,
      label = excluded.label,
      empty_subject = excluded.empty_subject,
      sort = excluded.sort
  `).run({
    key,
    trackKey,
    label,
    emptySubject: input.emptySubject ? 1 : 0,
    sort: Number(input.sort) || 0,
  });

  return {
    success: true,
    subject: mapSubject(db.prepare('SELECT * FROM track_subjects WHERE key = ?').get(key)),
    created: !existing,
  };
}

function deleteSubject(key) {
  const subject = db.prepare('SELECT * FROM track_subjects WHERE key = ?').get(key);
  if (!subject) return { success: false, error: 'NOT_FOUND' };
  if (Number(subject.builtin) === 1) return { success: false, error: 'BUILTIN_PROTECTED' };

  const questionCount = countSubjectPapers(key);
  if (questionCount > 0) return { success: false, error: 'HAS_PAPERS', questionCount };

  db.transaction(() => {
    db.prepare('DELETE FROM track_categories WHERE subject_key = ?').run(key);
    db.prepare('DELETE FROM track_subjects WHERE key = ?').run(key);
  })();

  return { success: true };
}

function saveCategory(input = {}) {
  const name = String(input.name || '').trim();
  const subjectKey = String(input.subjectKey || '').trim();
  if (!name) return { success: false, error: 'EMPTY_LABEL' };
  if (!subjectKey) return { success: false, error: 'EMPTY_SUBJECT' };
  if (!db.prepare('SELECT key FROM track_subjects WHERE key = ?').get(subjectKey)) {
    return { success: false, error: 'SUBJECT_NOT_FOUND' };
  }

  const key = String(input.key || '').trim() || `cat_${Date.now()}`;
  const existing = db.prepare('SELECT builtin FROM track_categories WHERE subject_key = ? AND key = ?').get(subjectKey, key);

  db.prepare(`
    INSERT INTO track_categories (subject_key, key, name, color, question_kinds, sort, builtin)
    VALUES (@subjectKey, @key, @name, @color, @questionKinds, @sort, 0)
    ON CONFLICT(subject_key, key) DO UPDATE SET
      name = excluded.name,
      color = excluded.color,
      question_kinds = excluded.question_kinds,
      sort = excluded.sort
  `).run({
    subjectKey,
    key,
    name,
    color: String(input.color || '').trim() || 'var(--accent)',
    questionKinds: JSON.stringify(normalizeQuestionKinds(input.questionKinds || input.question_kinds)),
    sort: Number(input.sort) || 0,
  });

  return {
    success: true,
    category: mapCategory(
      db.prepare('SELECT * FROM track_categories WHERE subject_key = ? AND key = ?').get(subjectKey, key)
    ),
    created: !existing,
  };
}

function deleteCategory(subjectKey, key) {
  const row = db.prepare('SELECT * FROM track_categories WHERE subject_key = ? AND key = ?').get(subjectKey, key);
  if (!row) return { success: false, error: 'NOT_FOUND' };

  // 分类只删配置，题目保留；前端会退回显示分类 key
  db.prepare('DELETE FROM track_categories WHERE subject_key = ? AND key = ?').run(subjectKey, key);
  return { success: true };
}

module.exports = {
  FEATURE_KEYS,
  QUESTION_KINDS,
  normalizeQuestionKinds,
  BUILTIN_TRACKS,
  initTrackConfig,
  listTrackConfig,
  saveTrack,
  deleteTrack,
  saveSubject,
  deleteSubject,
  saveCategory,
  deleteCategory,
  countSubjectPapers,
};
