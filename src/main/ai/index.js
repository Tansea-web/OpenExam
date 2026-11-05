/**
 * AI 服务统一接口
 * - OpenAI SDK 统一承接 OpenAI / OpenAI 兼容协议
 * - OpenAI 原生支持 Responses API 与 Chat Completions API
 * - MiniMax / Kimi / GLM / 其他兼容服务默认走 Chat Completions
 * - Claude 仍保留 Anthropic SDK
 */

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { buildSystem, wrapUntrusted, wrapUntrustedList } = require('./prompts.js');

const OPENAI_COMPATIBLE_PROVIDERS = {
  openai: {
    sdkType: 'openai',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    defaultFormat: 'responses',
    supportedFormats: ['responses', 'chat_completions'],
  },
  minimax: {
    sdkType: 'openai',
    baseURL: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-M1',
    defaultFormat: 'chat_completions',
    supportedFormats: ['chat_completions'],
  },
  kimi: {
    sdkType: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-128k',
    defaultFormat: 'chat_completions',
    supportedFormats: ['chat_completions'],
  },
  glm: {
    sdkType: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5-air',
    defaultFormat: 'chat_completions',
    supportedFormats: ['chat_completions'],
  },
  deepseek: {
    sdkType: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    defaultFormat: 'chat_completions',
    supportedFormats: ['chat_completions'],
  },
  doubao: {
    sdkType: 'openai',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro-32k',
    defaultFormat: 'chat_completions',
    supportedFormats: ['chat_completions'],
  },
  qwen: {
    sdkType: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
    defaultFormat: 'chat_completions',
    supportedFormats: ['chat_completions'],
  },
  custom: {
    sdkType: 'openai',
    baseURL: '',
    defaultModel: '',
    defaultFormat: 'chat_completions',
    supportedFormats: ['responses', 'chat_completions'],
  },
  openai_compatible: {
    sdkType: 'openai',
    baseURL: '',
    defaultModel: '',
    defaultFormat: 'chat_completions',
    supportedFormats: ['responses', 'chat_completions'],
  },
  anthropic: {
    sdkType: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    defaultFormat: 'messages',
    supportedFormats: ['messages'],
  },
};

function getProviderConfig(providerId) {
  return OPENAI_COMPATIBLE_PROVIDERS[providerId] || OPENAI_COMPATIBLE_PROVIDERS.custom;
}

function normalizeAISettings(input) {
  const settings = input && typeof input === 'object' ? { ...input } : {};
  const provider = getProviderConfig(settings.aiProvider || 'custom');
  const preferredModel = String(settings.customModel || '').trim() || String(settings.model || '').trim();
  const supportedFormats = provider.supportedFormats || ['chat_completions'];

  return {
    ...settings,
    aiProvider: settings.aiProvider || 'custom',
    apiKey: String(settings.apiKey || '').trim(),
    apiBase: String(settings.apiBase || provider.baseURL || '').trim(),
    model: preferredModel || provider.defaultModel,
    apiFormat: supportedFormats.includes(settings.apiFormat)
      ? settings.apiFormat
      : (provider.defaultFormat || supportedFormats[0] || 'chat_completions'),
  };
}

function createClient(inputSettings) {
  const settings = normalizeAISettings(inputSettings);
  const provider = getProviderConfig(settings.aiProvider);

  if (provider.sdkType === 'anthropic') {
    return {
      type: 'anthropic',
      client: new Anthropic({ apiKey: settings.apiKey }),
      model: settings.model || provider.defaultModel,
      settings,
      provider,
    };
  }

  return {
    type: 'openai',
    client: new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.apiBase || provider.baseURL || undefined,
    }),
    model: settings.model || provider.defaultModel,
    settings,
    provider,
  };
}

function extractResponseText(response) {
  if (!response) return '';
  const normalizedResponse = response?.response && typeof response.response === 'object'
    ? response.response
    : response;

  const normalizeTextNode = (node) => {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';

    if (typeof node.text === 'string') return node.text;
    if (typeof node.value === 'string') return node.value;
    if (typeof node.content === 'string') return node.content;

    if (node.text && typeof node.text === 'object') {
      if (typeof node.text.value === 'string') return node.text.value;
      if (Array.isArray(node.text)) {
        return node.text.map((part) => normalizeTextNode(part)).filter(Boolean).join('');
      }
    }

    if (Array.isArray(node.content)) {
      return node.content.map((part) => normalizeTextNode(part)).filter(Boolean).join('');
    }

    return '';
  };

  if (typeof normalizedResponse.output_text === 'string' && normalizedResponse.output_text.trim()) {
    return normalizedResponse.output_text;
  }

  if (Array.isArray(normalizedResponse.output_text)) {
    const text = normalizedResponse.output_text.map((part) => normalizeTextNode(part)).filter(Boolean).join('');
    if (text.trim()) return text;
  }

  if (Array.isArray(normalizedResponse.output)) {
    const parts = [];
    for (const item of normalizedResponse.output) {
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          const text = normalizeTextNode(content);
          if (text) parts.push(text);
        }
      } else {
        const text = normalizeTextNode(item);
        if (text) parts.push(text);
      }
    }
    const joined = parts.join('');
    if (joined.trim()) return joined;
  }

  const completionLike = normalizedResponse?.choices?.[0]?.message?.content;
  if (typeof completionLike === 'string' && completionLike.trim()) return completionLike;
  if (Array.isArray(completionLike)) {
    const text = completionLike.map((part) => normalizeTextNode(part)).filter(Boolean).join('\n');
    if (text.trim()) return text;
  }

  const fallback = normalizeTextNode(normalizedResponse?.message) || normalizeTextNode(normalizedResponse?.content);
  return fallback || '';
}

function normalizeStringContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text' && typeof item.text === 'string') return item.text;
        if (item?.type === 'input_text' && typeof item.text === 'string') return item.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content || '');
}

function toResponsesInput(messages) {
  return (messages || []).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: 'input_text', text: normalizeStringContent(message.content) }],
  }));
}

function buildOpenAICompletionPayload(model, instructions, messages, maxOutputTokens) {
  return {
    model,
    messages: [
      ...(instructions ? [{ role: 'system', content: instructions }] : []),
      ...messages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: normalizeStringContent(message.content),
      })),
    ],
    max_tokens: maxOutputTokens,
  };
}

async function createOpenAITextResponse(client, model, apiFormat, { instructions = '', messages = [], maxOutputTokens = 4096 }) {
  const completionPayload = buildOpenAICompletionPayload(model, instructions, messages, maxOutputTokens);

  if (apiFormat === 'responses') {
    const response = await client.responses.create({
      model,
      instructions: instructions || undefined,
      input: toResponsesInput(messages),
      max_output_tokens: maxOutputTokens,
    });

    const primaryText = extractResponseText(response);
    if (primaryText.trim()) return primaryText;

    // 一些兼容网关对 Responses 成功返回但不带 output_text，自动回退到 chat.completions
    try {
      const completionFallback = await client.chat.completions.create(completionPayload);
      const fallbackText = completionFallback.choices?.[0]?.message?.content;
      if (typeof fallbackText === 'string') return fallbackText;
      if (Array.isArray(fallbackText)) {
        return fallbackText
          .map((item) => normalizeStringContent(item))
          .filter(Boolean)
          .join('\n');
      }
    } catch (fallbackError) {
      // 忽略回退失败，保留空字符串交给上层兜底
    }
    return '';
  }

  const completion = await client.chat.completions.create(completionPayload);

  const content = completion.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => normalizeStringContent(item))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function createOpenAITextResponseStream(client, model, apiFormat, { instructions = '', messages = [], maxOutputTokens = 4096, signal, onDelta }) {
  const emit = (value) => {
    if (typeof value !== 'string' || !value) return;
    if (typeof onDelta === 'function') onDelta(value);
  };
  const completionPayload = buildOpenAICompletionPayload(model, instructions, messages, maxOutputTokens);

  if (apiFormat === 'responses') {
    try {
      const responseStream = await client.responses.create({
        model,
        instructions: instructions || undefined,
        input: toResponsesInput(messages),
        max_output_tokens: maxOutputTokens,
        stream: true,
      }, signal ? { signal } : undefined);

      let text = '';
      for await (const event of responseStream) {
        if (signal?.aborted) throw new Error('请求已取消');
        if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          text += event.delta;
          emit(event.delta);
        }
        if (event?.type === 'response.error') {
          throw new Error(event.error?.message || 'Responses 流式输出失败');
        }
      }
      if (text.trim()) return text;
    } catch (streamError) {
      if (signal?.aborted) throw streamError;
      // Responses 流式失败时，自动回退 chat.completions stream
    }
  }

  const completionStream = await client.chat.completions.create({
    ...completionPayload,
    stream: true,
  }, signal ? { signal } : undefined);

  let text = '';
  for await (const chunk of completionStream) {
    if (signal?.aborted) throw new Error('请求已取消');
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      text += delta;
      emit(delta);
      continue;
    }
    if (Array.isArray(delta)) {
      const piece = delta
        .map((item) => normalizeStringContent(item))
        .filter(Boolean)
        .join('\n');
      if (piece) {
        text += piece;
        emit(piece);
      }
    }
  }
  return text;
}

async function recognizeWithOpenAI(client, model, apiFormat, imageBase64, mimeType = 'image/png') {
  const imageUrl = `data:${mimeType};base64,${imageBase64}`;

  if (apiFormat === 'responses') {
    const response = await client.responses.create({
      model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: OCR_PROMPT },
          { type: 'input_image', image_url: imageUrl },
        ],
      }],
      max_output_tokens: 4096,
    });
    return extractResponseText(response);
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 4096,
  });

  return response.choices?.[0]?.message?.content || '';
}

async function recognizeWithClaude(client, model, imageBase64, mimeType = 'image/png') {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageBase64,
            },
          },
          { type: 'text', text: OCR_PROMPT },
        ],
      },
    ],
  });

  return response.content?.[0]?.text || '';
}

function extractJSONObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const jsonMatch = fenced.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const error = new Error('无法解析返回结果');
    error.raw = raw;
    throw error;
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    error.raw = raw;
    throw error;
  }
}

async function structureQuestionsFromText(settings, rawText) {
  const { type, client, model, settings: normalizedSettings } = createClient(settings);
  const prompt = `${OCR_PROMPT}\n\n以下是 OCR 提取出的原始文本，请你整理为标准 JSON：\n\n${wrapUntrusted('OCR 原始文本', rawText)}`;

  if (type === 'anthropic') {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content?.[0]?.text || '';
  }

  return createOpenAITextResponse(client, model, normalizedSettings.apiFormat, {
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: 4096,
  });
}

async function recognizeWithOCREngine(settings, imageBase64, mimeType = 'image/png') {
  const normalizedSettings = normalizeAISettings(settings);
  if (!normalizedSettings.ocrEnabled || !normalizedSettings.ocrApiUrl) {
    throw new Error('OCR 引擎未配置');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (normalizedSettings.ocrApiKey) {
    headers.Authorization = `Bearer ${normalizedSettings.ocrApiKey}`;
    headers['X-API-Key'] = normalizedSettings.ocrApiKey;
  }

  const response = await fetch(normalizedSettings.ocrApiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      imageBase64,
      mimeType,
      responseMode: normalizedSettings.ocrResponseMode,
      prompt: OCR_PROMPT,
    }),
  });

  if (!response.ok) {
    throw new Error(`OCR 请求失败：${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { text: await response.text() };

  if (Array.isArray(payload?.questions)) {
    return { questions: payload.questions };
  }
  if (Array.isArray(payload?.data?.questions)) {
    return { questions: payload.data.questions };
  }

  const text = String(payload?.text || payload?.content || payload?.data?.text || '').trim();
  if (!text) {
    throw new Error('OCR 返回为空');
  }

  if (normalizedSettings.ocrResponseMode === 'json_questions') {
    return extractJSONObject(text);
  }

  const structured = await structureQuestionsFromText(settings, text);
  return extractJSONObject(structured);
}

// OCR 识别题目的 prompt
const OCR_PROMPT = `你是一个专业的题目识别助手。请识别图片中的考试题目，并按以下 JSON 格式输出：

{
  "questions": [
    {
      "content": "题目内容",
      "options": [
        {"key": "A", "content": "选项A内容"},
        {"key": "B", "content": "选项B内容"},
        {"key": "C", "content": "选项C内容"},
        {"key": "D", "content": "选项D内容"}
      ],
      "answer": "正确答案（如A）",
      "analysis": "解析内容（如果有）",
      "type": "single"
    }
  ]
}

注意：
1. 如果图片中有多道题目，请全部识别
2. 如果没有解析，analysis 字段留空字符串
3. 如果没有答案，answer 字段留空字符串
4. 只输出 JSON，不要其他内容`;

async function recognizeQuestions(settings, imageBase64, mimeType = 'image/png') {
  const normalizedSettings = normalizeAISettings(settings);

  if (normalizedSettings.recognizeEngine === 'ocr') {
    return recognizeWithOCREngine(normalizedSettings, imageBase64, mimeType);
  }

  if (normalizedSettings.recognizeEngine === 'auto' && normalizedSettings.ocrEnabled && mimeType === 'application/pdf') {
    return recognizeWithOCREngine(normalizedSettings, imageBase64, mimeType);
  }

  const { type, client, model, settings: clientSettings } = createClient(normalizedSettings);

  let resultText;
  if (type === 'anthropic') {
    resultText = await recognizeWithClaude(client, model, imageBase64, mimeType);
  } else {
    resultText = await recognizeWithOpenAI(client, model, clientSettings.apiFormat, imageBase64, mimeType);
  }

  try {
    return extractJSONObject(resultText);
  } catch (error) {
    console.error('解析 AI 返回结果失败:', error);
    return { questions: [], error: '解析失败', raw: resultText };
  }
}

const TEACHER_SYSTEM = buildSystem(`你是一位经验丰富、耐心细致的学习辅导老师，名叫"小开"。你的任务是：
1. 帮助学生理解题目、掌握知识点、提升学习能力
2. 用通俗易懂的语言解释，必要时举例说明
3. 鼓励学生思考，不直接给答案，引导式教学
4. 回答时使用清晰的结构（分点、标题等）
5. 如果学生问的不是学习相关问题，礼貌地引导回学习话题`);

async function chat(settings, messages) {
  const { type, client, model, settings: normalizedSettings } = createClient(settings);
  const fullMessages = [{ role: 'system', content: TEACHER_SYSTEM }, ...(messages || [])];

  try {
    if (type === 'anthropic') {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: TEACHER_SYSTEM,
        messages: fullMessages.filter((message) => message.role !== 'system'),
      });
      return { success: true, content: response.content?.[0]?.text || '' };
    }

    const text = await createOpenAITextResponse(client, model, normalizedSettings.apiFormat, {
      instructions: TEACHER_SYSTEM,
      messages: fullMessages.filter((message) => message.role !== 'system'),
      maxOutputTokens: 4096,
    });
    return { success: true, content: text };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function chatStream(settings, messages, options = {}) {
  const { onDelta, signal } = options;
  const { type, client, model, settings: normalizedSettings } = createClient(settings);
  const fullMessages = [{ role: 'system', content: TEACHER_SYSTEM }, ...(messages || [])];

  if (type === 'anthropic') {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: TEACHER_SYSTEM,
      messages: fullMessages.filter((message) => message.role !== 'system'),
    });

    let text = '';
    stream.on('text', (piece) => {
      if (!piece) return;
      text += piece;
      if (typeof onDelta === 'function') onDelta(piece);
    });

    if (signal) {
      if (signal.aborted) {
        stream.abort();
      } else {
        signal.addEventListener('abort', () => stream.abort(), { once: true });
      }
    }

    await stream.finalMessage();
    return { success: true, content: text };
  }

  const text = await createOpenAITextResponseStream(client, model, normalizedSettings.apiFormat, {
    instructions: TEACHER_SYSTEM,
    messages: fullMessages.filter((message) => message.role !== 'system'),
    maxOutputTokens: 4096,
    signal,
    onDelta,
  });

  return { success: true, content: text };
}

const CATEGORY_NAMES = {
  yanyu: '言语理解与表达', shuliang: '数量关系', panduan: '判断推理',
  ziliao: '资料分析', changshi: '常识判断',
  cs_base: '计算机基础', cs_net: '计算机网络', cs_security: '网络安全',
  cs_os: '操作系统', cs_db: '数据库', cs_prog: '程序设计', cs_office: '办公软件',
};

const EXAM_TRACK_NAMES = {
  gongkao: '考公',
  shiye: '事业单位',
  ruankao: '软考',
  kaoyan: '考研',
  self: '自定义备考',
};

const FOCUS_NAMES = {
  standard: '通用组卷',
  idiom: '成语练习',
  current_affairs: '时政热点',
  computer: '计算机基础',
  custom: '自定义方向',
};

const DIFFICULTY_NAMES = {
  1: '入门级（非常简单）', 2: '简单', 3: '中等', 4: '较难', 5: '困难（需要深入思考）',
};

function getTargetCategories(config = {}) {
  const mixed = Array.isArray(config?.mixedCategories) ? config.mixedCategories.filter(Boolean) : [];
  if (config?.mode === 'mixed' && mixed.length) return mixed;
  const single = String(config?.category || '').trim();
  return single ? [single] : ['changshi'];
}

/** 自定义名称来自用户输入，只保留单行短文本，去掉可能改变指令的符号 */
function sanitizeCustomLabel(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').replace(/[<>{}`]/g, '').trim().slice(0, 40);
  return text || fallback;
}

function getTrackLabel(config = {}) {
  if (config?.track === 'self') {
    return sanitizeCustomLabel(config?.customTrackName, EXAM_TRACK_NAMES.self);
  }
  return EXAM_TRACK_NAMES[config?.track] || EXAM_TRACK_NAMES.gongkao;
}

function getFocusLabel(config = {}) {
  if (config?.focus === 'custom') {
    return sanitizeCustomLabel(config?.customFocusName, FOCUS_NAMES.custom);
  }
  return FOCUS_NAMES[config?.focus] || FOCUS_NAMES.standard;
}

function getFocusDirective(config = {}) {
  if (config?.focus === 'idiom') {
    return '重点出成语辨析、近义词辨析、词语搭配与语境判断题，优先言语题型。';
  }
  if (config?.focus === 'current_affairs') {
    return '重点结合近年政策热点、科技产业动态和重大会议部署，题干保持客观严谨。';
  }
  if (config?.focus === 'computer') {
    return '重点覆盖计算机基础、操作系统、网络、数据库、数据结构与编程常识。';
  }
  if (config?.focus === 'custom') {
    const custom = String(config?.customFocusName || '').trim();
    return custom ? `重点方向：${custom}` : '';
  }
  return '';
}

function getCurrentAffairsDirective(config = {}) {
  const enabled = Boolean(config?.includeCurrentAffairs) || config?.focus === 'current_affairs';
  if (!enabled) return '';
  const days = Math.max(7, Math.min(180, Number(config?.currentAffairsDays) || 30));
  const keywords = String(config?.currentAffairsKeywords || '').trim();
  return `请优先结合最近 ${days} 天公开时政信息命题${keywords ? `，重点关注：${keywords}` : ''}。若模型无法联网检索，请使用近两年稳定热点并在解析中加“时效提示”。`;
}

function buildGeneratePrompt(config) {
  const targetCategories = getTargetCategories(config);
  const catName = targetCategories.map((key) => CATEGORY_NAMES[key] || key).join('、');
  const diffName = DIFFICULTY_NAMES[config.difficulty] || '中等';
  const count = Math.max(1, Number(config?.count) || 10);
  const trackName = getTrackLabel(config);
  const focusName = getFocusLabel(config);
  const modeText = config?.mode === 'mixed' ? '综合组卷' : '专项组卷';
  const focusDirective = getFocusDirective(config);
  const currentAffairsDirective = getCurrentAffairsDirective(config);
  const analysisMode = config?.analysisMode === 'thinking'
    ? 'analysis 字段使用“解题思路：...；答案依据：...”格式，控制在 120 字内'
    : 'analysis 字段保持简要解析，控制在 60 字内';
  const categoryLimit = config?.mode === 'mixed'
    ? `category 必须从 [${targetCategories.join(', ')}] 中选择`
    : `category 固定为 "${targetCategories[0]}"`;
  const defaultCategory = targetCategories[0] || 'changshi';

  return `你是一位资深的考试命题专家。请根据以下要求生成高质量考试题。

要求：
- 考试类目: ${trackName}
- 训练方向: ${focusName}
- 组卷模式: ${modeText}
- 科目分类: ${catName}
- 难度等级: ${diffName}
- 题目数量: ${count} 道
- 题目类型: 单选题（4个选项）
${focusDirective ? `- 方向约束: ${focusDirective}` : ''}
${currentAffairsDirective ? `- 时政约束: ${currentAffairsDirective}` : ''}
${config.customPrompt ? `- 额外要求: ${config.customPrompt}` : ''}

请严格按以下 JSON 格式输出，不要输出其他内容：
{
  "questions": [
    {
      "content": "题目内容（完整的题干描述）",
      "options": [
        {"key": "A", "content": "选项A"},
        {"key": "B", "content": "选项B"},
        {"key": "C", "content": "选项C"},
        {"key": "D", "content": "选项D"}
      ],
      "answer": "正确答案字母",
      "analysis": "题目解析",
      "difficulty": ${config.difficulty},
      "category": "${defaultCategory}",
      "subCategory": ""
    }
  ]
}

注意：
1. 每道题目必须有完整题干、4个选项、正确答案和解析
2. 题目质量要高，不能有常识性错误
3. 难度要符合要求，不能过简单也不能过难
4. ${analysisMode}
5. ${categoryLimit}
6. 只输出 JSON，不要有其他文字`;
}

function getGenerateMaxOutputTokens(config) {
  const count = Math.max(1, Number(config?.count) || 10);
  const perQuestion = (config?.analysisMode === 'thinking' ? 360 : 300) + (config?.includeCurrentAffairs ? 50 : 0);
  return Math.max(1200, Math.min(10000, count * perQuestion));
}

function normalizeGeneratedOptions(question) {
  const raw = question?.options;
  if (Array.isArray(raw)) {
    const list = raw
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        key: String(item.key || String.fromCharCode(65 + index)).toUpperCase(),
        content: String(item.content || '').trim(),
      }))
      .filter((item) => item.content);
    if (list.length >= 2) return list.slice(0, 6);
  }

  const fallbackKeys = ['A', 'B', 'C', 'D', 'E', 'F'];
  const fallback = fallbackKeys
    .map((key) => {
      const direct = question?.[key] ?? question?.[`option${key}`] ?? question?.[`option_${key.toLowerCase()}`];
      return { key, content: String(direct || '').trim() };
    })
    .filter((item) => item.content);
  return fallback;
}

function normalizeGeneratedQuestions(rawQuestions, config) {
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  const targetCategories = getTargetCategories(config);
  return list.map((question, index) => {
    const content = String(question?.content || '').trim();
    const options = normalizeGeneratedOptions(question);
    const answer = String(question?.answer || '').trim().toUpperCase();
    if (!content || options.length < 2) return null;
    const fallbackCategory = targetCategories[index % Math.max(targetCategories.length, 1)] || 'changshi';
    let category = String(question?.category || '').trim();
    if (!category) {
      category = fallbackCategory;
    } else if (config?.mode === 'mixed' && targetCategories.length && !targetCategories.includes(category)) {
      category = fallbackCategory;
    }
    return {
      content,
      options,
      answer,
      analysis: String(question?.analysis || '').trim(),
      difficulty: Math.max(1, Math.min(5, Number(question?.difficulty) || Number(config?.difficulty) || 3)),
      category,
      subCategory: String(question?.subCategory || question?.sub_category || '').trim(),
    };
  }).filter(Boolean);
}

async function createOpenAIGenerateText(client, model, normalizedSettings, prompt, maxOutputTokens) {
  const startedAt = Date.now();
  // 对 responses 模式优先走 chat.completions，很多兼容网关该路径更快
  if (normalizedSettings.apiFormat === 'responses') {
    let fastError = null;
    try {
      const fastStartedAt = Date.now();
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxOutputTokens,
      });
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return {
          text: content,
          route: 'chat_completions_fast',
          routeElapsedMs: Date.now() - fastStartedAt,
          elapsedMs: Date.now() - startedAt,
        };
      }
      if (Array.isArray(content)) {
        const text = content
          .map((item) => normalizeStringContent(item))
          .filter(Boolean)
          .join('\n');
        if (text.trim()) {
          return {
            text,
            route: 'chat_completions_fast',
            routeElapsedMs: Date.now() - fastStartedAt,
            elapsedMs: Date.now() - startedAt,
          };
        }
      }
      fastError = new Error('chat_completions_fast 返回为空');
    } catch (error) {
      fastError = error;
    }

    const fallbackStartedAt = Date.now();
    const text = await createOpenAITextResponse(client, model, normalizedSettings.apiFormat, {
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens,
    });
    return {
      text,
      route: 'responses_fallback',
      routeElapsedMs: Date.now() - fallbackStartedAt,
      elapsedMs: Date.now() - startedAt,
      fastError: compactError(fastError),
    };
  }

  const genericStartedAt = Date.now();
  const text = await createOpenAITextResponse(client, model, normalizedSettings.apiFormat, {
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens,
  });
  return {
    text,
    route: normalizedSettings.apiFormat || 'chat_completions',
    routeElapsedMs: Date.now() - genericStartedAt,
    elapsedMs: Date.now() - startedAt,
  };
}

function compactError(error) {
  if (!error) return '';
  const msg = String(error.message || error || '').trim();
  return msg || '未知错误';
}

function toSafeApiHost(apiBase) {
  const value = String(apiBase || '').trim();
  if (!value) return '';
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch (error) {
    return value;
  }
}

async function generatePaper(settings, config) {
  const { type, client, model, settings: normalizedSettings } = createClient(settings);
  const prompt = buildGeneratePrompt(config);
  const maxOutputTokens = getGenerateMaxOutputTokens(config);
  const requestId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();

  console.info(`[AI][Generate][${requestId}] start`, {
    provider: normalizedSettings.aiProvider || '',
    model,
    apiFormat: normalizedSettings.apiFormat || '',
    apiBase: toSafeApiHost(normalizedSettings.apiBase),
    track: config?.track,
    focus: config?.focus,
    mode: config?.mode,
    category: config?.category,
    mixedCategories: Array.isArray(config?.mixedCategories) ? config.mixedCategories.join(',') : '',
    difficulty: config?.difficulty,
    count: config?.count,
    maxOutputTokens,
  });

  try {
    let resultText = '';

    if (type === 'anthropic') {
      const routeStartedAt = Date.now();
      const response = await client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      resultText = response.content?.[0]?.text || '';
      console.info(`[AI][Generate][${requestId}] route`, {
        route: 'anthropic_messages',
        routeElapsedMs: Date.now() - routeStartedAt,
      });
    } else {
      const routeResult = await createOpenAIGenerateText(client, model, normalizedSettings, prompt, maxOutputTokens);
      resultText = routeResult.text;
      console.info(`[AI][Generate][${requestId}] route`, {
        route: routeResult.route,
        routeElapsedMs: routeResult.routeElapsedMs,
        fastError: routeResult.fastError || '',
      });
    }

    console.info(`[AI][Generate][${requestId}] model_response`, {
      elapsedMs: Date.now() - startedAt,
      textLength: String(resultText || '').length,
    });

    const parsed = extractJSONObject(resultText);
    const questions = normalizeGeneratedQuestions(parsed.questions, config);
    if (!questions.length) {
      throw new Error('题目格式不完整：缺少有效选项');
    }
    console.info(`[AI][Generate][${requestId}] success`, {
      elapsedMs: Date.now() - startedAt,
      questions: questions.length,
    });
    return { success: true, questions, debugId: requestId };
  } catch (error) {
    const rawPreview = typeof error?.raw === 'string'
      ? error.raw.slice(0, 400)
      : '';
    console.error(`[AI][Generate][${requestId}] failed`, {
      elapsedMs: Date.now() - startedAt,
      error: compactError(error),
      stack: String(error?.stack || '').split('\n').slice(0, 3).join(' | '),
      rawPreview,
    });
    return { success: false, error: compactError(error) || '出卷失败', questions: [], debugId: requestId };
  }
}

async function testConnection(settings) {
  try {
    const { type, client, model, settings: normalizedSettings } = createClient(settings);

    if (type === 'anthropic') {
      await client.messages.create({
        model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } else if (normalizedSettings.apiFormat === 'responses') {
      await client.responses.create({
        model,
        input: 'Hi',
        max_output_tokens: 10,
      });
    } else {
      await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/* ==================================================================
   申论批改
   ================================================================== */

const ESSAY_GRADER_SYSTEM = buildSystem(`你是一位阅卷经验丰富的公考申论阅卷老师。你的任务是按评分标准客观批改考生答案，不是鼓励，也不是教学。
批改必须做到：
1. 逐条对照采分点，明确指出考生写到了哪些、漏了哪些
2. 漏点要说清楚"材料里在哪、为什么该写、为什么考生会漏"
3. 打分严格按要点覆盖为主，语言表述为辅，不放水
4. 只输出 JSON，不要任何解释性文字、不要代码块标记`);

const ESSAY_TYPE_LABEL = {
  guina: '归纳概括',
  duice: '提出对策',
  fenxi: '综合分析',
  guanche: '贯彻执行',
  dazuowen: '大作文',
};

function buildEssayGradePrompt(payload = {}) {
  const {
    essayType = 'guina',
    material = '',
    requirement = '',
    wordLimit,
    referenceAnswer = '',
    scoringPoints = [],
    answer = '',
  } = payload;

  const typeLabel = ESSAY_TYPE_LABEL[essayType] || '归纳概括';
  const limitText = wordLimit ? `${wordLimit} 字以内` : '未限制字数';

  const reference = referenceAnswer
    ? `\n【参考答案】\n${wrapUntrusted('参考答案', referenceAnswer)}\n`
    : '';
  const points = Array.isArray(scoringPoints) && scoringPoints.length
    ? `\n【已知采分点】\n${wrapUntrustedList(
      '采分点',
      scoringPoints.map((p) => (typeof p === 'string' ? p : p.text || ''))
    )}\n`
    : '\n【采分点】未提供，请你先从材料中自行提炼应得的采分点，再据此批改。\n';

  return `请批改下面这道申论「${typeLabel}」题。

【给定材料】
${wrapUntrusted('给定材料', material)}

【题目要求】
${wrapUntrusted('题目要求', requirement)}
字数要求：${limitText}
${points}${reference}
【考生答案】
${wrapUntrusted('考生答案', answer)}

按下面的 JSON 结构输出批改结果：
{
  "score": 得分数字,
  "maxScore": 满分数字,
  "wordCount": 考生答案字数,
  "dimensions": [
    {"name":"要点覆盖","score":数字,"max":数字,"comment":"一句话点评"},
    {"name":"概括层次","score":数字,"max":数字,"comment":"..."},
    {"name":"语言规范","score":数字,"max":数字,"comment":"..."},
    {"name":"字数控制","score":数字,"max":数字,"comment":"..."}
  ],
  "points": [
    {"text":"采分点内容","hit":true或false,"evidence":"材料出处或考生原文","why":"漏掉时说明为什么该写、为什么容易漏"}
  ],
  "summary": "整体评价，两三句话",
  "improvements": ["下次要注意的具体动作，两到四条"]
}

要点覆盖占分最重。points 数组要把所有采分点都列出来，命中的 hit 为 true。`;
}

async function callModelForJSON(settings, system, prompt, maxOutputTokens = 4096) {
  const { type, client, model, settings: normalized } = createClient(settings);
  if (type === 'anthropic') {
    const response = await client.messages.create({
      model,
      max_tokens: maxOutputTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content?.[0]?.text || '';
  }
  return createOpenAITextResponse(client, model, normalized.apiFormat, {
    instructions: system,
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens,
  });
}

async function gradeEssay(settings, payload) {
  try {
    const text = await callModelForJSON(
      settings,
      ESSAY_GRADER_SYSTEM,
      buildEssayGradePrompt(payload),
      4096
    );
    const parsed = extractJSONObject(text);
    if (!parsed) {
      return { success: false, error: '模型没有返回可解析的批改结果，请重试' };
    }
    return { success: true, review: parsed };
  } catch (error) {
    return { success: false, error: compactError(error) };
  }
}

// ─── 通用主观题批改（简答 / 论述 / 案例 / 写作）──────────────────────────────
const SUBJECTIVE_GRADER_SYSTEM = buildSystem(
  '你是通用主观题阅卷老师，适用于简答、论述、案例分析、写作等题型。依据题干、参考答案和评分点给分，不臆造要求、不遗漏采分点。只输出 JSON。'
);

function buildSubjectiveGradePrompt(payload = {}) {
  const content = String(payload.content || '').trim();
  const answer = String(payload.userAnswer || '').trim();
  const reference = String(payload.referenceAnswer || '').trim();
  const rubric = String(payload.rubric || '').trim();
  const wordLimit = Number(payload.wordLimit) || 0;
  const maxScore = Number(payload.maxScore) || 10;

  return `请批改下面这份主观题作答。

题干：
${wrapUntrusted('题干', content)}
${reference ? `\n参考答案：\n${wrapUntrusted('参考答案', reference)}` : ''}
${rubric ? `\n评分点：\n${wrapUntrusted('评分点', rubric)}` : ''}
${wordLimit > 0 ? `\n字数要求：不超过 ${wordLimit} 字。` : ''}

考生作答：
${wrapUntrusted('考生作答', answer)}

按下面的 JSON 输出，不要输出多余文字：
{
  "score": 得分数字,
  "maxScore": ${maxScore},
  "wordCount": 作答字数,
  "dimensions": [
    {"name":"要点覆盖","score":数字,"max":数字,"comment":"一句话点评"},
    {"name":"逻辑结构","score":数字,"max":数字,"comment":"..."},
    {"name":"表达规范","score":数字,"max":数字,"comment":"..."}
  ],
  "points": [
    {"text":"采分点","hit":true或false,"evidence":"考生原文","why":"漏掉时说明为什么该写"}
  ],
  "summary": "整体评价，两三句话",
  "improvements": ["下次要注意的具体动作，两到四条"]
}

评分以要点覆盖为主；没有参考答案时按通用标准给分。`;
}

function pickScore(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSubjectiveReview(raw = {}) {
  const maxScore = Math.max(1, pickScore(raw.maxScore, 10));
  return {
    score: Math.max(0, Math.min(maxScore, pickScore(raw.score, 0))),
    maxScore,
    wordCount: Math.max(0, pickScore(raw.wordCount, 0)),
    dimensions: (Array.isArray(raw.dimensions) ? raw.dimensions : []).slice(0, 6).map((item) => ({
      name: String(item?.name || ''),
      score: pickScore(item?.score, 0),
      max: pickScore(item?.max, 0),
      comment: String(item?.comment || ''),
    })),
    points: (Array.isArray(raw.points) ? raw.points : []).slice(0, 20).map((item) => ({
      text: String(item?.text || ''),
      hit: Boolean(item?.hit),
      evidence: String(item?.evidence || ''),
      why: String(item?.why || ''),
    })),
    summary: String(raw.summary || ''),
    improvements: (Array.isArray(raw.improvements) ? raw.improvements : []).slice(0, 5).map(String),
    provider: 'ai',
  };
}

async function gradeSubjective(settings, payload = {}) {
  const answer = String(payload.userAnswer || '').trim();
  if (!answer) return { success: false, error: '没有作答内容' };
  try {
    const text = await callModelForJSON(
      settings,
      SUBJECTIVE_GRADER_SYSTEM,
      buildSubjectiveGradePrompt(payload),
      3072
    );
    const parsed = extractJSONObject(text);
    if (!parsed) {
      return { success: false, error: '模型没有返回可解析的批改结果，请重试' };
    }
    return { success: true, review: normalizeSubjectiveReview(parsed) };
  } catch (error) {
    return { success: false, error: compactError(error) };
  }
}

const ESSAY_OCR_SYSTEM = buildSystem(`你是申论真题录入助手。从图片里原样提取给定材料和题目，不要改写、不要总结、不要补充。只输出 JSON。`);

/** 从图片里扒出申论题：材料 / 题干 / 要求 / 字数 */
async function recognizeEssay(settings, imageBase64, mimeType = 'image/png') {
  const prompt = `识别这张图片里的申论题目，按下面的 JSON 输出：
{
  "title": "题目标题，没有就用题干前 20 字",
  "essayType": "guina|duice|fenxi|guanche|dazuowen 之一",
  "material": "给定材料全文，保留段落编号和换行",
  "requirement": "作答要求原文",
  "wordLimit": 字数上限数字，没有则 null,
  "province": "省份，认不出填 null",
  "year": 年份数字，认不出填 null
}
材料要一字不漏地抄下来，这是批改的依据。`;

  try {
    const { type, client, model, settings: normalized } = createClient(settings);
    let text = '';
    if (type === 'anthropic') {
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: ESSAY_OCR_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });
      text = response.content?.[0]?.text || '';
    } else {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: ESSAY_OCR_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
      text = response.choices?.[0]?.message?.content || '';
      void normalized;
    }

    const parsed = extractJSONObject(text);
    if (!parsed) return { success: false, error: '没能从图片里识别出申论题，换一张更清晰的试试' };
    return { success: true, prompt: parsed };
  } catch (error) {
    return { success: false, error: compactError(error) };
  }
}

/* ==================================================================
   AI 变式训练（两段式：生成 → 终审）
   ================================================================== */
const VARIANT_CREATE_SYSTEM = buildSystem(`你是一位命题专家。任务是基于一道原题，另出一道「同一考点、不同问法」的单项选择题，用于巩固训练。
硬性要求：
1. 考点必须与原题一致，但情境、数据、表述都要换，不能只是改数字
2. 四个选项只能有一个正确答案，其余三个必须是常见误区，不能出现两个都对的模糊项
3. 选项内容简洁，单条不超过 40 字
4. 必须给出 80 字以内的解析，说明为什么选它、其他选项错在哪
5. 只输出 JSON，不要代码块标记`);

const VARIANT_REVIEW_SYSTEM = buildSystem(`你是命题质量审核员。检查一道 AI 生成的变式题是否可用。
检查项：
1. 是否只有一个正确选项，answer 字段与选项完全对应
2. 是否存在与正确答案等价、同样成立的选项
3. 题干是否有歧义、缺少必要条件
4. 选项是否重复或明显凑数
只输出 JSON：{"pass":true或false,"issues":["问题描述"],"fixedAnswer":"若答案明显错误可给出修正选项字母，否则留空"}`);

function buildVariantCreatePrompt(payload = {}) {
  const { content = '', options = [], answer = '', analysis = '' } = payload;
  const optionText = (Array.isArray(options) ? options : [])
    .map((option) => `${option?.key || ''}. ${option?.content || ''}`)
    .join('\n');
  return `请基于下面这道原题，出一道同考点的变式题。

【原题题干】
${wrapUntrusted('原题题干', content)}

【原题选项】
${wrapUntrusted('原题选项', optionText)}

【原题答案】
${wrapUntrusted('原题答案', answer)}

${analysis ? `【原题解析】\n${wrapUntrusted('原题解析', analysis)}\n` : ''}
按下面的 JSON 输出：
{
  "content": "变式题题干",
  "options": [{"key":"A","content":"..."},{"key":"B","content":"..."},{"key":"C","content":"..."},{"key":"D","content":"..."}],
  "answer": "正确选项字母",
  "analysis": "80 字以内解析",
  "point": "本题考点一句话"
}`;
}

function buildVariantReviewPrompt(variant = {}) {
  const optionText = (Array.isArray(variant.options) ? variant.options : [])
    .map((option) => `${option?.key || ''}. ${option?.content || ''}`)
    .join('\n');
  return `请审核下面这道变式题：

【题干】
${wrapUntrusted('变式题题干', variant.content || '')}

【选项】
${wrapUntrusted('变式题选项', optionText)}

【标称答案】
${wrapUntrusted('标称答案', variant.answer || '')}

【解析】
${wrapUntrusted('变式题解析', variant.analysis || '')}

只输出 JSON：{"pass":true或false,"issues":["..."],"fixedAnswer":""}`;
}

function normalizeVariant(raw, fallbackPoint = '') {
  const options = Array.isArray(raw?.options)
    ? raw.options
      .map((option, index) => ({
        key: String(option?.key || String.fromCharCode(65 + index)).trim().slice(0, 2),
        content: String(option?.content || '').trim(),
      }))
      .filter((option) => option.content)
    : [];
  const answer = String(raw?.answer || '').trim().toUpperCase().slice(0, 2);
  return {
    content: String(raw?.content || '').trim(),
    options,
    answer,
    analysis: String(raw?.analysis || '').trim(),
    point: String(raw?.point || fallbackPoint || '').trim(),
  };
}

async function createVariantQuestion(settings, payload = {}) {
  try {
    const raw = await callModelForJSON(settings, VARIANT_CREATE_SYSTEM, buildVariantCreatePrompt(payload), 1200);
    const parsed = extractJSONObject(raw);
    if (!parsed) return { success: false, error: 'AI 没返回合法 JSON，请重试' };
    const variant = normalizeVariant(parsed);
    if (!variant.content || variant.options.length < 2 || !variant.answer) {
      return { success: false, error: '生成的变式题不完整，请重试' };
    }
    if (!variant.options.some((option) => option.key === variant.answer)) {
      return { success: false, error: '生成题目的答案与选项不匹配，请重试' };
    }
    return { success: true, variant };
  } catch (error) {
    return { success: false, error: compactError(error) || '变式题生成失败' };
  }
}

async function reviewVariantQuestion(settings, variant = {}) {
  try {
    const raw = await callModelForJSON(settings, VARIANT_REVIEW_SYSTEM, buildVariantReviewPrompt(variant), 600);
    const parsed = extractJSONObject(raw) || {};
    const fixed = String(parsed.fixedAnswer || '').trim().toUpperCase();
    return {
      success: true,
      pass: parsed.pass === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => String(item).slice(0, 80)).slice(0, 4) : [],
      fixedAnswer: fixed && (variant.options || []).some((option) => option.key === fixed) ? fixed : '',
    };
  } catch (error) {
    // 终审失败不阻塞训练，按「未通过」处理并说明原因
    return { success: false, pass: false, issues: [compactError(error) || '终审失败'], fixedAnswer: '' };
  }
}

/* ==================================================================
   错题归因（AI 讲解输出主标签，回填错题本错因）
   ================================================================== */
const WRONG_CAUSE_KEYS = ['knowledge', 'reading', 'calculation', 'strategy', 'time'];
const WRONG_CAUSE_LABELS = {
  knowledge: '知识缺口',
  reading: '审题偏差',
  calculation: '计算失误',
  strategy: '策略不当',
  time: '时间失控',
};

const WRONG_CAUSE_SYSTEM = buildSystem(`你是一位错题归因分析师。任务是判断学生做错这道题的「主要原因」，不是讲知识点，也不要重复解析。
归因只能落在五类之一：
- knowledge 知识缺口：考点没掌握，概念不清
- reading 审题偏差：看错问题、漏掉限定条件、误读选项
- calculation 计算失误：思路正确但算错、抄错数据
- strategy 策略不当：方法选错、解题顺序不合理、该代入却硬算
- time 时间失控：耗时过长挤占其他题，或匆忙作答
只输出 JSON：{"cause":"knowledge|reading|calculation|strategy|time","reason":"一句话说明依据，30 字以内"}`);

function buildWrongCausePrompt(payload = {}) {
  const { content = '', options = [], userAnswer = '', correctAnswer = '', analysis = '' } = payload;
  const optionText = (Array.isArray(options) ? options : [])
    .map((option) => `${option?.key || ''}. ${option?.content || ''}`)
    .join('\n');

  return `请判断这道题的错因。

【题目】
${wrapUntrusted('题干', content)}

【选项】
${wrapUntrusted('选项', optionText)}

【正确答案】
${wrapUntrusted('正确答案', correctAnswer)}

【学生答案】
${wrapUntrusted('学生答案', userAnswer)}
${analysis ? `\n【解析】\n${wrapUntrusted('解析', analysis)}\n` : ''}
只输出 JSON：{"cause":"...","reason":"..."}`;
}

async function analyzeWrongCause(settings, payload = {}) {
  try {
    const raw = await callModelForJSON(settings, WRONG_CAUSE_SYSTEM, buildWrongCausePrompt(payload), 512);
    const parsed = extractJSONObject(raw) || {};
    const cause = String(parsed.cause || '').trim().toLowerCase();
    if (!WRONG_CAUSE_KEYS.includes(cause)) {
      return { success: false, error: 'AI 未给出有效错因，请手动选择' };
    }
    return {
      success: true,
      cause,
      causeLabel: WRONG_CAUSE_LABELS[cause],
      reason: String(parsed.reason || '').slice(0, 120),
    };
  } catch (error) {
    return { success: false, error: compactError(error) || '归因失败' };
  }
}

module.exports = {
  recognizeQuestions,
  gradeEssay,
  gradeSubjective,
  recognizeEssay,
  analyzeWrongCause,
  createVariantQuestion,
  reviewVariantQuestion,
  testConnection,
  chat,
  chatStream,
  generatePaper,
};
