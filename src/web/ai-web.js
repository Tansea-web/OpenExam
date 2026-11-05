/**
 * PWA 端 AI 客户端（浏览器直连，BYOK）
 *
 * 桌面端的 AI 走主进程 + 官方 SDK；网页端没有 Node 环境，也没有服务器，
 * 所以这里用原生 fetch 直接请求各家 API：
 *   - OpenAI 兼容：POST {base}/chat/completions
 *   - Anthropic：POST {base}/messages（需要 anthropic-dangerous-direct-browser-access）
 *
 * 已知限制：
 *   - 密钥保存在本机浏览器（localStorage / IndexedDB），不像桌面端有系统加密；
 *   - 是否可直连取决于服务商的 CORS 策略，失败时会给出手动提示。
 */

const DEFAULT_MAX_TOKENS = 2048;
const JSON_RETRY_SUFFIX = '\n\n只输出一个 JSON 对象，不要输出解释、Markdown 代码块或多余文字。';

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isAnthropic(settings) {
  return settings?.aiProvider === 'anthropic' || settings?.apiFormat === 'messages';
}

function resolveModel(settings) {
  return String(settings?.customModel || settings?.model || '').trim();
}

function toAnthropicMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item && item.content)
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content),
    }));
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return { __raw: text };
  }
}

function describeHttpError(response, data) {
  const detail = data?.error?.message || data?.message || data?.__raw || '';
  const suffix = detail ? `：${String(detail).slice(0, 180)}` : '';
  if (response.status === 401 || response.status === 403) return `密钥无效或没有权限${suffix}`;
  if (response.status === 429) return `请求过于频繁或额度用尽${suffix}`;
  if (response.status >= 500) return `服务商暂时不可用（${response.status}）${suffix}`;
  return `请求失败（${response.status}）${suffix}`;
}

function friendlyNetworkError(error, settings) {
  const message = String(error?.message || error || '');
  if (/failed to fetch|networkerror|load failed|err_failed/i.test(message)) {
    return `无法连接 ${trimBase(settings?.apiBase) || '模型服务'}：可能是网络问题，或该服务商不允许浏览器直连（CORS）。可换用支持浏览器直连的服务商，或改用桌面端。`;
  }
  return message || '请求失败';
}

async function requestOpenAI(settings, messages, options = {}) {
  const url = `${trimBase(settings.apiBase)}/chat/completions`;
  const body = {
    model: resolveModel(settings),
    messages: (Array.isArray(messages) ? messages : []).map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content || ''),
    })),
    max_tokens: Number(options.maxTokens) || DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? 0.6,
  };
  if (options.json) body.response_format = { type: 'json_object' };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(describeHttpError(response, data));
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

async function requestAnthropic(settings, messages, options = {}) {
  const url = `${trimBase(settings.apiBase)}/messages`;
  const body = {
    model: resolveModel(settings),
    max_tokens: Number(options.maxTokens) || DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(messages),
  };
  if (options.system) body.system = String(options.system);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      // 浏览器直连必须显式声明，Anthropic 才会返回 CORS 头
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(describeHttpError(response, data));
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text || ''))
    .join('')
    .trim();
}

async function callModel(settings, messages, options = {}) {
  if (!settings?.apiKey) throw new Error('还没有配置 API Key');
  if (!settings?.apiBase) throw new Error('还没有配置接口地址');
  if (!resolveModel(settings)) throw new Error('还没有选择模型');
  return isAnthropic(settings)
    ? requestAnthropic(settings, messages, options)
    : requestOpenAI(settings, messages, options);
}

export function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    return null;
  }
}

async function callForJson(settings, messages, options = {}) {
  const text = await callModel(settings, messages, { ...options, json: true });
  const parsed = extractJsonObject(text);
  if (parsed) return parsed;
  // 有的服务商不支持 response_format，追加一句再试一次
  const retried = await callModel(
    settings,
    messages.map((item) => ({ ...item, content: `${item.content}${JSON_RETRY_SUFFIX}` })),
    options
  );
  return extractJsonObject(retried);
}

function clampNumber(value, min, max, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeReview(raw, maxScore = 10) {
  const max = Math.max(1, Number(raw?.maxScore) || maxScore);
  return {
    score: clampNumber(raw?.score, 0, max, 0),
    maxScore: max,
    wordCount: Math.max(0, Math.round(Number(raw?.wordCount) || 0)),
    dimensions: (Array.isArray(raw?.dimensions) ? raw.dimensions : []).slice(0, 6).map((item) => ({
      name: String(item?.name || ''),
      score: Number(item?.score) || 0,
      max: Number(item?.max) || 0,
      comment: String(item?.comment || ''),
    })),
    points: (Array.isArray(raw?.points) ? raw.points : []).slice(0, 20).map((item) => ({
      text: String(item?.text || ''),
      hit: Boolean(item?.hit),
      evidence: String(item?.evidence || ''),
      why: String(item?.why || ''),
    })),
    summary: String(raw?.summary || ''),
    improvements: (Array.isArray(raw?.improvements) ? raw.improvements : []).slice(0, 5).map(String),
    provider: 'ai-web',
  };
}

export function createWebAI() {
  const listeners = new Set();
  const controllers = new Map();

  const emit = (payload) => {
    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        // 单个监听器异常不影响其它订阅
      }
    });
  };

  return {
    onChatStreamEvent(handler) {
      if (typeof handler !== 'function') return () => {};
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    async testConnection(settings) {
      try {
        const text = await callModel(settings, [{ role: 'user', content: '只回复两个字：可用' }], { maxTokens: 24 });
        return { success: true, message: text || '连接成功' };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },

    async chat(settings, messages) {
      try {
        const content = await callModel(settings, messages, { maxTokens: 2048 });
        return { success: true, content };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },

    /**
     * 伪流式：先拿完整回复，再按小块推 delta，AI 老师页面的契约保持一致。
     */
    async chatStreamStart(settings, messages, requestId) {
      const state = { cancelled: false };
      controllers.set(requestId, state);

      (async () => {
        try {
          const text = await callModel(settings, messages, { maxTokens: 2048 });
          if (!text) throw new Error('模型没有返回内容');
          const chunkSize = Math.max(2, Math.ceil(text.length / 40));
          for (let index = 0; index < text.length; index += chunkSize) {
            if (state.cancelled) {
              emit({ requestId, type: 'cancelled' });
              return;
            }
            emit({ requestId, type: 'delta', delta: text.slice(index, index + chunkSize) });
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
          emit({ requestId, type: 'done', content: text });
        } catch (error) {
          emit({ requestId, type: 'error', error: friendlyNetworkError(error, settings) });
        } finally {
          controllers.delete(requestId);
        }
      })();

      return { success: true };
    },

    async chatStreamCancel(requestId) {
      const state = controllers.get(requestId);
      if (state) state.cancelled = true;
      return true;
    },

    async gradeSubjective(settings, payload = {}) {
      const answer = String(payload.userAnswer || '').trim();
      if (!answer) return { success: false, error: '没有作答内容' };
      const maxScore = Number(payload.maxScore) || 10;

      try {
        const parsed = await callForJson(settings, [
          {
            role: 'user',
            content: [
              '你是严谨的主观题阅卷老师，请批改下面这份作答。',
              '',
              `题干：\n${String(payload.content || '').slice(0, 4000)}`,
              payload.referenceAnswer ? `\n参考答案：\n${String(payload.referenceAnswer).slice(0, 3000)}` : '',
              payload.rubric ? `\n评分点：\n${String(payload.rubric).slice(0, 2000)}` : '',
              payload.wordLimit ? `\n字数要求：不超过 ${payload.wordLimit} 字。` : '',
              `\n考生作答：\n${answer.slice(0, 6000)}`,
              '',
              '输出 JSON：',
              `{"score":数字,"maxScore":${maxScore},"wordCount":字数,`,
              '"dimensions":[{"name":"要点覆盖","score":数字,"max":数字,"comment":"一句话"},{"name":"逻辑结构",...},{"name":"表达规范",...}],',
              '"points":[{"text":"采分点","hit":true或false,"evidence":"考生原文","why":"漏掉时说明原因"}],',
              '"summary":"两三句总评","improvements":["改进动作"]}',
            ].filter(Boolean).join('\n'),
          },
        ], { maxTokens: 3072 });

        if (!parsed) return { success: false, error: '模型返回的批改结果无法解析，请重试' };
        return { success: true, review: normalizeReview(parsed, maxScore) };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },

    async gradeEssay(settings, payload = {}) {
      const answer = String(payload.answer || '').trim();
      if (!answer) return { success: false, error: '没有作答内容' };
      try {
        const parsed = await callForJson(settings, [
          {
            role: 'user',
            content: [
              '你是申论阅卷老师，请批改下面的作答。',
              '',
              `题型：${payload.essayType || '通用'}`,
              payload.material ? `\n给定材料：\n${String(payload.material).slice(0, 6000)}` : '',
              payload.requirement ? `\n作答要求：\n${String(payload.requirement).slice(0, 2000)}` : '',
              payload.scoringPoints ? `\n评分点：\n${String(payload.scoringPoints).slice(0, 2000)}` : '',
              `\n考生作答：\n${answer.slice(0, 6000)}`,
              '',
              '输出 JSON：',
              '{"score":数字,"maxScore":数字,"wordCount":字数,',
              '"dimensions":[{"name":"要点覆盖","score":数字,"max":数字,"comment":"..."},{"name":"概括层次",...},{"name":"语言规范",...},{"name":"字数控制",...}],',
              '"points":[{"text":"采分点","hit":true或false,"evidence":"...","why":"..."}],',
              '"summary":"两三句总评","improvements":["..."]}',
            ].filter(Boolean).join('\n'),
          },
        ], { maxTokens: 3072 });

        if (!parsed) return { success: false, error: '模型返回的批改结果无法解析，请重试' };
        return { success: true, review: normalizeReview(parsed, Number(parsed.maxScore) || 100) };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },

    async analyzeWrongCause(settings, payload = {}) {
      try {
        const parsed = await callForJson(settings, [
          {
            role: 'user',
            content: [
              '你是错题归因助手。请在五类错因中选一个最贴切的，并说明理由。',
              '可选错因：knowledge 知识缺口 / reading 审题偏差 / calculation 计算失误 / strategy 策略不当 / time 时间失控。',
              '',
              `题干：\n${String(payload.content || '').slice(0, 3000)}`,
              payload.options ? `\n选项：\n${JSON.stringify(payload.options).slice(0, 1500)}` : '',
              `\n我的答案：${String(payload.userAnswer || '')}`,
              `\n正确答案：${String(payload.correctAnswer || payload.answer || '')}`,
              payload.analysis ? `\n解析：\n${String(payload.analysis).slice(0, 2000)}` : '',
              '',
              '输出 JSON：{"cause":"knowledge|reading|calculation|strategy|time","reason":"一句话说明"}',
            ].filter(Boolean).join('\n'),
          },
        ], { maxTokens: 512 });

        if (!parsed) return { success: false, error: '模型返回的归因结果无法解析' };
        return {
          success: true,
          cause: String(parsed.cause || '').trim(),
          reason: String(parsed.reason || '').trim(),
        };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },

    async createVariant(settings, payload = {}) {
      try {
        const parsed = await callForJson(settings, [
          {
            role: 'user',
            content: [
              '基于下面这道题，出一个同考点的变式题（换情境/换数字，但考点一致，难度相当）。',
              '',
              `原题：\n${String(payload.content || '').slice(0, 3000)}`,
              payload.options ? `\n选项：\n${JSON.stringify(payload.options).slice(0, 1500)}` : '',
              `\n答案：${String(payload.answer || '')}`,
              payload.analysis ? `\n解析：\n${String(payload.analysis).slice(0, 1500)}` : '',
              '',
              '输出 JSON：',
              '{"content":"题干","options":[{"key":"A","content":"..."},{"key":"B","content":"..."},{"key":"C","content":"..."},{"key":"D","content":"..."}],"answer":"A","analysis":"解析"}',
            ].filter(Boolean).join('\n'),
          },
        ], { maxTokens: 1536 });

        const options = (Array.isArray(parsed?.options) ? parsed.options : [])
          .map((item, index) => ({
            key: String(item?.key || String.fromCharCode(65 + index)).slice(0, 2),
            content: String(item?.content || ''),
          }))
          .filter((item) => item.content);

        if (!parsed?.content || options.length < 2) {
          return { success: false, error: '模型生成的变式题不完整，请重试' };
        }

        return {
          success: true,
          variant: {
            content: String(parsed.content),
            options,
            answer: String(parsed.answer || '').trim().toUpperCase(),
            analysis: String(parsed.analysis || ''),
          },
        };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },

    async reviewVariant(settings, variant = {}) {
      try {
        const parsed = await callForJson(settings, [
          {
            role: 'user',
            content: [
              '请检查下面这道题的质量：题干是否完整、选项是否成立、答案是否与选项一致。',
              '',
              `题干：\n${String(variant.content || '').slice(0, 3000)}`,
              `选项：\n${JSON.stringify(variant.options || []).slice(0, 1500)}`,
              `给出的答案：${String(variant.answer || '')}`,
              '',
              '输出 JSON：{"pass":true或false,"issues":["问题"],"fixedAnswer":"如果答案有误，给出正确选项字母；否则留空"}',
            ].join('\n'),
          },
        ], { maxTokens: 512 });

        if (!parsed) return { success: false, error: '模型返回的检查结果无法解析' };
        return {
          success: true,
          pass: parsed.pass !== false,
          issues: (Array.isArray(parsed.issues) ? parsed.issues : []).slice(0, 5).map(String),
          fixedAnswer: String(parsed.fixedAnswer || '').trim().toUpperCase(),
        };
      } catch (error) {
        return { success: false, error: friendlyNetworkError(error, settings) };
      }
    },
  };
}
