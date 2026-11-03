/**
 * 自适应抽题（设计参考题舟 selectPractice 的弱项加权）：
 *   类目权重 = 弱项类目 +20 + 有错题类目 +12 + 未做过 +8 − 近期做过（最多 −40）
 * 类目权重 × 1000 + 随机微扰 → 排序；取样时以「材料组」为原子，资料分析一组 N 小题不拆散。
 */

function buildAdaptiveWeights({ categoryStats = [], wrongRows = [], recentRows = [] } = {}) {
  const weak = new Set();
  (Array.isArray(categoryStats) ? categoryStats : []).forEach((stat) => {
    const answered = Number(stat.answered) || 0;
    const accuracy = Number(stat.accuracy);
    if (answered >= 2 && Number.isFinite(accuracy) && accuracy < 60) {
      weak.add(stat.category);
    }
  });

  const wrongMap = new Map(
    (Array.isArray(wrongRows) ? wrongRows : []).map((row) => [row.category, Number(row.count) || 0])
  );
  const recentMap = new Map(
    (Array.isArray(recentRows) ? recentRows : []).map((row) => [row.category, Number(row.count) || 0])
  );

  return { weak, wrongMap, recentMap };
}

function categoryScore(category, weights) {
  let score = 0;
  if (weights.weak.has(category)) score += 20;
  if (weights.wrongMap.has(category)) score += 12;
  const recentCount = weights.recentMap.get(category) || 0;
  if (!recentCount) score += 8;
  else score -= Math.min(40, recentCount * 10);
  return score;
}

/**
 * 组原子取样：按已排序的候选队列遍历，遇到材料组则整组纳入；
 * 组超出剩余名额且组大小 > 1 时跳过该组继续找可放下的题。
 */
function takeWithGroups(questions, limit) {
  const cap = Number(limit) > 0 ? Number(limit) : 0;
  const byGroup = new Map();
  (Array.isArray(questions) ? questions : []).forEach((question) => {
    const groupId = String(question.material_group_id || '').trim();
    if (!groupId) return;
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(question);
  });
  byGroup.forEach((items) => items.sort((a, b) => (a.order_num || 0) - (b.order_num || 0)));

  const result = [];
  const usedGroups = new Set();
  const usedIds = new Set();

  for (const question of questions) {
    if (cap && result.length >= cap) break;
    if (usedIds.has(question.id)) continue;

    const groupId = String(question.material_group_id || '').trim();
    if (groupId && byGroup.has(groupId)) {
      if (usedGroups.has(groupId)) continue;
      const items = byGroup.get(groupId);
      // 只有一个名额还硬塞大组会破坏限额体验；单题组直接放行
      if (cap && items.length > 1 && result.length + items.length > cap) {
        usedGroups.add(groupId);
        items.forEach((item) => usedIds.add(item.id));
        continue;
      }
      items.forEach((item) => {
        result.push(item);
        usedIds.add(item.id);
      });
      usedGroups.add(groupId);
      continue;
    }

    result.push(question);
    usedIds.add(question.id);
  }

  return result;
}

function pickAdaptiveQuestions(questions, stats, limit) {
  const weights = buildAdaptiveWeights(stats);
  const scored = (Array.isArray(questions) ? questions : []).map((question) => ({
    question,
    score: categoryScore(String(question.category || ''), weights) * 1000 + Math.floor(Math.random() * 999),
  }));
  scored.sort((a, b) => b.score - a.score);
  return takeWithGroups(scored.map((item) => item.question), limit);
}

module.exports = { buildAdaptiveWeights, categoryScore, takeWithGroups, pickAdaptiveQuestions };
