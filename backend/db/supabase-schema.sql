-- =====================================================
-- RE-LM v4.2 — Supabase PostgreSQL Schema
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- =====================================================

-- Set timezone to IST for this session
SET TIME ZONE 'Asia/Kolkata';

-- ─── USERS TABLE ─────────────────────────────────────
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
);

-- ─── LEADS TABLE ─────────────────────────────────────
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
  assigned_telecaller INTEGER,
  assigned_agent INTEGER,
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
  matched_property_ref INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INTERACTIONS TABLE ──────────────────────────────
CREATE TABLE IF NOT EXISTS interactions (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  interaction_type TEXT,
  call_status TEXT,
  feedback_notes TEXT,
  note_length INTEGER DEFAULT 0,
  next_follow_up TIMESTAMPTZ,
  interaction_date TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SITE VISITS TABLE ──────────────────────────────
CREATE TABLE IF NOT EXISTS site_visits (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  visit_date DATE NOT NULL,
  feedback_notes TEXT,
  post_visit_status TEXT,
  property_id INTEGER,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PROPERTIES TABLE ────────────────────────────────
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
);

-- ─── LEAD HISTORY TABLE ─────────────────────────────
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
);

-- ─── FORMS CONFIG TABLE ─────────────────────────────
CREATE TABLE IF NOT EXISTS forms_config (
  id SERIAL PRIMARY KEY,
  form_name TEXT NOT NULL,
  webhook_token TEXT UNIQUE NOT NULL,
  field_mapping TEXT NOT NULL,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── AUDIT LOGS TABLE ───────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NEGOTIATIONS TABLE ─────────────────────────────
CREATE TABLE IF NOT EXISTS negotiations (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  offered_price REAL DEFAULT 0,
  status TEXT DEFAULT 'Active',
  agent_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BOOKINGS TABLE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  negotiation_id INTEGER REFERENCES negotiations(id) ON DELETE SET NULL,
  final_price REAL NOT NULL,
  booking_date TIMESTAMPTZ DEFAULT NOW(),
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RESERVATIONS TABLE ─────────────────────────────
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
);
