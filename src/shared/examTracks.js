/**
 * 内置目标默认配置。
 *
 * 运行时真源是数据库（study_tracks / track_subjects / track_categories），
 * 这里只在「数据库还没加载完」或「脚本/纯前端环境」时兜底。
 * 新增目标请走设置页「目标管理」，不要再改这个文件。
 */

import { CATEGORY_META } from './categoryMeta.js';

const XINGCE_CATEGORIES = ['yanyu', 'shuliang', 'panduan', 'ziliao', 'changshi'];
const COMPUTER_CATEGORIES = ['cs_net', 'cs_base', 'cs_security', 'cs_os', 'cs_db', 'cs_prog'];

const FULL_FEATURES = ['today', 'practice', 'papers', 'essay', 'vocab', 'notes', 'wrong', 'analytics', 'ai', 'growth'];
const NO_ESSAY_FEATURES = ['today', 'practice', 'papers', 'notes', 'wrong', 'analytics', 'ai', 'growth'];

export const EXAM_TRACKS = [
  {
    key: 'gongkao',
    label: '公务员',
    shortLabel: '考公',
    subjects: ['xingce'],
    subjectLabels: { xingce: '行测' },
    defaultSubject: 'xingce',
    categories: XINGCE_CATEGORIES,
    features: FULL_FEATURES,
    sort: 10,
    builtin: true,
  },
  {
    key: 'shiye',
    label: '事业单位',
    shortLabel: '事业',
    subjects: ['shiye'],
    subjectLabels: { shiye: '职测/综合' },
    defaultSubject: 'shiye',
    categories: XINGCE_CATEGORIES,
    features: FULL_FEATURES,
    sort: 20,
    builtin: false,
  },
  {
    key: 'ruankao',
    label: '软考',
    shortLabel: '软考',
    subjects: ['computer'],
    subjectLabels: { computer: '网络工程师' },
    defaultSubject: 'computer',
    categories: COMPUTER_CATEGORIES,
    features: NO_ESSAY_FEATURES,
    sort: 30,
    builtin: false,
  },
];

/** 扁平结构，直接喂给 buildTracksConfig() 作为首屏兜底 */
export const BUILTIN_TRACK_CONFIG = {
  tracks: EXAM_TRACKS.map((track) => ({
    key: track.key,
    label: track.label,
    shortLabel: track.shortLabel,
    features: track.features,
    sort: track.sort,
    builtin: track.builtin,
  })),
  subjects: EXAM_TRACKS.flatMap((track) => track.subjects.map((key, index) => ({
    key,
    trackKey: track.key,
    label: track.subjectLabels[key] || key,
    emptySubject: track.key === 'gongkao' && key === 'xingce',
    sort: (index + 1) * 10,
    builtin: true,
    questionCount: 0,
  }))),
  categories: EXAM_TRACKS.flatMap((track) => track.categories.map((key, index) => ({
    key,
    subjectKey: track.defaultSubject,
    name: CATEGORY_META[key]?.name || key,
    color: CATEGORY_META[key]?.color || 'var(--accent)',
    sort: (index + 1) * 10,
    builtin: true,
  }))),
};

export const DEFAULT_TRACK_KEY = 'gongkao';

export const EXAM_TRACK_OPTIONS = EXAM_TRACKS.map((track) => ({
  value: track.key,
  label: track.label,
}));

export const EXAM_TRACK_KEYS = EXAM_TRACKS.map((track) => track.key);

export function getExamTrack(key) {
  const value = String(key || '').trim();
  return EXAM_TRACKS.find((track) => track.key === value) || EXAM_TRACKS[0];
}

export function normalizeExamTrack(value) {
  const key = String(value || '').trim();
  return key || DEFAULT_TRACK_KEY;
}

export function getExamTrackLabel(key, fallback = '公务员') {
  const track = EXAM_TRACKS.find((item) => item.key === String(key || '').trim());
  return track ? track.label : fallback;
}

export function getExamTrackShortLabel(key) {
  const track = getExamTrack(key);
  return track.shortLabel || track.label;
}

export function getTrackSubjects(key) {
  return getExamTrack(key).subjects.slice();
}

export function getTrackDefaultSubject(key) {
  return getExamTrack(key).defaultSubject;
}

export function getTrackCategories(key) {
  return getExamTrack(key).categories.slice();
}

export function hasBuiltinTrack(key) {
  return Boolean(getExamTrack(key).builtin);
}

/** 由 papers.subject 反查所属目标，用于统计分组（内置兜底版） */
export function getTrackForSubject(subject) {
  const value = String(subject || '').trim();
  if (!value) return DEFAULT_TRACK_KEY;
  const hit = EXAM_TRACKS.find((track) => track.subjects.includes(value));
  return hit ? hit.key : value;
}

/** 试卷是否属于某个目标（内置兜底版，subject 为空视为公务员） */
export function matchPaperTrack(paper, trackKey) {
  const key = normalizeExamTrack(trackKey);
  const subject = String(paper?.subject || '').trim();
  if (!subject) return key === DEFAULT_TRACK_KEY;
  return getTrackSubjects(key).includes(subject);
}

export function filterPapersByTrack(papers, trackKey) {
  const list = Array.isArray(papers) ? papers : [];
  return list.filter((paper) => matchPaperTrack(paper, trackKey));
}
