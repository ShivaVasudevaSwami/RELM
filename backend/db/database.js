const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.resolve(__dirname, '..', process.env.DB_PATH || './db/re_lm.db');

let db = null;

async function getDB() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

function saveDB() {
  if (!db) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  const database = await getDB();

  // ─── USERS TABLE ──────────────────────────────────────────
  // Roles: admin, manager, telecaller, agent
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'agent',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── LEADS TABLE ──────────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      preferred_property_type TEXT,
      preferred_state TEXT,
      preferred_city TEXT,
      preferred_area TEXT,
      budget_range TEXT,
      funding_source TEXT,
      urgency TEXT,
      occupation TEXT,
      purchase_purpose TEXT,
      possession_timeline TEXT,
      extra_details TEXT,
      status TEXT DEFAULT 'New Inquiry',
      ml_status TEXT DEFAULT 'Cold',
      matched_property_id INTEGER,
      inquiry_count INTEGER DEFAULT 1,
      linked_phone TEXT,
      assigned_telecaller INTEGER,
      assigned_agent INTEGER,
      next_follow_up DATETIME,
      last_interaction_at DATETIME,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (matched_property_id) REFERENCES properties(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_telecaller) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_agent) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ─── INTERACTIONS TABLE ───────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      interaction_type TEXT,
      call_status TEXT,
      feedback_notes TEXT,
      note_length INTEGER DEFAULT 0,
      next_follow_up DATETIME,
      interaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);

  // ─── SITE VISITS TABLE ───────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS site_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      site_name TEXT NOT NULL,
      visit_date DATE NOT NULL,
      feedback_notes TEXT,
      post_visit_status TEXT,
      logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);

  // ─── PROPERTIES TABLE ────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_name TEXT NOT NULL,
      property_type TEXT NOT NULL,
      location TEXT NOT NULL,
      area TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'India',
      price_inr REAL NOT NULL,
      size_sqft REAL NOT NULL,
      description TEXT,
      is_available INTEGER DEFAULT 1,
      added_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ─── LEAD HISTORY TABLE ──────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS lead_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      lead_id INTEGER NOT NULL,
      source_lead_id INTEGER,
      lead_name TEXT NOT NULL,
      property_type TEXT,
      budget_range TEXT,
      final_stage TEXT NOT NULL,
      added_by_username TEXT,
      added_date DATETIME,
      closed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      closure_reason TEXT
    )
  `);

  // ─── FORMS CONFIG TABLE ──────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS forms_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_name TEXT NOT NULL,
      webhook_token TEXT UNIQUE NOT NULL,
      field_mapping TEXT NOT NULL,
      added_by INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ─── AUDIT LOGS TABLE (v4.1) ─────────────────────────────
  // Tracks every status change, assignment, and score change.
  database.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      lead_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);

  // ─── NEGOTIATIONS TABLE (v4.1 Multi-Booking Hub) ─────────
  database.run(`
    CREATE TABLE IF NOT EXISTS negotiations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      offered_price REAL DEFAULT 0,
      status TEXT DEFAULT 'Active',
      agent_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);

  // ─── BOOKINGS TABLE (v4.1 Multi-Booking Hub) ────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      negotiation_id INTEGER,
      final_price REAL NOT NULL,
      booking_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      agent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE SET NULL,
      FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ─── RESERVATIONS TABLE (v4.1 Conflict Resolution) ───────
  database.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      tier INTEGER NOT NULL DEFAULT 3,
      expires_at DATETIME NOT NULL,
      extension_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Active',
      rofr_challenge_by INTEGER,
      rofr_deadline DATETIME,
      manager_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (rofr_challenge_by) REFERENCES leads(id) ON DELETE SET NULL
    )
  `);

  // ─── SAFE MIGRATIONS (for existing databases) ────────────
  try { database.run('ALTER TABLE leads ADD COLUMN inquiry_count INTEGER DEFAULT 1'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN linked_phone TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN occupation TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN purchase_purpose TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN possession_timeline TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN extra_details TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN assigned_telecaller INTEGER'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN assigned_agent INTEGER'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN next_follow_up DATETIME'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN last_interaction_at DATETIME'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN score INTEGER DEFAULT 20'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN last_call_status TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN is_vip INTEGER DEFAULT 0'); } catch (e) { /* exists */ }

  // Interactions enhancements
  try { database.run('ALTER TABLE interactions ADD COLUMN note_length INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE interactions ADD COLUMN next_follow_up DATETIME'); } catch (e) { /* exists */ }

  // Properties: extra_details for BHK/size/floor JSON
  try { database.run('ALTER TABLE properties ADD COLUMN extra_details TEXT'); } catch (e) { /* exists */ }
  // Multi-Booking Hub columns
  try { database.run('ALTER TABLE leads ADD COLUMN is_investor INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE properties ADD COLUMN negotiation_count INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
  // Reservation System columns
  try { database.run("ALTER TABLE properties ADD COLUMN availability_status TEXT DEFAULT 'Available'"); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE properties ADD COLUMN current_priority_lead_id INTEGER'); } catch (e) { /* exists */ }

  // Site visits: property_id for visit-loop tracking
  try { database.run('ALTER TABLE site_visits ADD COLUMN property_id INTEGER'); } catch (e) { /* exists */ }
  // v4.2 Predictive Intent columns
  try { database.run('ALTER TABLE leads ADD COLUMN is_junk INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN junk_reason TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN decision_deadline DATETIME'); } catch (e) { /* exists */ }
  // v4.2 VIP/Gold columns
  try { database.run('ALTER TABLE leads ADD COLUMN is_vip INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN lifetime_value REAL DEFAULT 0'); } catch (e) { /* exists */ }

  // v4.2 User capacity & lead tracking
  try { database.run('ALTER TABLE users ADD COLUMN expertise_tags TEXT'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE users ADD COLUMN capacity_limit INTEGER DEFAULT 20'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE users ADD COLUMN performance_rating REAL DEFAULT 50'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN document_status TEXT DEFAULT \'Pending\''); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE leads ADD COLUMN last_interaction_at DATETIME'); } catch (e) { /* exists */ }
  try { database.run('ALTER TABLE users ADD COLUMN last_assigned_at DATETIME'); } catch (e) { /* exists */ }

  saveDB();
  console.log('[DB] All tables initialized (v4.2 schema)');
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) result = stmt.getAsObject();
  stmt.free();
  return result;
}

function runStmt(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
  const changes = db.getRowsModified();
  return { lastInsertRowid: lastId, changes };
}

function execSQL(sql) {
  db.exec(sql);
}

module.exports = { getDB, initDB, saveDB, queryAll, queryOne, runStmt, execSQL };
