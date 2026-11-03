/**
 * 题目分类元数据（渲染层）。key 必须与 src/shared/questionCategory.js 里
 * CATEGORY_ALIASES 的 value 保持一致，两边同时改。
 */

export const CATEGORY_META = {
  yanyu: { name: '言语理解', color: 'var(--category-yanyu)' },
  shuliang: { name: '数量关系', color: 'var(--category-shuliang)' },
  panduan: { name: '判断推理', color: 'var(--category-panduan)' },
  ziliao: { name: '资料分析', color: 'var(--category-ziliao)' },
  changshi: { name: '常识判断', color: 'var(--category-changshi)' },
  cs_net: { name: '计算机网络', color: 'var(--info)' },
  cs_base: { name: '计算机基础', color: 'var(--accent)' },
  cs_security: { name: '网络安全', color: 'var(--danger)' },
  cs_os: { name: '操作系统', color: 'var(--success)' },
  cs_db: { name: '数据库', color: 'var(--warning)' },
  cs_prog: { name: '程序设计', color: 'var(--category-shuliang)' },
  cs_office: { name: '办公软件', color: 'var(--category-changshi)' },
};

export const SUBCATEGORY_NAMES = {
  xuanci: '选词填空',
  yueduan: '片段阅读',
  yuju: '语句表达',
  wenzhang: '文章阅读',
  jisuan: '数学运算',
  tuili: '数字推理',
  tuxing: '图形推理',
  dingyi: '定义判断',
  leibi: '类比推理',
  luoji: '逻辑判断',
  wenzi: '文字资料',
  biaoge: '表格资料',
  tubiao: '图形资料',
  zonghe: '综合资料',
  zengzhang: '增长率',
  zhengzhi: '政治',
  jingji: '经济',
  falv: '法律',
  keji: '科技',
  renwen: '人文',
  dili: '地理',
  gongcheng: '工程问题',
  cs_net: '计算机网络',
  cs_base: '计算机基础',
  cs_security: '网络安全',
  cs_os: '操作系统',
  cs_db: '数据库',
  cs_prog: '程序设计',
  cs_office: '办公软件',
};

export function getCategoryName(key, fallback = '') {
  const value = String(key || '').trim();
  return CATEGORY_META[value]?.name || SUBCATEGORY_NAMES[value] || fallback || value;
}

export function getCategoryColor(key, fallback = 'var(--accent)') {
  return CATEGORY_META[String(key || '').trim()]?.color || fallback;
}

export function getSubCategoryName(key, fallback = '') {
  const value = String(key || '').trim();
  return SUBCATEGORY_NAMES[value] || getCategoryName(value, fallback);
}

export function buildCategoryList(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return list.map((key) => ({
    id: key,
    name: getCategoryName(key),
    color: getCategoryColor(key),
  }));
}
