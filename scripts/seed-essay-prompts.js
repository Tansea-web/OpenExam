/**
 * 内置申论题导入脚本
 *
 * 用法（需用 electron 运行，因为 better-sqlite3 编译的是 electron ABI）：
 *   npm run seed:essay                 # 写入当前用户数据库
 *   npm run seed:essay -- --force      # 覆盖同 id 的记录（默认跳过）
 *   npm run seed:essay -- --db <path>  # 指定数据库文件
 *   npm run seed:essay -- --seed       # 同时写入 data/openexam.seed.db.gz（打包用）
 *
 * 题目数据来自 data/essay-prompts.json，按 id 幂等写入，重复执行不会产生重复题。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

const DATA_PATH = path.join(__dirname, '../data/essay-prompts.json');
const SEED_GZ_PATH = path.join(__dirname, '../data/openexam.seed.db.gz');

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS essay_prompts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    essay_type TEXT DEFAULT 'guina',
    track TEXT DEFAULT 'gongwuyuan',
    province TEXT,
    year INTEGER,
    material TEXT,
    requirement TEXT,
    word_limit INTEGER,
    duration INTEGER,
    reference_answer TEXT,
    scoring_points TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_essay_prompts_type ON essay_prompts(essay_type);
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    help: args.includes('--help') || args.includes('-h'),
    force: args.includes('--force'),
    withSeed: args.includes('--seed'),
    dbPath: valueOf('--db'),
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

function loadPrompts() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const prompts = Array.isArray(raw) ? raw : raw.prompts;
  if (!Array.isArray(prompts) || !prompts.length) {
    throw new Error(`题目数据为空: ${DATA_PATH}`);
  }
  return prompts;
}

function normalizePrompt(prompt) {
  const title = String(prompt.title || '').trim();
  if (!prompt.id || !title) {
    throw new Error(`题目标题或 id 缺失: ${JSON.stringify(prompt).slice(0, 80)}`);
  }
  if (!prompt.material || !prompt.requirement) {
    throw new Error(`题目缺少给定材料或作答要求: ${prompt.id}`);
  }
  return {
    id: String(prompt.id).trim(),
    title,
    essayType: prompt.essayType || 'guina',
    track: prompt.track === 'shiye' ? 'shiye' : 'gongwuyuan',
    province: prompt.province || null,
    year: Number(prompt.year) || null,
    material: String(prompt.material),
    requirement: String(prompt.requirement),
    wordLimit: Number(prompt.wordLimit) || null,
    duration: Number(prompt.duration) || null,
    referenceAnswer: String(prompt.referenceAnswer || ''),
    scoringPoints: JSON.stringify(Array.isArray(prompt.scoringPoints) ? prompt.scoringPoints : []),
    source: prompt.source || 'builtin',
  };
}

function upsertPrompts(db, prompts, options = {}) {
  db.exec(TABLE_SQL);
  const force = Boolean(options.force);

  const selectOne = db.prepare('SELECT id FROM essay_prompts WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO essay_prompts
      (id, title, essay_type, track, province, year, material, requirement,
       word_limit, duration, reference_answer, scoring_points, source)
    VALUES
      (@id, @title, @essayType, @track, @province, @year, @material, @requirement,
       @wordLimit, @duration, @referenceAnswer, @scoringPoints, @source)
  `);
  const update = db.prepare(`
    UPDATE essay_prompts SET
      title = @title, essay_type = @essayType, track = @track, province = @province,
      year = @year, material = @material, requirement = @requirement,
      word_limit = @wordLimit, duration = @duration,
      reference_answer = @referenceAnswer, scoring_points = @scoringPoints,
      source = @source
    WHERE id = @id
  `);

  const stats = { inserted: 0, updated: 0, skipped: 0 };

  db.transaction(() => {
    for (const prompt of prompts) {
      const params = normalizePrompt(prompt);
      if (selectOne.get(params.id)) {
        if (!force) {
          stats.skipped += 1;
          continue;
        }
        update.run(params);
        stats.updated += 1;
        continue;
      }
      insert.run(params);
      stats.inserted += 1;
    }
  })();

  stats.total = db.prepare('SELECT COUNT(*) AS c FROM essay_prompts').get().c;
  return stats;
}

function writeUserDatabase(dbPath, prompts, options) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `未找到数据库: ${dbPath}\n请先启动一次应用（npm run dev）让它初始化用户库，或用 --db 指定路径。`
    );
  }
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    return upsertPrompts(db, prompts, options);
  } finally {
    db.close();
  }
}

function writeSeedArchive(prompts) {
  if (!fs.existsSync(SEED_GZ_PATH)) {
    throw new Error(`未找到种子库: ${SEED_GZ_PATH}`);
  }
  const tempPath = path.join(os.tmpdir(), `openexam.essay.seed.${Date.now()}.db`);
  fs.writeFileSync(tempPath, zlib.gunzipSync(fs.readFileSync(SEED_GZ_PATH)));

  let stats;
  try {
    const db = new Database(tempPath);
    try {
      db.pragma('journal_mode = DELETE');
      stats = upsertPrompts(db, prompts, { force: true });
      db.exec('VACUUM');
    } finally {
      db.close();
    }
    fs.writeFileSync(SEED_GZ_PATH, zlib.gzipSync(fs.readFileSync(tempPath), { level: 9 }));
  } finally {
    ['', '-wal', '-shm'].forEach((suffix) => {
      const target = `${tempPath}${suffix}`;
      if (fs.existsSync(target)) fs.unlinkSync(target);
    });
  }
  return stats;
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log('用法: npm run seed:essay [-- --force] [-- --db <path>] [-- --seed]');
    return;
  }

  const prompts = loadPrompts();
  const dbPath = options.dbPath || resolveUserDbPath();

  console.log(`题目文件: ${DATA_PATH}`);
  console.log(`共 ${prompts.length} 道题`);

  const userStats = writeUserDatabase(dbPath, prompts, options);
  console.log(`\n写入用户库: ${dbPath}`);
  console.log(`  新增 ${userStats.inserted} / 覆盖 ${userStats.updated} / 跳过 ${userStats.skipped}，当前共 ${userStats.total} 道`);

  if (options.withSeed) {
    const seedStats = writeSeedArchive(prompts);
    console.log(`\n写入种子库: ${SEED_GZ_PATH}`);
    console.log(`  新增 ${seedStats.inserted} / 覆盖 ${seedStats.updated}，当前共 ${seedStats.total} 道`);
  }

  if (!options.force && userStats.skipped > 0) {
    console.log('\n提示：已存在的题目被跳过（保留你的修改）。要覆盖内容加 --force。');
  }
}

try {
  main();
} catch (error) {
  console.error(`\n导入失败: ${error.message}`);
  process.exit(1);
}
