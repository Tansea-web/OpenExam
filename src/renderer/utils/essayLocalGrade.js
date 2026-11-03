/**
 * 申论本地规则评分（无 AI 时的兜底，设计参考题舟 localEvaluation）：
 *   要点关键词覆盖率 × 0.5 + 结构分 × 0.3 + 长度分 × 0.2
 * 输出结构与 AI 批改一致，结果页无需区分来源。
 */

const MAX_SCORE = 100;

function splitKeywords(point) {
  return String(point || '')
    .replace(/[，。；、：""''（）()【】\s]/g, '|')
    .split('|')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 2)
    .sort((a, b) => b.length - a.length);
}

/** 采分点命中判定：关键词片段（或其前 4 字）出现在作答中即视为命中 */
function hitPoint(answerText, point) {
  const keywords = splitKeywords(point);
  if (!keywords.length) return false;
  return keywords.some((keyword) => {
    if (answerText.includes(keyword)) return true;
    const short = keyword.slice(0, 4);
    return short.length >= 2 && answerText.includes(short);
  });
}

function gradeCoverage(answerText, scoringPoints) {
  const list = (Array.isArray(scoringPoints) ? scoringPoints : [])
    .map((raw) => String(raw || '').trim())
    .filter(Boolean);

  if (!list.length) {
    return { score: 30, max: 50, points: [], hitCount: 0, comment: '本题没有配置采分点，按默认档位计分' };
  }

  const points = list.map((text) => {
    const hit = hitPoint(answerText, text);
    return { text, hit, why: hit ? '' : '作答中未出现该要点，建议对照材料补齐' };
  });
  const hitCount = points.filter((item) => item.hit).length;

  return {
    score: Math.round((hitCount / list.length) * 50),
    max: 50,
    points,
    hitCount,
    comment: `命中 ${hitCount}/${list.length} 个采分点`,
  };
}

function gradeStructure(answerText) {
  const paragraphs = answerText.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const markers = (
    answerText.match(/(第一|第二|第三|第四|第五|一是|二是|三是|四是|首先|其次|再次|此外|最后|[一二三四五六七八九十]、|\d{1,2}[.、])/g) || []
  ).length;

  const paraScore = Math.min(1, paragraphs.length / 3);
  const markerScore = markers >= 3 ? 1 : markers >= 1 ? 0.5 : 0;
  const score = Math.round((paraScore * 0.5 + markerScore * 0.5) * 30);

  return {
    score,
    max: 30,
    comment: `${paragraphs.length} 个自然段，序号衔接 ${markers} 处${markers < 2 ? '，建议分条作答' : ''}`,
  };
}

function gradeLength(answerText, wordLimit) {
  const limit = Number(wordLimit) || 0;
  const count = answerText.length;

  if (limit > 0) {
    const ratio = count / limit;
    let score;
    if (count < 20) score = 0;
    else if (ratio < 0.5) score = Math.round((ratio / 0.5) * 12);
    else if (ratio <= 1) score = 20;
    else if (ratio <= 1.1) score = 16;
    else score = Math.max(4, 16 - Math.round((ratio - 1.1) * 60));
    return { score, max: 20, comment: `${count} 字 / 上限 ${limit} 字${ratio > 1.1 ? '，超字数会被扣分' : ''}` };
  }

  let score;
  if (count < 50) score = Math.round((count / 50) * 10);
  else if (count <= 600) score = 20;
  else score = Math.max(8, 20 - Math.round((count - 600) / 100));
  return { score, max: 20, comment: `${count} 字` };
}

export function localGradeEssay({ answer, wordLimit, scoringPoints, essayType } = {}) {
  const text = String(answer || '').replace(/\r\n/g, '\n').trim();
  const wordCount = text.replace(/\s/g, '').length;

  const coverage = gradeCoverage(text, scoringPoints);
  const structure = gradeStructure(text);
  const length = gradeLength(text, wordLimit);

  const score = coverage.score + structure.score + length.score;
  const typeNames = {
    guina: '归纳概括',
    duice: '提出对策',
    fenxi: '综合分析',
    guanche: '贯彻执行',
    dazuowen: '大作文',
  };

  return {
    success: true,
    provider: 'local-rubric',
    review: {
      score,
      maxScore: MAX_SCORE,
      wordCount,
      dimensions: [
        { name: '要点覆盖', score: coverage.score, max: coverage.max, comment: coverage.comment },
        { name: '结构层次', score: structure.score, max: structure.max, comment: structure.comment },
        { name: '字数控制', score: length.score, max: length.max, comment: length.comment },
      ],
      points: coverage.points,
      summary: `本地规则评分（未使用 AI）：按${typeNames[essayType] || '申论'}常规口径，从要点覆盖、结构层次与字数控制三项加权计分，供快速参考；想拿到精准批改请在设置中配置 AI。`,
      improvements: [
        coverage.hitCount < (coverage.points.length || 0) ? '对照材料补齐漏掉的采分点，核心词提前' : '要点覆盖完整，注意表述精炼',
        structure.comment.includes('建议分条作答') ? '分条作答，序号清晰' : '保持现有分条结构',
        Number(wordLimit) > 0 ? `控制在 ${wordLimit} 字以内` : '保持篇幅适中',
      ],
    },
  };
}
