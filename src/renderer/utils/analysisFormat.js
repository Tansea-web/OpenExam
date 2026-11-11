/**
 * 题库解析排版
 *
 * 原始解析多为挤成一行的纯文本，常见的两种结论标记：
 *   【常识判断/x】C项正确：……A项错误：……答案：C。
 *   【常识判断/x】①正确，……。②错误，……。③正确，……。答案：C。
 * 这里按标记拆段，去掉开头的类目标签、把答案单独提出来。
 * 含 HTML 标签（公式 / 表格 / 图片）的解析不处理，交回富文本渲染流程。
 */

const HTML_RE = /<[^>]+>/;
const CATEGORY_TAG_RE = /^【[^】]{1,40}】\s*/;
const ANSWER_RE = /(?:正确答案|答案|正确答案为|故正确答案为|故答案为|故选)\s*[:：]?\s*([A-D])\s*[。.．]?\s*$/;
const OPTION_RE = /([A-D](?:、[A-D]){0,3})\s*(?:[两三四]?项)?\s*(?:表述)?\s*(正确|错误)/g;
const CIRCLED_RE = /([①②③④⑤⑥⑦⑧⑨⑩])\s*(?:[两三四]?项)?\s*(?:表述)?\s*(正确|错误)/g;
const LEADING_PUNCT_RE = /^[\s：:，,。；;、]+/;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeBody(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br/>');
}

/** 源数据里常有被剥离图片/公式后残留的孤立引号、右括号，展示前轻清理 */
function cleanBody(value) {
  let next = String(value || '')
    .replace(LEADING_PUNCT_RE, '')
    .replace(/^[\s"'`“”‘’]+/, '')
    .replace(/[\s"'`“”‘’]+$/, '')
    .trim();
  if (!next.includes('（') && !next.includes('(')) {
    next = next.replace(/[）)]+$/, '').trim();
  }
  return next;
}

/** 字母型（A项错误）与圈号型（②错误）结论统一收集，按出现位置排序 */
function collectMarkers(text) {
  const found = [];
  [OPTION_RE, CIRCLED_RE].forEach((re, kind) => {
    Array.from(text.matchAll(re)).forEach((m) => {
      found.push({
        index: m.index,
        length: m[0].length,
        letters: m[1],
        verdict: m[2],
        circled: kind === 1,
      });
    });
  });
  found.sort((a, b) => a.index - b.index);
  return found.filter((m, i, list) => i === 0 || m.index >= list[i - 1].index + list[i - 1].length);
}

function answerBlock(letter) {
  return letter ? `<div class="qa-answer">答案 <b>${escapeHtml(letter)}</b></div>` : '';
}

export function formatAnalysisHtml(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw || HTML_RE.test(raw)) return null;

  let text = raw.replace(CATEGORY_TAG_RE, '').trim();
  let answer = '';
  const answerMatch = text.match(ANSWER_RE);
  if (answerMatch) {
    answer = answerMatch[1];
    text = text.slice(0, answerMatch.index).trim();
  }

  const markers = collectMarkers(text);
  // 命中过多说明不是结论式解析，保持原样避免误切
  if (markers.length > 16) return null;
  if (!markers.length && text === raw) return null;

  const lead = cleanBody(text.slice(0, markers.length ? markers[0].index : text.length));
  const blocks = [];
  if (lead) blocks.push(`<div class="qa-lead">${escapeBody(lead)}</div>`);

  // 「A、D项错误，C项正确，……」这类连着出现的结论后面共用一段解释，
  // 中间只有标点，不能切成只有徽标、没有正文的空行：把空段的字母合并到下一行。
  const rows = [];
  let pending = [];
  markers.forEach((marker, index) => {
    const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
    const body = cleanBody(text.slice(marker.index + marker.length, end));
    pending.push(marker);
    if (!body) return;
    rows.push({ keys: pending, body });
    pending = [];
  });
  if (pending.length) {
    if (rows.length) rows[rows.length - 1].keys.push(...pending);
    else rows.push({ keys: pending, body: '' });
  }

  rows.forEach((row) => {
    // 结论只靠颜色表达，文字放进 title / aria-label 保留语义与无障碍提示
    const keys = row.keys.map(({ letters, verdict, circled }) => {
      const cls = verdict === '正确' ? 'is-correct' : 'is-wrong';
      const label = escapeHtml(verdict);
      const extra = circled ? ' is-circled' : '';
      return `<span class="qa-key ${cls}${extra}" title="${label}" aria-label="${label}">${escapeHtml(letters)}</span>`;
    }).join('');
    const bodyHtml = row.body ? `<div class="qa-text">${escapeBody(row.body)}</div>` : '';
    blocks.push(`<div class="qa-item"><span class="qa-badges">${keys}</span>${bodyHtml}</div>`);
  });

  if (answer && options.showAnswer !== false) blocks.push(answerBlock(answer));
  return `<div class="qa-block">${blocks.join('')}</div>`;
}
