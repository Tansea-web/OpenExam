import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialog } from './DialogProvider.jsx';

const FEATURE_LABELS = {
  today: '今日待办',
  practice: '题库练习',
  papers: '模拟考试',
  essay: '申论',
  vocab: '词语积累',
  notes: '笔记',
  wrong: '错题本',
  analytics: '分析报告',
  ai: 'AI 老师',
  growth: '成长成就',
};

const DEFAULT_FEATURES = ['today', 'practice', 'papers', 'notes', 'wrong', 'analytics', 'ai', 'growth'];

const cardStyle = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: 'var(--surface)',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const inputStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--surface-soft)',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
};

const primaryBtn = {
  padding: '7px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostBtn = {
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--muted)',
  fontSize: 11.5,
  cursor: 'pointer',
};

const dangerBtn = {
  ...ghostBtn,
  borderColor: 'var(--danger-border)',
  color: 'var(--danger)',
};

function FeatureChips({ value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {Object.entries(FEATURE_LABELS).map(([key, label]) => {
        const active = selected.includes(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              const next = active ? selected.filter((item) => item !== key) : [...selected, key];
              onChange(next);
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11.5,
              cursor: 'pointer',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
              background: active ? 'var(--accent-soft-bg)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function TrackManager({ onChange }) {
  const dialog = useDialog();
  const [data, setData] = useState({ tracks: [], subjects: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTrack, setActiveTrack] = useState('');
  const [trackDraft, setTrackDraft] = useState(null);
  const [subjectDraft, setSubjectDraft] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState({});
  const [busy, setBusy] = useState('');

  const db = window.openexam?.db;

  // onChange 来自父组件的箭头函数，每次渲染都是新引用；放进 ref 避免 refresh 反复重建
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const refresh = useCallback(async () => {
    if (!db?.listTrackConfig) {
      setLoading(false);
      setError('当前环境不支持目标配置（需要桌面端）');
      return;
    }
    try {
      const raw = await db.listTrackConfig();
      setData({
        tracks: raw?.tracks || [],
        subjects: raw?.subjects || [],
        categories: raw?.categories || [],
      });
      onChangeRef.current?.(raw);
      setError('');
    } catch (err) {
      setError(err?.message || '目标配置读取失败');
    }
    setLoading(false);
  }, [db]);

  useEffect(() => { refresh(); }, [refresh]);

  const subjectsByTrack = useMemo(() => {
    const map = new Map();
    data.subjects.forEach((subject) => {
      const list = map.get(subject.trackKey) || [];
      list.push(subject);
      map.set(subject.trackKey, list);
    });
    return map;
  }, [data.subjects]);

  const categoriesBySubject = useMemo(() => {
    const map = new Map();
    data.categories.forEach((category) => {
      const list = map.get(category.subjectKey) || [];
      list.push(category);
      map.set(category.subjectKey, list);
    });
    return map;
  }, [data.categories]);

  const showFailure = async (result, fallback) => {
    if (result?.success) return true;
    const errorCode = result?.error || '';
    let message = fallback;
    if (errorCode === 'BUILTIN_PROTECTED') message = '内置项不能删除，只能改名或调整分类。';
    else if (errorCode === 'HAS_PAPERS') message = `该科目下还有 ${result?.questionCount || 0} 套试卷，请先迁移或删除这些试卷。`;
    else if (errorCode === 'EMPTY_LABEL') message = '名称不能为空。';
    else if (errorCode === 'TRACK_NOT_FOUND') message = '目标不存在，请刷新后重试。';
    else if (errorCode === 'SUBJECT_NOT_FOUND') message = '科目不存在，请刷新后重试。';
    await dialog.alert({ title: '操作未完成', message, tone: 'warning' });
    return false;
  };

  const runAction = async (key, action, fallback) => {
    setBusy(key);
    try {
      const result = await action();
      const ok = await showFailure(result, fallback);
      if (ok) await refresh();
      return ok;
    } catch (err) {
      await dialog.alert({ title: '操作失败', message: err?.message || fallback, tone: 'danger' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const startNewTrack = () => {
    setTrackDraft({ key: '', label: '', shortLabel: '', features: [...DEFAULT_FEATURES] });
    setSubjectDraft(null);
  };

  const submitTrack = async () => {
    if (!trackDraft) return;
    const label = trackDraft.label.trim();
    if (!label) {
      await dialog.alert({ title: '还差个名字', message: '目标名称不能为空。', tone: 'warning' });
      return;
    }
    const ok = await runAction(
      `track:${trackDraft.key || 'new'}`,
      () => db.saveTrack({
        key: trackDraft.key || undefined,
        label,
        shortLabel: trackDraft.shortLabel.trim() || label,
        features: trackDraft.features,
        sort: trackDraft.sort,
      }),
      '目标保存失败'
    );
    if (ok) {
      setTrackDraft(null);
      await dialog.toast?.({ title: '已保存', message: `目标「${label}」已更新`, tone: 'success' });
    }
  };

  const removeTrack = async (track) => {
    const confirmed = await dialog.confirm({
      title: `删除目标「${track.label}」`,
      message: '该目标下的科目与分类配置会一起删除，题库里的试卷不受影响。',
      confirmText: '确认删除',
      cancelText: '再想想',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runAction(`track-del:${track.key}`, () => db.deleteTrack(track.key), '删除失败');
  };

  // 目标排序：与相邻项交换 sort，并把整张列表规整成 10 的倍数，避免同值导致顺序抖动
  const moveTrack = async (track, direction) => {
    const list = Array.isArray(data.tracks) ? [...data.tracks] : [];
    const index = list.findIndex((item) => item.key === track.key);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= list.length) return;

    const ordered = list.map((item, idx) => ({ key: item.key, sort: (idx + 1) * 10 }));
    // 交换「位置」而不是对象本身：只把两者 sort 值对调，否则 key→sort 映射不变
    const swappedSort = ordered[index].sort;
    ordered[index].sort = ordered[swapIndex].sort;
    ordered[swapIndex].sort = swappedSort;

    const busyKey = `track-move:${track.key}`;
    setBusy(busyKey);
    try {
      for (const { key, sort } of ordered) {
        const item = list.find((entry) => entry.key === key);
        if (!item) continue;
        await db.saveTrack({
          key,
          label: item.label,
          shortLabel: item.shortLabel,
          features: item.features,
          enabled: item.enabled,
          sort,
        });
      }
      // refresh 内部会把最新配置回传给父组件，这里不要再无参调用 onChange
      await refresh();
    } catch (error) {
      await dialog.alert({ title: '排序失败', message: error?.message || '请稍后重试', tone: 'warning' });
    } finally {
      setBusy('');
    }
  };

  const submitSubject = async () => {
    if (!subjectDraft) return;
    const label = subjectDraft.label.trim();
    if (!label) {
      await dialog.alert({ title: '还差个名字', message: '科目名称不能为空。', tone: 'warning' });
      return;
    }
    const ok = await runAction(
      `subject:${subjectDraft.key || 'new'}`,
      () => db.saveTrackSubject({
        key: subjectDraft.key || undefined,
        trackKey: subjectDraft.trackKey,
        label,
        emptySubject: subjectDraft.emptySubject,
        sort: subjectDraft.sort,
      }),
      '科目保存失败'
    );
    if (ok) setSubjectDraft(null);
  };

  const removeSubject = async (subject) => {
    const confirmed = await dialog.confirm({
      title: `删除科目「${subject.label}」`,
      message: '科目下的分类配置会一起删除。若该科目还有试卷，系统会阻止删除。',
      confirmText: '确认删除',
      cancelText: '再想想',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runAction(`subject-del:${subject.key}`, () => db.deleteTrackSubject(subject.key), '删除失败');
  };

  const submitCategory = async (subject) => {
    const name = String(categoryDraft[subject.key] || '').trim();
    if (!name) return;
    const ok = await runAction(
      `cat:${subject.key}`,
      () => db.saveTrackCategory({ subjectKey: subject.key, name }),
      '分类保存失败'
    );
    if (ok) setCategoryDraft((prev) => ({ ...prev, [subject.key]: '' }));
  };

  // 分类是否支持主观题：一键切换（客观题始终保留）
  const toggleCategoryKind = async (subject, category) => {
    const current = Array.isArray(category.questionKinds) ? category.questionKinds : ['objective'];
    const hasSubjective = current.includes('subjective');
    const next = hasSubjective
      ? current.filter((item) => item !== 'subjective')
      : [...current, 'subjective'];
    await runAction(
      `cat-kind:${subject.key}:${category.key}`,
      () => db.saveTrackCategory({
        subjectKey: subject.key,
        key: category.key,
        name: category.name,
        color: category.color,
        questionKinds: next.length ? next : ['objective'],
      }),
      '题型设置失败'
    );
  };

  const removeCategory = async (subject, category) => {
    const ok = await runAction(
      `cat-del:${subject.key}:${category.key}`,
      () => db.deleteTrackCategory(subject.key, category.key),
      '分类删除失败'
    );
    if (ok && category.builtin) {
      await dialog.alert({
        title: '分类已移除',
        message: '该分类下已有题目的分类名会退回显示分类代码，重新导入可恢复。',
        tone: 'info',
      });
    }
  };

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--muted)' }}>目标配置加载中…</div>;
  }

  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>目标管理</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, margin: 0 }}>
          目标决定题库、菜单和统计口径。每个目标下可以有多个科目（如软考的网络工程师、软件设计师），
          题目按科目归集，分类决定练习页的分组。内置目标不能删除，但可以改名和调整分类。
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.tracks.map((track, trackIndex) => {
          const subjects = subjectsByTrack.get(track.key) || [];
          const totalQuestions = subjects.reduce((sum, subject) => sum + (subject.questionCount || 0), 0);
          const expanded = activeTrack === track.key;
          const editing = trackDraft && trackDraft.key === track.key;

          return (
            <div key={track.key} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{track.label}</strong>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{track.shortLabel}</span>
                    {track.builtin && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--neutral-soft-bg)', color: 'var(--muted)' }}>
                        内置
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                    {subjects.length} 个科目 · {totalQuestions.toLocaleString()} 套试卷 · {track.features.length} 个模块
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    style={{ ...ghostBtn, padding: '2px 8px', fontSize: 12, lineHeight: 1.4 }}
                    disabled={trackIndex === 0 || busy === `track-move:${track.key}`}
                    onClick={() => moveTrack(track, -1)}
                    title="上移"
                    aria-label="上移"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    style={{ ...ghostBtn, padding: '2px 8px', fontSize: 12, lineHeight: 1.4 }}
                    disabled={trackIndex === data.tracks.length - 1 || busy === `track-move:${track.key}`}
                    onClick={() => moveTrack(track, 1)}
                    title="下移"
                    aria-label="下移"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    style={ghostBtn}
                    onClick={() => {
                      setActiveTrack(expanded ? '' : track.key);
                      setSubjectDraft(null);
                    }}
                  >
                    {expanded ? '收起' : '科目与分类'}
                  </button>
                  <button
                    type="button"
                    style={ghostBtn}
                    disabled={busy === `track:${track.key}`}
                    onClick={() => {
                      setTrackDraft({
                        key: track.key,
                        label: track.label,
                        shortLabel: track.shortLabel,
                        features: [...track.features],
                        sort: track.sort,
                      });
                      setSubjectDraft(null);
                    }}
                  >
                    编辑
                  </button>
                  {!track.builtin && (
                    <button type="button" style={dangerBtn} onClick={() => removeTrack(track)}>删除</button>
                  )}
                </div>
              </div>

              {editing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                      名称
                      <input
                        value={trackDraft.label}
                        onChange={(e) => setTrackDraft((prev) => ({ ...prev, label: e.target.value }))}
                        style={{ ...inputStyle, width: 180 }}
                        placeholder="例如：法律职业资格"
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                      简称
                      <input
                        value={trackDraft.shortLabel}
                        onChange={(e) => setTrackDraft((prev) => ({ ...prev, shortLabel: e.target.value }))}
                        style={{ ...inputStyle, width: 120 }}
                        placeholder="法考"
                      />
                    </label>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>功能模块</div>
                    <FeatureChips
                      value={trackDraft.features}
                      onChange={(features) => setTrackDraft((prev) => ({ ...prev, features }))}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={primaryBtn} onClick={submitTrack}>保存</button>
                    <button type="button" style={ghostBtn} onClick={() => setTrackDraft(null)}>取消</button>
                  </div>
                </div>
              )}

              {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
                  {subjects.map((subject) => {
                    const categories = categoriesBySubject.get(subject.key) || [];
                    const subjectEditing = subjectDraft && subjectDraft.key === subject.key;
                    return (
                      <div key={subject.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <strong style={{ fontSize: 12.5, color: 'var(--text)' }}>{subject.label}</strong>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {subject.questionCount.toLocaleString()} 套试卷 · {categories.length} 个分类
                            </span>
                            {subject.builtin && (
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--neutral-soft-bg)', color: 'var(--muted)' }}>
                                内置
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              style={ghostBtn}
                              onClick={() => setSubjectDraft({
                                key: subject.key,
                                trackKey: subject.trackKey,
                                label: subject.label,
                                emptySubject: subject.emptySubject,
                                sort: subject.sort,
                              })}
                            >
                              编辑
                            </button>
                            {!subject.builtin && (
                              <button type="button" style={dangerBtn} onClick={() => removeSubject(subject)}>删除</button>
                            )}
                          </div>
                        </div>

                        {subjectEditing && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                              科目名称
                              <input
                                value={subjectDraft.label}
                                onChange={(e) => setSubjectDraft((prev) => ({ ...prev, label: e.target.value }))}
                                style={{ ...inputStyle, width: 180 }}
                              />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                              <input
                                type="checkbox"
                                checked={Boolean(subjectDraft.emptySubject)}
                                onChange={(e) => setSubjectDraft((prev) => ({ ...prev, emptySubject: e.target.checked }))}
                              />
                              题库 subject 为空时也归到该科目
                            </label>
                            <button type="button" style={primaryBtn} onClick={submitSubject}>保存</button>
                            <button type="button" style={ghostBtn} onClick={() => setSubjectDraft(null)}>取消</button>
                          </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {categories.map((category) => (
                            <span
                              key={category.key}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 8px',
                                borderRadius: 999,
                                border: '1px solid var(--line)',
                                fontSize: 11.5,
                                color: 'var(--text)',
                                background: 'var(--surface-soft)',
                              }}
                            >
                              <span style={{ width: 7, height: 7, borderRadius: 999, background: category.color || 'var(--accent)' }} />
                              {category.name}
                              <button
                                type="button"
                                onClick={() => toggleCategoryKind(subject, category)}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  padding: 0,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  color: (category.questionKinds || []).includes('subjective') ? 'var(--accent)' : 'var(--muted)',
                                }}
                                title={(category.questionKinds || []).includes('subjective') ? '已启用主观题，点击关闭' : '标记为可出主观题'}
                              >
                                主观
                              </button>
                              <button
                                type="button"
                                onClick={() => removeCategory(subject, category)}
                                style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                                title="删除分类"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              value={categoryDraft[subject.key] || ''}
                              onChange={(e) => setCategoryDraft((prev) => ({ ...prev, [subject.key]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') submitCategory(subject); }}
                              placeholder="新增分类"
                              style={{ ...inputStyle, width: 130 }}
                            />
                            <button type="button" style={ghostBtn} onClick={() => submitCategory(subject)}>添加</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {subjectDraft && subjectDraft.key === 'new' && subjectDraft.trackKey === track.key && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                        科目名称
                        <input
                          value={subjectDraft.label}
                          onChange={(e) => setSubjectDraft((prev) => ({ ...prev, label: e.target.value }))}
                          placeholder="软件设计师"
                          style={{ ...inputStyle, width: 180 }}
                        />
                      </label>
                      <button type="button" style={primaryBtn} onClick={submitSubject}>创建科目</button>
                      <button type="button" style={ghostBtn} onClick={() => setSubjectDraft(null)}>取消</button>
                    </div>
                  )}

                  <button
                    type="button"
                    style={{ ...ghostBtn, alignSelf: 'flex-start' }}
                    onClick={() => setSubjectDraft({ key: 'new', trackKey: track.key, label: '', emptySubject: false })}
                  >
                    + 新增科目
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {trackDraft && trackDraft.key === '' && (
        <div style={cardStyle}>
          <strong style={{ fontSize: 13 }}>新增目标</strong>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
              名称
              <input
                value={trackDraft.label}
                onChange={(e) => setTrackDraft((prev) => ({ ...prev, label: e.target.value }))}
                placeholder="例如：法律职业资格"
                style={{ ...inputStyle, width: 180 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
              简称
              <input
                value={trackDraft.shortLabel}
                onChange={(e) => setTrackDraft((prev) => ({ ...prev, shortLabel: e.target.value }))}
                placeholder="法考"
                style={{ ...inputStyle, width: 120 }}
              />
            </label>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>功能模块</div>
            <FeatureChips
              value={trackDraft.features}
              onChange={(features) => setTrackDraft((prev) => ({ ...prev, features }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={primaryBtn} onClick={submitTrack}>创建目标</button>
            <button type="button" style={ghostBtn} onClick={() => setTrackDraft(null)}>取消</button>
          </div>
        </div>
      )}

      {!trackDraft && (
        <button type="button" style={{ ...ghostBtn, alignSelf: 'flex-start' }} onClick={startNewTrack}>
          + 新增目标
        </button>
      )}
    </div>
  );
}
