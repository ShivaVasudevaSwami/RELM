/**
 * constants.js — Unified Configuration & Taxonomy Engine
 * RE-LM v4.2 — Strict mirrored enums for Leads and Properties
 */

// ── Property Type Taxonomy ──────────────────────────────────

const PROPERTY_TYPES = ['Flat', 'Villa', 'Plot'];

const FLAT_CONFIGS = ['1 BHK', '2 BHK', '3 BHK', '4+ BHK'];
const VILLA_CONFIGS = ['3 BHK Villa', '4 BHK Villa', '5+ BHK Villa', 'Duplex', 'Row House'];
const PLOT_ZONINGS = ['Residential (NA)', 'Agricultural', 'Commercial'];

// BHK numeric extraction for mirror matching
const BHK_MAP = {
    '1 BHK': 1, '2 BHK': 2, '3 BHK': 3, '4+ BHK': 4,
    '3 BHK Villa': 3, '4 BHK Villa': 4, '5+ BHK Villa': 5,
    'Duplex': 4, 'Row House': 3
};

// Extra details keys (mirrored between leads & properties)
const FLAT_EXTRA_KEYS = ['bhk', 'floor_pref', 'furnishing', 'min_size'];
const VILLA_EXTRA_KEYS = ['bhk', 'private_garden', 'parking', 'min_size'];
const PLOT_EXTRA_KEYS = ['plot_size', 'zoning', 'road_width'];

// ── Budget Ranges ───────────────────────────────────────────

const BUDGET_RANGES = ['20-40', '40-60', '60-80', '80-100', '1Cr+'];

// Budget midpoints for numerical comparison (in Lakhs)
const BUDGET_MIDPOINTS = {
    '20-40': 30, '40-60': 50, '60-80': 70, '80-100': 90, '1Cr+': 120
};

// ── Professional Fields ─────────────────────────────────────

const OCCUPATIONS = ['Salaried', 'Business', 'Professional', 'Retired'];
const PURCHASE_PURPOSES = ['Self-Use', 'Investment'];
const FUNDING_SOURCES = ['Self-Funded', 'Home Loan'];
const TIMELINES = ['Immediate', '3 Months', '1 Year'];
const FURNISHING_OPTIONS = ['Unfurnished', 'Semi-Furnished', 'Fully Furnished'];

// ── Pipeline Stages ─────────────────────────────────────────

const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Site Visit Scheduled',
    'Site Visited', 'Negotiation', 'Booking Confirmed'
];

const TERMINAL_STATUSES = ['Booking Confirmed', 'Not Interested'];

// ── Scoring Thresholds ──────────────────────────────────────

const SCORE_THRESHOLDS = {
    HOT: 75,    // > 75 = Hot (Red)
    WARM: 40,   // 40-75 = Warm (Orange)
    COLD: 0,    // < 40 = Cold (Blue)
    GOLD: 100   // VIP = Fixed 100
};

module.exports = {
    PROPERTY_TYPES, FLAT_CONFIGS, VILLA_CONFIGS, PLOT_ZONINGS,
    BHK_MAP, FLAT_EXTRA_KEYS, VILLA_EXTRA_KEYS, PLOT_EXTRA_KEYS,
    BUDGET_RANGES, BUDGET_MIDPOINTS,
    OCCUPATIONS, PURCHASE_PURPOSES, FUNDING_SOURCES, TIMELINES, FURNISHING_OPTIONS,
    PIPELINE_ORDER, TERMINAL_STATUSES, SCORE_THRESHOLDS
};
