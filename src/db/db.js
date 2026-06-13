/**
 * @fileoverview sql.js (pure-JS SQLite) connection manager.
 *
 * No native bindings, so it works on every VS Code platform.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_FILENAME = 'ai-cost.db';

class Database {
  /** @param {string} storageDir - extension globalStorage path */
  constructor(storageDir) {
    this.dbPath = path.join(storageDir, DB_FILENAME);
    this.db = null;
    this._inTransaction = false;
  }

  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      this.db = new SQL.Database(fs.readFileSync(this.dbPath));
    } else {
      this.db = new SQL.Database();
    }
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    this.db.exec(schema);
    this._migrate();
    this.db.exec('PRAGMA foreign_keys = ON;');
    this._persist();
  }

  /** Additive column migrations for DBs created before a column existed. */
  _migrate() {
    const addColumn = (table, col, def) => {
      const cols = this.query(`PRAGMA table_info(${table})`).map(r => r.name);
      if (!cols.includes(col)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    };
    addColumn('sessions', 'ai_credits', 'REAL DEFAULT 0');
    addColumn('llm_calls', 'ai_credits', 'REAL DEFAULT 0');
    addColumn('sessions', 'cost_confidence', "TEXT DEFAULT 'none'");
    addColumn('sessions', 'cache_breaks', 'INTEGER DEFAULT 0');
    addColumn('sessions', 'cache_break_causes_json', 'TEXT');
    addColumn('sessions', 'cache_break_tokens', 'INTEGER DEFAULT 0');
    addColumn('sessions', 'cache_break_token_causes_json', 'TEXT');
  }

  _assertReady() {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
  }

  run(sql, params) {
    this._assertReady();
    this.db.run(sql, params);
  }

  query(sql, params) {
    this._assertReady();
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  queryOne(sql, params) {
    const rows = this.query(sql, params);
    return rows.length ? rows[0] : null;
  }

  scalar(sql, params) {
    this._assertReady();
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    let value = null;
    if (stmt.step()) {
      const row = stmt.get();
      value = row.length ? row[0] : null;
    }
    stmt.free();
    return value;
  }

  transaction(fn) {
    this._assertReady();
    if (this._inTransaction) return fn(this);
    this._inTransaction = true;
    this.db.run('BEGIN TRANSACTION;');
    try {
      const result = fn(this);
      this.db.run('COMMIT;');
      return result;
    } catch (err) {
      this.db.run('ROLLBACK;');
      throw err;
    } finally {
      this._inTransaction = false;
    }
  }

  persist() {
    this._persist();
  }

  _persist() {
    if (!this.db) return;
    const data = this.db.export();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  close() {
    this._persist();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { Database };
