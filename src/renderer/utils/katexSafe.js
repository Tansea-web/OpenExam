import katex from 'katex';

/** 公式里夹中文时包成 \text{}，避免 unicodeTextInMathMode 警告与斜体渲染 */
function wrapCjkForMath(value) {
  return String(value || '')
    .split(/(\\text\{[^}]*\})/)
    .map((part) => (part.startsWith('\\text{')
      ? part
      : part.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, (match) => `\\text{${match}}`)))
    .join('');
}

/**
 * 渲染 LaTeX 片段。
 *
 * KaTeX 对 ①② 这类字符没有字体度量，会刷 "No character metrics" 警告并生成
 * 宽度为 0 的字形。遇到这种情况返回 null，由调用方回退显示原始文本；
 * 这类片段本来也不是数学公式（多为被 $...$ 误框住的普通文字）。
 */
export function renderKatexHtml(tex, displayMode = false) {
  const originalWarn = console.warn;
  let unsupported = false;
  console.warn = (...args) => {
    const message = args.map((part) => String(part)).join(' ');
    if (message.includes('No character metrics')) {
      unsupported = true;
      return;
    }
    originalWarn(...args);
  };

  try {
    const html = katex.renderToString(wrapCjkForMath(tex), {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    });
    return unsupported ? null : html;
  } catch (error) {
    return null;
  } finally {
    console.warn = originalWarn;
  }
}
