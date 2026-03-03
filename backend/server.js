require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./db/database');
const { seedAdmin } = require('./db/seed');

// Routes
const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const interactionRoutes = require('./routes/interactions');
const visitRoutes = require('./routes/visits');
const adminRoutes = require('./routes/admin');
const propertiesRouter = require('./routes/properties');
const importRouter = require('./routes/import');
const formsRouter = require('./routes/forms');
const negotiationsRouter = require('./routes/negotiations');
const reservationsRouter = require('./routes/reservations');
const fs = require('fs');
const { queryAll, queryOne, runStmt } = require('./db/database');
const { recalculateAndSave, logAudit } = require('./services/scoringEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration — works in both dev and production
const isProduction = process.env.NODE_ENV === 'production';
app.use(cors({
    origin: isProduction
        ? (process.env.RENDER_EXTERNAL_URL || true)  // Render sets this automatically
        : 'http://localhost:5173',
    credentials: true
}));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction // HTTPS on Render
    },
    proxy: isProduction // Trust Render's reverse proxy
}));

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/interactions', interactionRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/properties', propertiesRouter);
app.use('/api/import', importRouter);
app.use('/api/forms', formsRouter);
app.use('/api/negotiations', negotiationsRouter);
app.use('/api/reservations', reservationsRouter);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── PRODUCTION: Serve React frontend ───────────────────────
if (isProduction) {
    const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
    app.use(express.static(frontendDist));
    // SPA fallback — all non-API routes serve index.html
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(frontendDist, 'index.html'));
        }
    });
}

// Initialize database, seed admin, then start server
async function startServer() {
    await initDB();
    seedAdmin();

    app.listen(PORT, () => {
        console.log(`[Server] RE-LM API running on http://localhost:${PORT}`);
        console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // ─── BACKGROUND JOB: Reservation Expiry (every 60s) ─────
    setInterval(() => {
        try {
            const now = new Date().toISOString();

            // 1. Expire stale Tier-2/3 reservations
            const expired = queryAll(
                `SELECT r.*, p.property_name FROM reservations r
                 JOIN properties p ON r.property_id = p.id
                 WHERE r.status = 'Active' AND r.expires_at <= ?`, [now]
            );
            for (const r of expired) {
                runStmt(`UPDATE reservations SET status = 'Expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [r.id]);
                if (r.tier === 2) {
                    runStmt(`UPDATE properties SET availability_status = 'Available', current_priority_lead_id = NULL WHERE id = ? AND availability_status = 'Reserved'`, [r.property_id]);
                }
                logAudit(runStmt, null, r.lead_id, 'reservation_expired', {
                    reservation_id: r.id, property_id: r.property_id, tier: r.tier,
                    property_name: r.property_name
                });
                recalculateAndSave(r.lead_id, queryOne, runStmt, null);
            }

            // 2. Handle ROFR deadline overrides
            const rofrExpired = queryAll(
                `SELECT r.*, p.property_name FROM reservations r
                 JOIN properties p ON r.property_id = p.id
                 WHERE r.status = 'Active' AND r.rofr_deadline IS NOT NULL AND r.rofr_deadline <= ?`, [now]
            );
            for (const r of rofrExpired) {
                runStmt(`UPDATE reservations SET status = 'Overridden', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [r.id]);
                runStmt(`UPDATE properties SET availability_status = 'Available', current_priority_lead_id = NULL WHERE id = ?`, [r.property_id]);
                logAudit(runStmt, null, r.lead_id, 'rofr_deadline_expired', {
                    reservation_id: r.id, property_id: r.property_id,
                    challenger_lead_id: r.rofr_challenge_by,
                    message: 'ROFR deadline expired — reservation overridden'
                });
                recalculateAndSave(r.lead_id, queryOne, runStmt, null);
            }

            if (expired.length > 0 || rofrExpired.length > 0) {
                console.log(`[BG] Expired ${expired.length} reservations, overrode ${rofrExpired.length} ROFR deadlines`);
            }

            // 3. v4.2: Decision Deadline Miss — recalculate leads whose deadline just passed
            const missedDeadlines = queryAll(
                `SELECT id FROM leads WHERE decision_deadline IS NOT NULL
                 AND decision_deadline <= ? AND status NOT IN ('Booking Confirmed', 'Not Interested')`,
                [now]
            );
            for (const lead of missedDeadlines) {
                recalculateAndSave(lead.id, queryOne, runStmt, null);
            }
        } catch (err) {
            console.error('[BG] Background job error:', err.message);
        }
    }, 60000);
    console.log('[BG] Reservation expiry + deadline check job started (60s interval)');
}

startServer().catch(err => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
});
