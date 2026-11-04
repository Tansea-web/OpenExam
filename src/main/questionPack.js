/**
 * 题库包（openexam.pack.v1）
 *
 * 用途：跨设备/跨人共享题目，不携带任何学习记录、错题、AI 配置与个人设置。
 * 结构：
 * {
 *   schemaVersion: 'openexam.pack.v1',
 *   exportedAt, app: { name, version },
 *   scope: { subject, label },
 *   papers: [{ id, title, year, type, subject, questions: [...] }]
 * }
 */

const PACK_VERSION = 'openexam.pack.v1';
const MAX_QUESTIONS = 5000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

  return {
    valid: errors.length === 0,
    errors,
    pack: errors.length === 0 ? { schemaVersion: PACK_VERSION, papers, totalQuestions } : null,
  };
}

module.exports = { PACK_VERSION, MAX_QUESTIONS, validatePack, normalizeQuestion, normalizeOptions };
