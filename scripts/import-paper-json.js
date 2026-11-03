/**
 * 把 JSON 题库导入用户数据库（支持指定类目/科目）
 *
 * 用法：
 *   npm run import:paper -- data/original/oe_neteng_001.json
 *   npm run import:paper -- <file.json> --subject computer --db <path> --replace
 *
 * JSON 结构：
 *   { "paper": { "title": "...", "year": 2026, "subject": "computer" },
 *     "questions": [{ "content": "...", "options": [{ "key": "A", "content": "..." }], "answer": "A" }] }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { normalizeQuestionTaxonomy } = require('../src/shared/questionCategory');

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = args.filter((item) => !item.startsWith('--'));
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    file: positional[0],
    dbPath: valueOf('--db'),
    subject: valueOf('--subject'),
    replace: args.includes('--replace'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function resolveUserDbPath() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'openexam', 'openexam.db');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/openexam/openexam.db');
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'openexam', 'openexam.db');
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option, index) => {
      if (option && typeof option === 'object') {
        return {
          key: String(option.key || String.fromCharCode(65 + index)).toUpperCase(),
          content: String(option.content || option.text || ''),
        };
      }
      return { key: String.fromCharCode(65 + index), content: String(option || '') };
    })
    .filter((option) => option.content);
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.file) {
    console.log('用法: npm run import:paper -- <file.json> [--subject computer] [--db <path>] [--replace]');
    process.exit(options.help ? 0 : 1);
  }

  const sourcePath = path.resolve(process.cwd(), options.file);
  if (!fs.existsSync(sourcePath)) throw new Error(`未找到题库文件: ${sourcePath}`);

  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const paper = raw.paper || {};
  const questions = Array.isArray(raw) ? raw : (raw.questions || []);
  if (!questions.length) throw new Error('题库文件里没有 questions');

  const dbPath = options.dbPath ? path.resolve(process.cwd(), options.dbPath) : resolveUserDbPath();
  if (!fs.existsSync(dbPath)) throw new Error(`未找到数据库: ${dbPath}`);

  const title = String(paper.title || path.basename(sourcePath, '.json')).trim();
  const subject = String(options.subject || paper.subject || 'xingce').trim() || 'xingce';
  const year = Number(paper.year) || new Date().getFullYear();

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const existing = db.prepare('SELECT id, type FROM papers WHERE title = ?').all(title);
  if (existing.length && !options.replace) {
    console.log(`已存在同名试卷「${title}」，跳过。加 --replace 可重复导入。`);
    db.close();
    return;
  }

  const cleanup = db.transaction(() => {
    existing.forEach((row) => {
      db.prepare('DELETE FROM questions WHERE paper_id = ?').run(row.id);
      db.prepare('DELETE FROM papers WHERE id = ?').run(row.id);
    });
  });
  if (existing.length) cleanup();

  const paperId = `paper_import_${Date.now()}`;
  const insertPaper = db.prepare(`
    INSERT INTO papers (id, title, year, type, subject, province, question_count, duration, difficulty, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertQuestion = db.prepare(`
    INSERT INTO questions (id, paper_id, order_num, type, category, sub_category, content, content_html,
      material_html, material_group_id, options, answer, analysis, analysis_html, difficulty, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let inserted = 0;
  db.transaction(() => {
    insertPaper.run(
      paperId,
      title,
      year,
      'imported',
      subject,
      paper.province || null,
      questions.length,
      Number(paper.durationMin || paper.duration) || Math.max(20, questions.length * 2),
      Number(paper.difficulty) || 3
    );

    questions.forEach((question, index) => {
      const content = String(question.content || '').trim();
      const optionList = normalizeOptions(question.options);
      if (!content || optionList.length < 2) return;

      const taxonomy = normalizeQuestionTaxonomy({
        category: question.category,
        subCategory: question.subCategory || question.sub_category,
        content,
      });

      insertQuestion.run(
        `${paperId}_q${index + 1}`,
        paperId,
        index + 1,
        String(question.type || 'single').toLowerCase(),
        taxonomy.category,
        taxonomy.subCategory,
        content,
        question.contentHtml || null,
        question.materialHtml || null,
        question.materialGroupId || null,
        JSON.stringify(optionList),
        String(question.answer || '').trim().toUpperCase(),
        String(question.analysis || ''),
        question.analysisHtml || null,
        Math.max(1, Math.min(5, Number(question.difficulty) || 2)),
        String(question.source || question.tags || '').trim()
      );
      inserted += 1;
    });
  })();

  const summary = db.prepare(`
    SELECT category, COUNT(*) AS count FROM questions WHERE paper_id = ? GROUP BY category
  `).all(paperId);

  db.close();

  console.log(`已导入「${title}」`);
  console.log(`  目标题库 subject=${subject}，${inserted} 道题`);
  summary.forEach((row) => console.log(`  ${row.category}: ${row.count}`));
}

try {
  main();
} catch (error) {
  console.error(`导入失败: ${error.message}`);
  process.exit(1);
}
