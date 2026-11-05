/**
 * 目标配置的解析层（纯函数，无副作用）
 *
 * 真源是数据库里的 study_tracks / track_subjects / track_categories，
 * 渲染层启动时拉一次，构建索引后到处复用；这里只做纯计算，方便测试与兜底。
 */

import { CATEGORY_META } from './categoryMeta.js';

export const FEATURE_KEYS = [
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

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      return value.split(',');
    }
    return value.split(',');
  }
  return [];
}

function normalizeTrack(track = {}) {
  const features = toArray(track.features)
    .map((item) => String(item || '').trim())
    .filter((item) => FEATURE_KEYS.includes(item));
  return {
    key: String(track.key || '').trim(),
    label: String(track.label || track.key || '').trim(),
    shortLabel: String(track.shortLabel || track.short_label || track.label || track.key || '').trim(),
    features,
    sort: Number(track.sort) || 0,
    builtin: Boolean(track.builtin),
    enabled: track.enabled !== false && track.enabled !== 0,
  };
}

const QUESTION_KINDS = ['objective', 'subjective'];

function normalizeKinds(input) {
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

function normalizeSubject(subject = {}) {
  return {
    key: String(subject.key || '').trim(),
    trackKey: String(subject.trackKey || subject.track_key || '').trim(),
    label: String(subject.label || subject.key || '').trim(),
    emptySubject: Boolean(subject.emptySubject ?? subject.empty_subject),
    sort: Number(subject.sort) || 0,
    builtin: Boolean(subject.builtin),
    questionCount: Number(subject.questionCount || subject.question_count || 0) || 0,
    questionKinds: normalizeKinds(subject.questionKinds || subject.question_kinds),
  };
}

function normalizeCategory(category = {}) {
  return {
    key: String(category.key || '').trim(),
    subjectKey: String(category.subjectKey || category.subject_key || '').trim(),
    name: String(category.name || category.key || '').trim(),
    color: String(category.color || '').trim(),
    questionKinds: normalizeKinds(category.questionKinds || category.question_kinds),
    sort: Number(category.sort) || 0,
    builtin: Boolean(category.builtin),
  };
}

export function buildTracksConfig(raw = {}) {
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map(normalizeTrack).filter((item) => item.key);
  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : []).map(normalizeSubject).filter((item) => item.key);
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).map(normalizeCategory).filter((item) => item.key);

  tracks.sort((a, b) => a.sort - b.sort);
  subjects.sort((a, b) => a.sort - b.sort);
  categories.sort((a, b) => a.sort - b.sort);

  const subjectsByTrack = new Map();
  subjects.forEach((subject) => {
    const list = subjectsByTrack.get(subject.trackKey) || [];
    list.push(subject);
    subjectsByTrack.set(subject.trackKey, list);
  });

  const categoriesBySubject = new Map();
  categories.forEach((category) => {
    const list = categoriesBySubject.get(category.subjectKey) || [];
    list.push(category);
    categoriesBySubject.set(category.subjectKey, list);
  });

  return {
    tracks,
    subjects,
    categories,
    trackByKey: new Map(tracks.map((track) => [track.key, track])),
    subjectsByTrack,
    categoriesBySubject,
  };
}

export function resolveTrack(config, trackKey) {
  if (!config) return null;
  return config.trackByKey?.get(trackKey) || null;
}

export function resolveTrackLabel(config, trackKey, fallback = '未分类') {
  return resolveTrack(config, trackKey)?.label || fallback;
}

export function resolveSubjects(config, trackKey) {
  if (!config) return [];
  return config.subjectsByTrack?.get(trackKey) || [];
}

export function resolveSubjectKeys(config, trackKey) {
  return resolveSubjects(config, trackKey).map((subject) => subject.key);
}

export function getTrackDefaultSubject(config, trackKey) {
  const subjects = resolveSubjects(config, trackKey);
  return subjects[0]?.key || '';
}

export function resolveCategories(config, subjectKey) {
  if (!config || !subjectKey) return [];
  return config.categoriesBySubject?.get(subjectKey) || [];
}

export function getTrackCategories(config, trackKey) {
  const subjects = resolveSubjects(config, trackKey);
  const keys = [];
  subjects.forEach((subject) => {
    resolveCategories(config, subject.key).forEach((category) => {
      if (!keys.includes(category.key)) keys.push(category.key);
    });
  });
  return keys;
}

export function getTrackCategoryItems(config, trackKey) {
  const items = [];
  resolveSubjects(config, trackKey).forEach((subject) => {
    resolveCategories(config, subject.key).forEach((category) => {
      if (!items.some((item) => item.key === category.key)) items.push(category);
    });
  });
  return items;
}

export function getTrackFeatures(config, trackKey) {
  return resolveTrack(config, trackKey)?.features || [];
}

export function hasTrackFeature(config, trackKey, feature) {
  return getTrackFeatures(config, trackKey).includes(feature);
}

export function matchPaperTrack(paper, config, trackKey) {
  const subjects = resolveSubjects(config, trackKey);
  if (!subjects.length) return false;
  const subject = String(paper?.subject || '').trim();
  return subjects.some((item) => (item.emptySubject && !subject) || item.key === subject);
}

export function getCategoryDisplay(config, categoryKey) {
  const key = String(categoryKey || '').trim();
  if (!key) return { key: '', name: '未分类', color: 'var(--muted)' };

  if (config?.categories) {
    const found = config.categories.find((item) => item.key === key);
    if (found) return { key, name: found.name || key, color: found.color || 'var(--accent)' };
  }

  const builtin = CATEGORY_META[key];
  if (builtin) return { key, name: builtin.name, color: builtin.color };

  return { key, name: key, color: 'var(--accent)' };
}

export function getCategoryNameFromConfig(config, categoryKey) {
  return getCategoryDisplay(config, categoryKey).name;
}

export function getTrackSubjectLabel(config, subjectKey) {
  const subject = config?.subjects?.find((item) => item.key === subjectKey);
  return subject?.label || subjectKey;
}

export function getTrackTotalQuestions(config, trackKey) {
  return resolveSubjects(config, trackKey).reduce((sum, subject) => sum + (subject.questionCount || 0), 0);
}
