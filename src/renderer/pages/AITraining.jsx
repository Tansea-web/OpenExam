import React, { useEffect, useMemo, useState } from 'react';
import RichQuestionContent from '../components/RichQuestionContent.jsx';
import { useDialog } from '../components/DialogProvider.jsx';
import { getAISettings, isAIConfigured } from '../store/aiSettings.js';

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

function parseOptions(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export default function AITraining({ source, onBack }) {
  const dialog = useDialog();
  const [sourceQuestion, setSourceQuestion] = useState(source || null);
  const [variant, setVariant] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [picked, setPicked] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [records, setRecords] = useState([]);

  const loadRecords = async () => {
    if (!window.openexam?.db?.getTrainingAttempts) return;
    try {
      const rows = await window.openexam.db.getTrainingAttempts(10);
      setRecords(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('读取训练记录失败:', err);
    }
  };

  useEffect(() => { loadRecords(); }, []);

  const sourceOptions = useMemo(() => parseOptions(sourceQuestion?.options), [sourceQuestion]);
  const correct = String(variant?.answer || '').trim();
  const isCorrect = submitted && picked && picked === correct;

  const generate = async () => {
    if (!sourceQuestion?.content) {
      setError('先选一道错题，或从错题本点「变式训练」进来');
      return;
    }
    if (!isAIConfigured()) {
      await dialog.alert({ title: '先配置 AI', message: '变式训练需要 AI，到「设置 → AI 模型」填好 API Key 再试。', tone: 'warning' });
      return;
    }
    setBusy('generate');
    setError('');
    setVariant(null);
    setReview(null);
    setPicked('');
    setSubmitted(false);
    try {
      const settings = getAISettings();
      const created = await window.openexam.ai.createVariant(settings, {
        content: sourceQuestion.content,
        options: sourceOptions,
        answer: sourceQuestion.answer || '',
        analysis: sourceQuestion.analysis || '',
      });
      if (!created?.success) {
        setError(created?.error || '生成失败，请重试');
        return;
      }
      const reviewed = await window.openexam.ai.reviewVariant(settings, created.variant);
      const nextVariant = created.variant;
      if (reviewed?.fixedAnswer) nextVariant.answer = reviewed.fixedAnswer;
      setVariant(nextVariant);
      setReview(reviewed);
    } catch (err) {
      setError(err?.message || '生成失败');
    }
    setBusy('');
  };

  const submit = async () => {
    if (!picked || !variant) return;
    setSubmitted(true);
    const correctFlag = picked === correct;
    try {
      await window.openexam.db.saveTrainingAttempt({
        sourceQuestionId: sourceQuestion?.id || '',
        sourceContent: sourceQuestion?.content || '',
        variantContent: variant.content,
        variantOptions: variant.options,
        variantAnswer: correct,
        variantAnalysis: variant.analysis,
        reviewPassed: review?.pass !== false,
        reviewNote: (review?.issues || []).join('；'),
        userAnswer: picked,
        isCorrect: correctFlag,
      });
      loadRecords();
    } catch (err) {
      console.error('保存训练记录失败:', err);
    }
  };

  return (
    <div
      className="page-view"
      style={{ padding: '0 4px', height: '100%', minHeight: 0, overflowY: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', padding: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回
          </button>
        )}
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>AI 变式训练</h2>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>同考点、换情境，练到会为止</span>
      </div>

      {!sourceQuestion ? (
        <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 20, fontSize: 12, color: 'var(--muted)' }}>
          从「错题本」里点任意一道错题的「变式训练」，就会带着原题进来。
        </div>
      ) : (
        <>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>原题</div>
            <RichQuestionContent value={sourceQuestion.content} style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text)' }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={generate}
                disabled={busy === 'generate'}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
              >
                {busy === 'generate' ? '生成中…' : variant ? '换一道' : '生成变式题'}
              </button>
              {review && (
                <span style={{ fontSize: 11, color: review.pass ? 'var(--success)' : 'var(--warning)' }}>
                  {review.pass ? '终审通过' : `终审提示：${(review.issues || []).join('；') || '可能有歧义'}`}
                </span>
              )}
            </div>
          </div>

          {error && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

          {variant && (
            <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface-soft)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                变式题{variant.point ? ` · ${variant.point}` : ''}
              </div>
              <RichQuestionContent value={variant.content} style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--text)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {variant.options.map((option, index) => {
                  const key = option.key || OPTION_LABELS[index];
                  const isPicked = picked === key;
                  const isAnswer = submitted && key === correct;
                  const wrongPick = submitted && isPicked && key !== correct;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { if (!submitted) setPicked(key); }}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                        padding: '10px 12px', borderRadius: 10, cursor: submitted ? 'default' : 'pointer',
                        border: `1px solid ${isAnswer ? 'var(--success)' : wrongPick ? 'var(--danger)' : isPicked ? 'var(--accent)' : 'var(--line)'}`,
                        background: isAnswer ? 'var(--success-soft-bg)' : wrongPick ? 'var(--danger-soft-bg)' : isPicked ? 'var(--accent-soft-bg)' : 'var(--surface)',
                      }}
                    >
                      <span style={{ width: 20, height: 20, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: isPicked || isAnswer ? 'var(--accent)' : 'var(--neutral-soft-bg)', color: isPicked || isAnswer ? '#fff' : 'var(--muted)' }}>
                        {key}
                      </span>
                      <RichQuestionContent value={option.content} style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--text)' }} />
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!picked || submitted}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: picked && !submitted ? 'var(--accent)' : 'var(--neutral-soft-bg)', color: picked && !submitted ? '#fff' : 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: picked && !submitted ? 'pointer' : 'not-allowed' }}
                >
                  提交答案
                </button>
                {submitted && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: isCorrect ? 'var(--success)' : 'var(--danger)' }}>
                    {isCorrect ? '答对了' : `答错了，正确答案是 ${correct}`}
                  </span>
                )}
              </div>

              {submitted && variant.analysis && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 12.5, lineHeight: 1.8, color: 'var(--text)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>解析</div>
                  <RichQuestionContent value={variant.analysis} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {records.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>最近训练</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {records.map((row) => (
              <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--muted)', borderBottom: '1px dashed var(--line)', paddingBottom: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: row.isCorrect === true ? 'var(--success)' : row.isCorrect === false ? 'var(--danger)' : 'var(--muted)' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.variantContent}</span>
                <span>{row.isCorrect === true ? '答对' : row.isCorrect === false ? '答错' : '未作答'}</span>
                <span>{String(row.createdAt || '').slice(0, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
