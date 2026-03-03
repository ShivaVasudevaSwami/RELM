// ═══════════════════════════════════════════════════════════════
// RE-LM v4.2 — Supabase PostgreSQL Database Adapter
// Provides async queryAll, queryOne, runStmt, execSQL
// Falls back to SQLite if SUPABASE_DB_URL is not set
// ═══════════════════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false } // Supabase requires SSL
});

// ─── SET TIMEZONE ON EVERY NEW CONNECTION ─────────────────────
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Kolkata'");
});

// ─── CORE ASYNC DB FUNCTIONS ──────────────────────────────────

/**
 * Run a SELECT query, return all rows as an array of objects.
 * @param {string} sql - SQL with $1, $2, ... placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<Array<Object>>}
 */
async function queryAll(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * Run a SELECT query, return the first row or null.
 * @param {string} sql - SQL with $1, $2, ... placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<Object|null>}
 */
async function queryOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Run an INSERT/UPDATE/DELETE statement.
 * For INSERT, uses RETURNING id to get the new row ID.
 * @param {string} sql - SQL with $1, $2, ... placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<{lastInsertRowid: number|null, changes: number}>}
 */
async function runStmt(sql, params = []) {
  // Auto-add RETURNING id for INSERT statements if not already present
  let execSql = sql;
  if (/^INSERT/i.test(sql.trim()) && !/RETURNING/i.test(sql)) {
    execSql = sql.replace(/;?\s*$/, ' RETURNING id');
  }
  const result = await pool.query(execSql, params);
  return {
    lastInsertRowid: result.rows[0]?.id || null,
    changes: result.rowCount
  };
}

/**
 * Execute raw SQL (for BEGIN, COMMIT, ROLLBACK, DDL).
 * @param {string} sql - Raw SQL statement
 * @returns {Promise<void>}
 */
async function execSQL(sql) {
  await pool.query(sql);
}

/**
 * Get a client from the pool for transaction support.
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     await client.query('INSERT ...', [...]);
 *     await client.query('COMMIT');
 *   } catch(e) {
 *     await client.query('ROLLBACK');
 *   } finally {
 *     client.release();
 *   }
 */
async function getClient() {
  const client = await pool.connect();
  await client.query("SET TIME ZONE 'Asia/Kolkata'");
  return client;
}

/**
 * Initialize the database schema.
 * Creates all tables if they don't exist.
 */
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query("SET TIME ZONE 'Asia/Kolkata'");

    // ─── USERS TABLE ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'agent',
        is_active INTEGER DEFAULT 1,
        expertise_tags TEXT,
        capacity_limit INTEGER DEFAULT 20,
        performance_rating REAL DEFAULT 50,
        last_assigned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── LEADS TABLE ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
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
        extra_details JSONB DEFAULT '{}',
        status TEXT DEFAULT 'New Inquiry',
        ml_status TEXT DEFAULT 'Cold',
        matched_property_id INTEGER,
        inquiry_count INTEGER DEFAULT 1,
        linked_phone TEXT,
        assigned_telecaller INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assigned_agent INTEGER REFERENCES users(id) ON DELETE SET NULL,
        next_follow_up TIMESTAMPTZ,
        last_interaction_at TIMESTAMPTZ,
        score INTEGER DEFAULT 20,
        last_call_status TEXT,
        is_vip INTEGER DEFAULT 0,
        is_investor INTEGER DEFAULT 0,
        is_junk INTEGER DEFAULT 0,
        junk_reason TEXT,
        decision_deadline TIMESTAMPTZ,
        lifetime_value REAL DEFAULT 0,
        document_status TEXT DEFAULT 'Pending',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── INTERACTIONS TABLE ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS interactions (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        interaction_type TEXT,
        call_status TEXT,
        feedback_notes TEXT,
        note_length INTEGER DEFAULT 0,
        next_follow_up TIMESTAMPTZ,
        interaction_date TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── SITE VISITS TABLE ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_visits (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        site_name TEXT NOT NULL,
        visit_date DATE NOT NULL,
        feedback_notes TEXT,
        post_visit_status TEXT,
        property_id INTEGER,
        logged_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── PROPERTIES TABLE ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
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
        extra_details JSONB DEFAULT '{}',
        is_available INTEGER DEFAULT 1,
        negotiation_count INTEGER DEFAULT 0,
        availability_status TEXT DEFAULT 'Available',
        current_priority_lead_id INTEGER,
        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── LEAD HISTORY TABLE ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_history (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        lead_id INTEGER NOT NULL,
        source_lead_id INTEGER,
        lead_name TEXT NOT NULL,
        property_type TEXT,
        budget_range TEXT,
        final_stage TEXT NOT NULL,
        added_by_username TEXT,
        added_date TIMESTAMPTZ,
        closed_date TIMESTAMPTZ DEFAULT NOW(),
        closure_reason TEXT
      )
    `);

    // ─── FORMS CONFIG TABLE ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS forms_config (
        id SERIAL PRIMARY KEY,
        form_name TEXT NOT NULL,
        webhook_token TEXT UNIQUE NOT NULL,
        field_mapping TEXT NOT NULL,
        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── AUDIT LOGS TABLE ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── NEGOTIATIONS TABLE ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS negotiations (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        offered_price REAL DEFAULT 0,
        status TEXT DEFAULT 'Active',
        agent_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── BOOKINGS TABLE ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        negotiation_id INTEGER REFERENCES negotiations(id) ON DELETE SET NULL,
        final_price REAL NOT NULL,
        booking_date TIMESTAMPTZ DEFAULT NOW(),
        agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── RESERVATIONS TABLE ─────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        tier INTEGER NOT NULL DEFAULT 3,
        expires_at TIMESTAMPTZ NOT NULL,
        extension_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Active',
        rofr_challenge_by INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        rofr_deadline TIMESTAMPTZ,
        manager_comment TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('[DB] All tables initialized (v4.2 PostgreSQL schema)');
  } finally {
    client.release();
  }
}

// saveDB is a no-op for PostgreSQL (data is automatically persisted)
function saveDB() { /* no-op for PostgreSQL */ }

module.exports = {
  pool,
  getClient,
  initDB,
  saveDB,
  queryAll,
  queryOne,
  runStmt,
  execSQL
};
