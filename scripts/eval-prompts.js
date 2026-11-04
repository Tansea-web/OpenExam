/**
 * Prompt 离线评测（P2）
 *
 * 用固定题集跑一遍真实模型，输出五类确定性指标：
 *   1. JSON 契约通过率
 *   2. 金标命中率（错因 cause / 变式答案）
 *   3. 禁含词命中（提示注入泄漏迹象）
 *   4. 分数上限合理性（申论 score <= maxScore）
 *   5. 平均耗时
 *
 * 未配置 API Key 时直接跳过（exit 0），不阻塞 CI。
 * 用法：npm run eval:ai
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const CASES_FILE = path.join(ROOT, 'eval/prompt-cases.jsonl');
const REPORT_FILE = path.join(ROOT, 'eval/last-report.json');

if (process.env.APPDATA) {
  app.setPath('userData', path.join(process.env.APPDATA, 'openexam'));
}
delete process.env.VITE_DEV_SERVER_URL;

const DEFAULT_FORBIDDEN = ['UNTRUSTED_TASK_DATA', '安全规则', '系统提示词', 'api_key', 'sk-'];

function loadCases() {
  const raw = fs.readFileSync(CASES_FILE, 'utf8');
  return raw.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`第 ${index + 1} 行 JSON 解析失败: ${error.message}`);
    }
  });
}

function textOfReview(review) {
  try {
    return JSON.stringify(review || {});
  } catch (error) {
    return '';
  }
}

async function runCase(ai, settings, item) {
  const started = Date.now();
  let output = null;
  let contract = false;
  let goldHit = null;
  let scoreSanity = null;

  if (item.type === 'cause') {
    output = await ai.analyzeWrongCause(settings, item.payload);
    contract = Boolean(output?.success && output?.cause);
    goldHit = item.expect?.cause ? output?.cause === item.expect.cause : null;
  } else if (item.type === 'essay') {
    output = await ai.gradeEssay(settings, item.payload);
    const review = output?.review || {};
    contract = Boolean(output?.success && typeof review.score === 'number' && Array.isArray(review.points));
    scoreSanity = typeof review.score === 'number' && typeof review.maxScore === 'number'
      ? review.score >= 0 && review.score <= review.maxScore
      : null;
  } else if (item.type === 'variant') {
    const created = await ai.createVariantQuestion(settings, item.payload);
    if (created?.success) {
      const reviewed = await ai.reviewVariantQuestion(settings, created.variant);
      output = { ...created, review: reviewed };
      const options = created.variant.options || [];
      contract = Boolean(created.variant.content) && options.some((option) => option.key === created.variant.answer);
      goldHit = item.expect?.uniqueAnswer ? reviewed?.pass === true : null;
    } else {
      output = created;
    }
  }

  const text = textOfReview(output);
  const forbidden = [...(item.expect?.forbidden || []), ...DEFAULT_FORBIDDEN];
  const leaks = forbidden.filter((word) => word && text.includes(word));

  return {
    id: item.id,
    type: item.type,
    contract,
    goldHit,
    scoreSanity,
    leaks,
    elapsed: Date.now() - started,
    error: output?.error || '',
  };
}

app.whenReady().then(async () => {
  let failed = 0;
  try {
    const database = require(path.join(ROOT, 'src/main/database.js'));
    const ai = require(path.join(ROOT, 'src/main/ai/index.js'));
    database.initDatabase();

    const settings = database.resolveAISecrets(database.getAISettings() || {});
    if (!settings?.apiKey) {
      console.log('[eval] 跳过：未配置 AI Key（设置 → AI 模型 里填好后再跑）');
      app.quit();
      return;
    }

    const cases = loadCases();
    console.log(`[eval] 开始评测 ${cases.length} 条用例，模型 ${settings.model || '(未设置)'}\n`);

    const results = [];
    for (const item of cases) {
      const result = await runCase(ai, settings, item);
      results.push(result);
      const flags = [
        result.contract ? '契约✓' : '契约✗',
        result.goldHit === null ? '' : result.goldHit ? '金标✓' : '金标✗',
        result.scoreSanity === null ? '' : result.scoreSanity ? '分数✓' : '分数✗',
        result.leaks.length ? `泄漏:${result.leaks.join(',')}` : '',
        result.error ? `错误:${result.error}` : '',
      ].filter(Boolean).join(' ');
      console.log(`  ${result.id.padEnd(16)} ${String(result.elapsed).padStart(6)}ms  ${flags}`);
      // 硬失败只有三类：结构契约、提示词泄漏、分数越界。
      // 金标命中是软指标（错因判定本身有主观性），只统计不计入退出码。
      if (!result.contract || result.leaks.length || result.scoreSanity === false) {
        failed += 1;
      }
    }

    const contractRate = Math.round((results.filter((item) => item.contract).length / results.length) * 100);
    const goldCases = results.filter((item) => item.goldHit !== null);
    const goldRate = goldCases.length
      ? Math.round((goldCases.filter((item) => item.goldHit).length / goldCases.length) * 100)
      : null;
    const leakCount = results.reduce((sum, item) => sum + item.leaks.length, 0);
    const avgElapsed = Math.round(results.reduce((sum, item) => sum + item.elapsed, 0) / results.length);

    const report = {
      generatedAt: new Date().toISOString(),
      model: settings.model || '',
      total: results.length,
      contractRate,
      goldRate,
      leakCount,
      avgElapsed,
      failed,
      results,
    };
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n[eval] 汇总');
    console.log(`  JSON 契约通过率 : ${contractRate}%`);
    console.log(`  金标命中率      : ${goldRate === null ? 'n/a' : `${goldRate}%`}`);
    console.log(`  禁含词命中      : ${leakCount}`);
    console.log(`  平均耗时        : ${avgElapsed}ms`);
    console.log(`  失败用例        : ${failed}`);
    console.log(`  报告            : ${REPORT_FILE}`);

    if (failed > 0) {
      console.log('\n[eval] 存在失败用例，退出码 1');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[eval] 执行失败:', error.message);
    process.exitCode = 1;
  }
  app.quit();
});
