/**
 * better-sqlite3 兼容层（浏览器 / PWA）
 *
 * 目的：让 src/main/database.js 这套业务 SQL 原样跑在 sql.js（WASM SQLite）上，
 * 只实现 database.js 实际用到的那部分 API：
 *   new Database(path) / prepare().all|get|run / exec / pragma / transaction / close
 */

function webState() {
  return globalThis.__OPENEXAM_WEB__ || {};
}

function markDirty() {
  webState().markDirty?.();
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !(value instanceof Uint8Array) && !(value instanceof Date);
}

const NAMED_PARAM_RE = /([@:$])([A-Za-z_]\w*)/g;

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;

    // sql.js 的命名参数绑定依赖方言前缀，这里统一改写成位置参数，
    // 兼容 better-sqlite3 的 @name / :name / $name 三种写法。
    this.namedNames = [];
    const positionalSql = sql.replace(NAMED_PARAM_RE, (_match, _prefix, name) => {
      this.namedNames.push(name);
      return '?';
    });
    this.handle = database.raw.prepare(positionalSql);
  }

  _bind(args) {
    this.handle.reset();
    if (!args.length) return;

    const [first] = args;
    if (isPlainObject(first)) {
      if (this.namedNames.length) {
        this.handle.bind(this.namedNames.map((name) => normalizeValue(first[name])));
        return;
      }
      // 没有命名参数却传了对象：按 better-sqlite3 的语义视为无参
      return;
    }

    const list = Array.isArray(first) ? first : args;
    this.handle.bind(list.map(normalizeValue));
  }

  all(...args) {
    this._bind(args);
    const rows = [];
    while (this.handle.step()) rows.push(this.handle.getAsObject());
    this.handle.reset();
    return rows;
  }

  get(...args) {
    const rows = this.all(...args);
    return rows[0];
  }

  run(...args) {
    this._bind(args);
    this.handle.step();
    this.handle.reset();
    const changes = this.database.raw.getRowsModified();
    markDirty();
    return { changes };
  }

  // database.js 未用到，但保留签名避免 undefined
  pluck() { return this; }

  rawMode() { return this; }

  iterate(...args) {
    return this.all(...args)[Symbol.iterator]();
  }
}

class Database {
  constructor() {
    const state = webState();
    if (!state.sqlJs) throw new Error('sql.js 尚未初始化');
    if (state.rawDb) {
      this.raw = state.rawDb;
    } else {
      this.raw = new state.sqlJs.Database(state.dbBytes);
      state.rawDb = this.raw;
    }
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  exec(sql) {
    this.raw.exec(sql);
    markDirty();
  }

  pragma(expression) {
    if (/^table_info/i.test(expression)) {
      return this.prepare(`PRAGMA ${expression}`).all();
    }
    try {
      this.raw.exec(`PRAGMA ${expression}`);
    } catch (error) {
      // journal_mode / wal_checkpoint 之类在 WASM 下无意义，忽略
    }
    return [];
  }

  transaction(fn) {
    return (...args) => {
      this.raw.exec('BEGIN');
      try {
        const result = fn(...args);
        this.raw.exec('COMMIT');
        markDirty();
        return result;
      } catch (error) {
        try { this.raw.exec('ROLLBACK'); } catch (rollbackError) { /* ignore */ }
        throw error;
      }
    };
  }

  close() {
    // 由页面生命周期管理，不做处理
  }
}

module.exports = Database;
module.exports.default = Database;
