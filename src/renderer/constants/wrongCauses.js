/**
 * 错因五类（设计参考题舟 wrongQuestion 讲解协议）。
 * 存储为字符串标签，支持后续自由扩展。
 */
export const WRONG_CAUSES = [
  { key: "knowledge", label: "知识缺口", color: "var(--danger)", desc: "考点没掌握，需要回到教材或知识文档" },
  { key: "reading", label: "审题偏差", color: "var(--warning)", desc: "看错问题或漏掉限定条件" },
  { key: "calculation", label: "计算失误", color: "var(--info)", desc: "思路对但算错，需要限时训练" },
  { key: "strategy", label: "策略不当", color: "var(--category-shuliang)", desc: "方法选错或顺序不合理" },
  { key: "time", label: "时间失控", color: "var(--category-ziliao)", desc: "耗时过长挤占其他题，需要节奏训练" },
];

export const WRONG_CAUSE_LABELS = Object.fromEntries(
  WRONG_CAUSES.map((item) => [item.key, item.label])
);

export function getWrongCauseLabel(cause) {
  const key = String(cause || '').trim();
  if (!key) return '';
  return WRONG_CAUSE_LABELS[key] || key;
}

export function getWrongCauseMeta(cause) {
  const key = String(cause || '').trim();
  return WRONG_CAUSES.find((item) => item.key === key) || null;
}
