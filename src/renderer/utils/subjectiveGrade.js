/**
 * 通用主观题评分（简答 / 论述 / 案例 / 写作）
 * 优先调用 AI 批改；未配置 AI 或调用失败时用本地关键词覆盖兜底。
 */

const POINT_SPLIT_RE = /[\n；;]+/;
const STRUCTURE_RE = /(首先|其次|再次|最后|第一|第二|第三|其一|其二|综上|因此|所以|总之)/;

export function splitRubricPoints(text) {
  return String(text || '')
    .split(POINT_SPLIT_RE)
    .map((item) => item.replace(/^[\s\-·•\d.、)）]+/, '').trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);
}

function pointHit(point, answer) {
  const clean = String(point).replace(/[\s，。；、：:,.!?（）()【】[\]"'“”]/g, '');
  if (!clean) return false;
  const haystack = String(answer || '').replace(/\s/g, '');
  if (clean.length <= 4) return haystack.includes(clean);

  let hit = 0;
  let total = 0;
  for (let i = 0; i + 4 <= clean.length; i += 2) {
    total += 1;
    if (haystack.includes(clean.slice(i, i + 4))) hit += 1;
  }
  return total > 0 && hit / total >= 0.34;
}

/** 本地兜底评分：要点覆盖 60% + 字数 25% + 结构 15% */
export function localGradeSubjective({ userAnswer, referenceAnswer, rubric, wordLimit, maxScore = 10 }) {
  const answer = String(userAnswer || '').trim();
  const limit = Number(wordLimit) || 0;
  const pointsText = splitRubricPoints(rubric || referenceAnswer);
  const points = pointsText.map((text) => ({
    text,
    hit: pointHit(text, answer),
    evidence: '',
    why: '',
  }));

  const hitCount = points.filter((point) => point.hit).length;
  const hitRatio = points.length ? hitCount / points.length : (answer ? 0.6 : 0);
  const chars = answer.replace(/\s/g, '').length;
  const lengthRatio = limit > 0 ? Math.min(1, chars / limit) : Math.min(1, chars / 120);
  const structure = STRUCTURE_RE.test(answer) ? 1 : 0.5;
  const raw = maxScore * (hitRatio * 0.6 + lengthRatio * 0.25 + structure * 0.15);

  const round = (value) => Math.round(value * 10) / 10;
  return {
    score: round(Math.max(0, Math.min(maxScore, raw))),
    maxScore,
    wordCount: chars,
    dimensions: [
      {
        name: '要点覆盖',
        score: round(maxScore * 0.6 * hitRatio),
        max: round(maxScore * 0.6),
        comment: points.length ? `命中 ${hitCount}/${points.length} 个要点` : '未提供评分点，按作答完整度估算',
      },
      {
        name: '字数控制',
        score: round(maxScore * 0.25 * lengthRatio),
        max: round(maxScore * 0.25),
        comment: limit > 0 ? `${chars} / ${limit} 字` : `${chars} 字`,
      },
      {
        name: '逻辑结构',
        score: round(maxScore * 0.15 * structure),
        max: round(maxScore * 0.15),
        comment: structure === 1 ? '有分点或结论，结构清晰' : '建议补充分点与总结',
      },
    ],
    points,
    summary: '本地评分（未配置 AI）：按要点覆盖、字数与结构估算，仅供参考。',
    improvements: ['配置 AI 模型后可获得逐点批改与更准确的评分'],
    provider: 'local-rubric',
  };
}

export async function gradeSubjectiveQuestion({ question, userAnswer, settings, maxScore = 10 }) {
  const payload = {
    content: question?.content || '',
    userAnswer: String(userAnswer || ''),
    referenceAnswer: question?.answer || '',
    rubric: question?.rubric || question?.scoringPoints || '',
    wordLimit: Number(question?.wordLimit || question?.word_limit) || 0,
    maxScore,
  };

  if (window.openexam?.ai?.gradeSubjective && settings?.apiKey) {
    try {
      const result = await window.openexam.ai.gradeSubjective(settings, payload);
      if (result?.success && result.review) {
        return { ...result.review, provider: result.review.provider || 'ai' };
      }
    } catch (error) {
      // 落到本地评分
    }
  }

  return localGradeSubjective(payload);
}
