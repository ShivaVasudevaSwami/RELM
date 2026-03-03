const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const isAdmin = require('../middleware/isAdmin');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');
const isManagerOrAdmin = require('../middleware/isManagerOrAdmin');

const router = express.Router();

router.use(isAuthenticated);

// ─────────────────────────────────────────────────────────────
// Weighted Round-Robin: pick user with fewest active leads
// under their capacity_limit, tiebreak by performance_rating
// ─────────────────────────────────────────────────────────────
function roundRobinAssign(role) {
    const users = queryAll(
        `SELECT u.id, u.username, u.capacity_limit, u.performance_rating,
                COUNT(l.id) as active_leads
         FROM users u
         LEFT JOIN leads l ON (
            (? = 'telecaller' AND l.assigned_telecaller = u.id)
            OR (? = 'agent' AND l.assigned_agent = u.id)
         ) AND l.status NOT IN ('Not Interested', 'Booking Confirmed')
         WHERE u.role = ? AND u.is_active = 1
         GROUP BY u.id
         HAVING active_leads < COALESCE(u.capacity_limit, 20)
         ORDER BY active_leads ASC, u.last_assigned_at ASC, u.performance_rating DESC
         LIMIT 1`,
        [role, role, role]
    );
    if (users.length > 0) {
        // Stamp last_assigned_at
        runStmt('UPDATE users SET last_assigned_at = CURRENT_TIMESTAMP WHERE id = ?', [users[0].id]);
        return users[0];
    }
    return null;
}

const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Site Visit Scheduled',
    'Site Visited', 'Negotiation', 'Booking Confirmed', 'Not Interested'
];

// GET /api/leads/check-phone — Check if phone exists
router.get('/check-phone',
    query('phone').matches(/^[6-9]\d{9}$/).withMessage('Invalid phone'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ exists: false, error: 'Invalid phone' });

        const phone = req.query.phone;
        const lead = queryOne('SELECT * FROM leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1', [phone]);
        if (!lead) return res.json({ exists: false });

        const countRow = queryOne('SELECT COUNT(*) as total FROM leads WHERE phone = ?', [phone]);
        const total = countRow ? countRow.total : 0;

        return res.json({
            exists: true,
            status: lead.status,
            ml_status: lead.ml_status,
            name: lead.name,
            created_at: lead.created_at,
            id: lead.id,
            total_inquiries: total,
            can_add: lead.status === 'Not Interested' || lead.status === 'Booking Confirmed'
        });
    }
);

// Helper: fill in periods with zero counts so graph is continuous
function fillMissingPeriods(rows, granularity, startDate, endDate) {
    if (!rows || rows.length === 0) return [];
    const rowMap = {};
    rows.forEach(r => { rowMap[r.period] = r; });
    const result = [];
    const current = startDate ? new Date(startDate) : new Date(rows[0].period + (granularity === 'month' ? '-01' : granularity === 'day' ? '' : '-01-01'));
    const end = new Date(endDate);
    let safetyCounter = 0;
    while (current <= end && safetyCounter < 5000) {
        safetyCounter++;
        let period;
        if (granularity === 'day') {
            period = current.toISOString().split('T')[0];
            current.setDate(current.getDate() + 1);
        } else if (granularity === 'year') {
            period = String(current.getFullYear());
            current.setFullYear(current.getFullYear() + 1);
        } else {
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            period = `${y}-${m}`;
            current.setMonth(current.getMonth() + 1);
        }
        result.push(rowMap[period] || { period, total: 0, hot: 0, warm: 0, cold: 0, confirmed: 0 });
    }
    return result;
}

// GET /api/leads/timeline — lead counts grouped by day/month/year/hour
router.get('/timeline', (req, res) => {
    try {
        const { granularity = 'month', range = '1y' } = req.query;
        const user = req.session.user;

        // Role filter params
        const roleParams = [];
        let roleFilter = '';
        if (user.role !== 'admin' && user.role !== 'manager') {
            roleFilter = 'AND created_by = ?';
            roleParams.push(user.id);
        }

        // Special case: day_hour (1D – hourly grouping)
        if (granularity === 'day_hour') {
            // Use LOCAL date string (not UTC via toISOString which shifts the date for IST)
            const now = new Date();
            const localYear = now.getFullYear();
            const localMonth = String(now.getMonth() + 1).padStart(2, '0');
            const localDay = String(now.getDate()).padStart(2, '0');
            const todayStr = `${localYear}-${localMonth}-${localDay}`;

            // Use SQLite 'localtime' modifier so hours match the user's timezone
            const sql = `SELECT strftime('%H', created_at, 'localtime') as hour,
                COUNT(*) as total,
                SUM(CASE WHEN ml_status = 'Hot' THEN 1 ELSE 0 END) as hot,
                SUM(CASE WHEN ml_status = 'Warm' THEN 1 ELSE 0 END) as warm,
                SUM(CASE WHEN ml_status = 'Cold' THEN 1 ELSE 0 END) as cold,
                SUM(CASE WHEN status = 'Booking Confirmed' THEN 1 ELSE 0 END) as confirmed
                FROM leads WHERE date(created_at, 'localtime') = ? ${roleFilter}
                GROUP BY hour ORDER BY hour ASC`;
            const rows = queryAll(sql, [todayStr, ...roleParams]);

            // Build 24-hour skeleton with matching padded keys
            const rowMap = {};
            rows.forEach(r => { rowMap[r.hour] = r; });
            const filled = [];
            for (let h = 0; h <= 23; h++) {
                const hourKey = String(h).padStart(2, '0');
                const period = `${todayStr}T${hourKey}`;
                const row = rowMap[hourKey];
                filled.push({
                    period,
                    total: row?.total || 0,
                    hot: row?.hot || 0,
                    warm: row?.warm || 0,
                    cold: row?.cold || 0,
                    confirmed: row?.confirmed || 0
                });
            }
            return res.json({ granularity: 'day_hour', range, data: filled });
        }

        const now = new Date();
        let startDate = null;
        switch (range) {
            case '7d': startDate = new Date(now.getTime() - 7 * 86400000); break;
            case '30d': startDate = new Date(now.getTime() - 30 * 86400000); break;
            case '90d': startDate = new Date(now.getTime() - 90 * 86400000); break;
            case '1y': startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
            default: startDate = null; break;
        }

        let dateFormat;
        switch (granularity) {
            case 'day': dateFormat = "strftime('%Y-%m-%d', created_at, 'localtime')"; break;
            case 'year': dateFormat = "strftime('%Y', created_at, 'localtime')"; break;
            default: dateFormat = "strftime('%Y-%m', created_at, 'localtime')"; break;
        }

        let sql = `SELECT ${dateFormat} as period,
            COUNT(*) as total,
            SUM(CASE WHEN ml_status = 'Hot' THEN 1 ELSE 0 END) as hot,
            SUM(CASE WHEN ml_status = 'Warm' THEN 1 ELSE 0 END) as warm,
            SUM(CASE WHEN ml_status = 'Cold' THEN 1 ELSE 0 END) as cold,
            SUM(CASE WHEN status = 'Booking Confirmed' THEN 1 ELSE 0 END) as confirmed
            FROM leads WHERE 1=1`;
        const params = [...roleParams];

        if (user.role !== 'admin' && user.role !== 'manager') {
            sql += ' AND created_by = ?';
        }
        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate.toISOString());
        }
        sql += ' GROUP BY period ORDER BY period ASC';

        const rows = queryAll(sql, params);
        const filledRows = fillMissingPeriods(rows, granularity, startDate, now);

        return res.json({ granularity, range, data: filledRows });
    } catch (err) {
        console.error('Timeline error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/leads/by-period — leads for a specific period
router.get('/by-period', (req, res) => {
    try {
        const { period, granularity = 'month', ml_status } = req.query;
        const user = req.session.user;
        if (!period) return res.status(400).json({ error: 'period param required' });

        let dateFilter;
        const params = [];
        switch (granularity) {
            case 'day_hour': {
                const [datePart, hourPart] = period.split('T');
                dateFilter = "date(l.created_at, 'localtime') = ? AND strftime('%H', l.created_at, 'localtime') = ?";
                params.push(datePart, String(hourPart || '00').padStart(2, '0'));
                break;
            }
            case 'day':
                dateFilter = "date(l.created_at, 'localtime') = ?"; params.push(period); break;
            case 'year':
                dateFilter = "strftime('%Y', l.created_at, 'localtime') = ?"; params.push(period); break;
            default:
                dateFilter = "strftime('%Y-%m', l.created_at, 'localtime') = ?"; params.push(period); break;
        }

        let roleFilter = '';
        if (user.role !== 'admin' && user.role !== 'manager') {
            roleFilter = 'AND l.created_by = ?';
            params.push(user.id);
        }

        let mlFilter = '';
        if (ml_status && ['Hot', 'Warm', 'Cold'].includes(ml_status)) {
            mlFilter = 'AND l.ml_status = ?';
            params.push(ml_status);
        }

        const leads = queryAll(
            `SELECT l.*, u.username as agent_name, p.property_name as matched_property_name
             FROM leads l LEFT JOIN users u ON l.created_by = u.id
             LEFT JOIN properties p ON l.matched_property_id = p.id
             WHERE ${dateFilter} ${roleFilter} ${mlFilter}
             ORDER BY l.created_at DESC`, params
        );

        return res.json({ period, granularity, ml_status: ml_status || 'All', count: leads.length, leads });
    } catch (err) {
        console.error('By-period error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/leads — supports ?ml_status=Hot|Warm|Cold AND ?stage=pipeline_stage
router.get('/', (req, res) => {
    const { status, ml_status, stage } = req.query;
    const user = req.session.user;
    const ML_VALUES = ['Hot', 'Warm', 'Cold'];
    const PIPELINE_STAGES = ['New Inquiry', 'Contacted', 'Site Visit Scheduled',
        'Site Visited', 'Negotiation', 'Booking Confirmed', 'Not Interested'];

    let sql = `SELECT leads.*, users.username as agent_name, properties.property_name as matched_property_name
      FROM leads LEFT JOIN users ON leads.created_by = users.id
      LEFT JOIN properties ON leads.matched_property_id = properties.id
      WHERE 1=1`;
    const params = [];

    // Role-based filtering — 4-role RBAC
    if (user.role === 'telecaller') {
        sql += ' AND (leads.assigned_telecaller = ? OR leads.created_by = ?)';
        params.push(user.id, user.id);
    } else if (user.role === 'agent') {
        sql += ' AND leads.assigned_agent = ?';
        params.push(user.id);
    }
    // manager & admin: no filter — full visibility

    // ML status filter — ?ml_status=Hot or backward-compat ?status=Hot
    const mlFilter = ml_status || (status && ML_VALUES.includes(status) ? status : null);
    if (mlFilter && ML_VALUES.includes(mlFilter)) {
        sql += ' AND leads.ml_status = ?';
        params.push(mlFilter);
    }

    // Pipeline stage filter — ?stage=Contacted or ?status=Contacted (if not an ML value)
    const stageFilter = stage || (status && PIPELINE_STAGES.includes(status) && !ML_VALUES.includes(status) ? status : null);
    if (stageFilter && PIPELINE_STAGES.includes(stageFilter)) {
        sql += ' AND leads.status = ?';
        params.push(stageFilter);
    }

    sql += ' ORDER BY leads.created_at DESC';
    return res.json(queryAll(sql, params));
});

// POST /api/leads — Create (with duplicate phone check + inquiry counter)
router.post('/',
    body('name').notEmpty().isLength({ min: 2, max: 60 }).matches(/^[a-zA-Z\s]+$/)
        .withMessage('Name must be 2–60 characters and contain only letters'),
    body('phone').matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number starting with 6-9'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address'),
    body('preferred_property_type').optional(),
    body('budget_range').optional(),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }

        const { name, phone, email, preferred_property_type, preferred_state,
            preferred_city, preferred_area, budget_range, funding_source,
            urgency, matched_property_id,
            occupation, purchase_purpose, possession_timeline, extra_details,
            assigned_telecaller, assigned_agent, next_follow_up } = req.body;

        // Duplicate phone check
        const existingLead = queryOne('SELECT * FROM leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1', [phone]);
        if (existingLead && existingLead.status !== 'Not Interested' && existingLead.status !== 'Booking Confirmed') {
            return res.status(409).json({
                error: 'duplicate',
                message: 'A lead with this phone number already exists.',
                existing_lead: {
                    id: existingLead.id, name: existingLead.name,
                    status: existingLead.status, ml_status: existingLead.ml_status,
                    created_at: existingLead.created_at
                }
            });
        }

        // Count previous leads with same phone
        const countRow = queryOne('SELECT COUNT(*) as cnt FROM leads WHERE phone = ?', [phone]);
        const prevCount = countRow ? countRow.cnt : 0;
        const inquiryCount = prevCount + 1;

        // Serialize extra_details as JSON string for storage
        const extraDetailsJson = extra_details ? JSON.stringify(extra_details) : null;

        // Auto-assign telecaller via Weighted Round-Robin
        const user = req.session.user;
        let telecallerId = assigned_telecaller || (user.role === 'telecaller' ? user.id : null);
        let agentId = assigned_agent || null;

        // VIP Auto-Assignment: returning VIPs bypass TC pool → previous agent
        if (existingLead && existingLead.is_vip && existingLead.assigned_agent) {
            agentId = existingLead.assigned_agent;
            logAudit(runStmt, user.id, null, 'vip_auto_assign', {
                message: `VIP returning — auto-assigned to previous agent (ID: ${agentId})`,
                original_lead_id: existingLead.id
            });
        }

        // If no telecaller assigned, use round-robin
        if (!telecallerId) {
            const assignedTc = roundRobinAssign('telecaller');
            if (assignedTc) telecallerId = assignedTc.id;
        }

        const result = runStmt(
            `INSERT INTO leads (name, phone, email, preferred_property_type,
       preferred_state, preferred_city, preferred_area, budget_range,
       funding_source, urgency, occupation, purchase_purpose,
       possession_timeline, extra_details,
       status, ml_status, matched_property_id,
       inquiry_count, linked_phone, created_by,
       assigned_telecaller, assigned_agent, next_follow_up)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New Inquiry', 'Cold', ?, ?, ?, ?, ?, ?, ?)`,
            [name, phone, email || null, preferred_property_type || null,
                preferred_state || null, preferred_city || null, preferred_area || null,
                budget_range || null, funding_source || null, urgency || null,
                occupation || null, purchase_purpose || null,
                possession_timeline || null, extraDetailsJson,
                matched_property_id || null, inquiryCount,
                prevCount > 0 ? phone : null, req.session.user.id,
                telecallerId || null, agentId || null, next_follow_up || null]
        );

        const newLeadId = result.lastInsertRowid;

        // Insert lead_history record from PREVIOUS lead if exists
        if (existingLead && (existingLead.status === 'Not Interested' || existingLead.status === 'Booking Confirmed')) {
            const creatorUser = queryOne('SELECT username FROM users WHERE id = ?', [existingLead.created_by]);
            runStmt(
                `INSERT INTO lead_history
         (phone, lead_id, source_lead_id, lead_name, property_type, budget_range,
           final_stage, added_by_username, added_date, closure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [phone, newLeadId, existingLead.id, existingLead.name,
                    existingLead.preferred_property_type, existingLead.budget_range,
                    existingLead.status, creatorUser ? creatorUser.username : 'Unknown',
                    existingLead.created_at, existingLead.status]
            );
        }

        // Calculate initial lead score
        const scoreResult = recalculateAndSave(newLeadId, queryOne, runStmt, req.session.user.id);

        // v4.2 Zombie Resurrection: if re-inquiry >180 days, notify about zombie
        let isZombie = false;
        if (existingLead && (existingLead.status === 'Not Interested' || existingLead.status === 'Booking Confirmed')) {
            const daysSinceClosed = (Date.now() - new Date(existingLead.created_at).getTime()) / 86400000;
            isZombie = daysSinceClosed >= 180;
            if (!isZombie && existingLead.assigned_agent) {
                // <180 days: notify original agent via audit log
                logAudit(runStmt, req.session.user.id, newLeadId, 'zombie_short_return', {
                    message: `Lead re-inquired within 180 days. Original agent (ID: ${existingLead.assigned_agent}) should be notified.`,
                    original_lead_id: existingLead.id,
                    days_since_close: Math.round(daysSinceClosed)
                });
            }
        }

        // Audit log for lead creation
        logAudit(runStmt, req.session.user.id, newLeadId, 'lead_created',
            { name, phone, assigned_telecaller: telecallerId, assigned_agent: assigned_agent || null });

        const newLead = queryOne('SELECT * FROM leads WHERE id = ?', [newLeadId]);
        return res.status(201).json({
            lead: newLead,
            score: scoreResult ? scoreResult.score : null,
            breakdown: scoreResult ? scoreResult.breakdown : null
        });
    }
);

// GET /api/leads/:id
router.get('/:id', (req, res) => {
    const user = req.session.user;
    const leadId = parseInt(req.params.id);

    const lead = queryOne(`SELECT leads.*, users.username as agent_name
    FROM leads LEFT JOIN users ON leads.created_by = users.id WHERE leads.id = ?`, [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // RBAC: telecaller sees only assigned/created leads, agent sees only assigned leads
    if (user.role === 'telecaller' && lead.assigned_telecaller !== user.id && lead.created_by !== user.id)
        return res.status(403).json({ error: 'Access denied' });
    if (user.role === 'agent' && lead.assigned_agent !== user.id)
        return res.status(403).json({ error: 'Access denied' });

    const interactions = queryAll(
        'SELECT * FROM interactions WHERE lead_id = ? ORDER BY interaction_date DESC', [leadId]);
    const site_visits = queryAll(
        'SELECT * FROM site_visits WHERE lead_id = ? ORDER BY logged_at DESC', [leadId]);
    let matched_property = null;
    if (lead.matched_property_id)
        matched_property = queryOne('SELECT * FROM properties WHERE id = ?', [lead.matched_property_id]);

    // Multi-Booking Hub data
    const negotiation_count = queryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE lead_id = ? AND status = 'Active'`, [leadId]
    );
    const booking_count = queryOne(
        `SELECT COUNT(*) as cnt FROM bookings WHERE lead_id = ?`, [leadId]
    );

    return res.json({
        lead, interactions, site_visits, matched_property,
        active_negotiations: negotiation_count?.cnt || 0,
        total_bookings: booking_count?.cnt || 0
    });
});

// GET /api/leads/:id/history — Lead history by phone
router.get('/:id/history', (req, res) => {
    const leadId = parseInt(req.params.id);
    const lead = queryOne('SELECT phone FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const history = queryAll(
        'SELECT * FROM lead_history WHERE phone = ? ORDER BY added_date DESC',
        [lead.phone]
    );
    return res.json({ history });
});

// PUT /api/leads/:id/status
router.put('/:id/status',
    body('status').notEmpty().withMessage('Status is required'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

        const leadId = parseInt(req.params.id);
        const { status: newStatus, next_follow_up } = req.body;
        const user = req.session.user;

        if (!PIPELINE_ORDER.includes(newStatus))
            return res.status(400).json({ error: `Invalid status. Must be one of: ${PIPELINE_ORDER.join(', ')}` });

        const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        if (user.role === 'agent' && lead.created_by !== user.id)
            return res.status(403).json({ error: 'Access denied' });

        // === REVERSE LOGIC: If moving AWAY from Booking Confirmed, restore property ===
        if (lead.status === 'Booking Confirmed' && newStatus !== 'Booking Confirmed') {
            if (lead.matched_property_id) {
                runStmt('UPDATE properties SET is_available = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [lead.matched_property_id]);
            }
        }

        // Booking Confirmed: force ml_status to Gold/Hot + auto-mark property sold + set VIP
        if (newStatus === 'Booking Confirmed') {
            // Set VIP status & accumulate lifetime value
            const propertyPrice = lead.matched_property_id
                ? (queryOne('SELECT price_inr FROM properties WHERE id = ?', [lead.matched_property_id])?.price_inr || 0)
                : 0;
            runStmt(
                `UPDATE leads SET status = ?, ml_status = 'Gold', is_vip = 1,
                 lifetime_value = COALESCE(lifetime_value, 0) + ? WHERE id = ?`,
                ['Booking Confirmed', propertyPrice, leadId]
            );

            // Auto-mark matched property as sold
            let soldProperty = null;
            if (lead.matched_property_id) {
                runStmt(`UPDATE properties SET is_available = 0, availability_status = 'Sold',
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [lead.matched_property_id]);
                soldProperty = queryOne('SELECT * FROM properties WHERE id = ?', [lead.matched_property_id]);
            }

            logAudit(runStmt, user.id, leadId, 'vip_status_granted', {
                message: 'Lead achieved Booking Confirmed — permanent VIP/Gold status',
                lifetime_value: (lead.lifetime_value || 0) + propertyPrice
            });

            const updated = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
            return res.json({
                lead: updated,
                property_sold: !!soldProperty,
                sold_property: soldProperty,
                vip_granted: true
            });
        }

        // Not Interested: VIP Protection — VIPs never go Cold
        if (newStatus === 'Not Interested') {
            if (lead.is_vip) {
                // VIP: close the current inquiry session, keep Gold status
                logAudit(runStmt, user.id, leadId, 'vip_inquiry_closed', {
                    message: 'VIP rejected current inquiry but retains Gold status',
                    from: lead.status, attempted: 'Not Interested'
                });
                const updated = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
                return res.json({
                    lead: updated,
                    vip_protected: true,
                    message: 'VIP lead is protected. Inquiry session closed but Gold status preserved.'
                });
            }
            runStmt('UPDATE leads SET status = ?, ml_status = ? WHERE id = ?',
                ['Not Interested', 'Cold', leadId]);
            logAudit(runStmt, user.id, leadId, 'status_change',
                { from: lead.status, to: 'Not Interested' });
            const updated = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
            return res.json({ lead: updated });
        }

        if (lead.status === 'Not Interested' || lead.status === 'Booking Confirmed')
            return res.status(400).json({ error: `Cannot change status from '${lead.status}'` });

        const currentIdx = PIPELINE_ORDER.indexOf(lead.status);
        const newIdx = PIPELINE_ORDER.indexOf(newStatus);
        if (newIdx !== currentIdx + 1)
            return res.status(400).json({
                error: `Can only move one step forward. Current: '${lead.status}', next allowed: '${PIPELINE_ORDER[currentIdx + 1] || 'none'}'`
            });

        // ═══ QUALITY GATE (v4.2): TC cannot schedule visit without key fields ═══
        if (newStatus === 'Site Visit Scheduled') {
            const extra = lead.extra_details ? JSON.parse(lead.extra_details) : {};
            const missing = [];
            if (!lead.occupation) missing.push('Occupation');
            if (!lead.budget_range) missing.push('Budget Range');
            if (!extra.bhk_config && !extra.configuration) missing.push('BHK/Configuration');
            if (missing.length > 0) {
                return res.status(400).json({
                    error: `Quality Gate: Complete these fields before scheduling a visit: ${missing.join(', ')}`,
                    missing_fields: missing
                });
            }

            // ═══ BATON PASS (v4.2): TC must assign an Agent ═══
            const { assigned_agent: batonAgent } = req.body;
            if (!batonAgent && !lead.assigned_agent) {
                return res.status(400).json({
                    error: 'Baton Pass: You must select an assigned Agent before scheduling a site visit.'
                });
            }
            if (batonAgent) {
                runStmt('UPDATE leads SET assigned_agent = ? WHERE id = ?', [batonAgent, leadId]);
                logAudit(runStmt, user.id, leadId, 'baton_pass', {
                    from_telecaller: user.id, to_agent: batonAgent,
                    message: 'TC ownership ended — lead transferred to Agent'
                });
            }
        }

        // Save next_follow_up if provided
        if (next_follow_up) {
            runStmt('UPDATE leads SET status = ?, next_follow_up = ? WHERE id = ?', [newStatus, next_follow_up, leadId]);
        } else {
            runStmt('UPDATE leads SET status = ? WHERE id = ?', [newStatus, leadId]);
        }

        // Audit log
        logAudit(runStmt, user.id, leadId, 'status_change',
            { from: lead.status, to: newStatus, next_follow_up: next_follow_up || null });

        const updated = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
        return res.json({ lead: updated });
    }
);

// PUT /api/leads/:id/match-property
router.put('/:id/match-property', (req, res) => {
    const leadId = parseInt(req.params.id);
    const { property_id } = req.body;
    const user = req.session.user;

    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (user.role === 'agent' && lead.created_by !== user.id)
        return res.status(403).json({ error: 'Access denied' });

    // If lead is Booking Confirmed and had a DIFFERENT previous property, restore it
    if (lead.matched_property_id &&
        lead.matched_property_id !== (property_id ? parseInt(property_id) : null) &&
        lead.status === 'Booking Confirmed') {
        runStmt('UPDATE properties SET is_available = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [lead.matched_property_id]);
    }

    if (property_id === null || property_id === undefined || property_id === '') {
        runStmt('UPDATE leads SET matched_property_id = NULL WHERE id = ?', [leadId]);
    } else {
        const property = queryOne('SELECT * FROM properties WHERE id = ?', [parseInt(property_id)]);
        if (!property) return res.status(404).json({ error: 'Property not found' });
        runStmt('UPDATE leads SET matched_property_id = ? WHERE id = ?', [parseInt(property_id), leadId]);

        // If lead is already Booking Confirmed, immediately mark new property as sold
        if (lead.status === 'Booking Confirmed') {
            runStmt('UPDATE properties SET is_available = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [parseInt(property_id)]);
        }
    }

    // Recalculate score with new property match
    const scoreResult = recalculateAndSave(leadId, queryOne, runStmt, req.session.user.id);
    const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);

    let soldProperty = null;
    if (lead.status === 'Booking Confirmed' && property_id) {
        soldProperty = queryOne('SELECT * FROM properties WHERE id = ?', [parseInt(property_id)]);
    }

    return res.json({
        lead: updatedLead,
        new_ml_status: scoreResult ? scoreResult.status : lead.ml_status,
        score: scoreResult ? scoreResult.score : null,
        property_sold: !!soldProperty,
        sold_property: soldProperty
    });
});

// DELETE /api/leads/:id — Admin only
router.delete('/:id', isAdmin, (req, res) => {
    const leadId = parseInt(req.params.id);
    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // If lead was Booking Confirmed with a property, restore property availability
    if (lead.status === 'Booking Confirmed' && lead.matched_property_id) {
        runStmt('UPDATE properties SET is_available = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [lead.matched_property_id]);
    }

    runStmt('DELETE FROM interactions WHERE lead_id = ?', [leadId]);
    runStmt('DELETE FROM site_visits WHERE lead_id = ?', [leadId]);
    runStmt('DELETE FROM leads WHERE id = ?', [leadId]);
    return res.json({ message: 'Lead deleted' });
});

// PUT /api/leads/:id/assign — Manager/Admin: reassign lead to telecaller or agent
router.put('/:id/assign', isManagerOrAdmin, (req, res) => {
    const leadId = parseInt(req.params.id);
    const { assigned_telecaller, assigned_agent } = req.body;
    const user = req.session.user;

    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = [];
    const params = [];
    const auditDetails = {};

    if (assigned_telecaller !== undefined) {
        updates.push('assigned_telecaller = ?');
        params.push(assigned_telecaller || null);
        auditDetails.assigned_telecaller = { from: lead.assigned_telecaller, to: assigned_telecaller || null };
    }
    if (assigned_agent !== undefined) {
        updates.push('assigned_agent = ?');
        params.push(assigned_agent || null);
        auditDetails.assigned_agent = { from: lead.assigned_agent, to: assigned_agent || null };
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(leadId);
    runStmt(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, params);

    // Audit log
    logAudit(runStmt, user.id, leadId, 'assignment', auditDetails);

    const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    return res.json({ lead: updatedLead, message: 'Lead reassigned successfully' });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/leads/:id/flag-junk — Agent flags lead as Junk/Fake
// ─────────────────────────────────────────────────────────────
router.put('/:id/flag-junk', (req, res) => {
    const leadId = parseInt(req.params.id);
    const { reason } = req.body;
    const user = req.session.user;

    // Only agents, managers, admins can flag junk
    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Only Agents/Managers can flag leads as junk' });
    }

    if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ error: 'A reason (min 5 chars) is required' });
    }

    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    runStmt(
        'UPDATE leads SET is_junk = 1, junk_reason = ?, ml_status = ? WHERE id = ?',
        [reason, 'Cold', leadId]
    );

    logAudit(runStmt, user.id, leadId, 'lead_flagged_junk', {
        reason, flagged_by: user.username,
        assigning_tc: lead.assigned_telecaller
    });

    // Recalculate score (will apply -50 junk penalty)
    recalculateAndSave(leadId, queryOne, runStmt, user.id);

    return res.json({ message: 'Lead flagged as Junk. Score penalized by -50.' });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/leads/:id/decision-deadline — Set decision deadline
// ─────────────────────────────────────────────────────────────
router.put('/:id/decision-deadline', (req, res) => {
    const leadId = parseInt(req.params.id);
    const { decision_deadline } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Only Agents/Managers can set decision deadlines' });
    }

    if (!decision_deadline) {
        return res.status(400).json({ error: 'decision_deadline is required (ISO date)' });
    }

    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    runStmt(
        'UPDATE leads SET decision_deadline = ? WHERE id = ?',
        [decision_deadline, leadId]
    );

    logAudit(runStmt, user.id, leadId, 'decision_deadline_set', {
        deadline: decision_deadline, set_by: user.username
    });

    return res.json({ message: 'Decision deadline set', decision_deadline });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/leads/:id/reopen — Admin/Manager re-opens a closed lead
// ─────────────────────────────────────────────────────────────
router.put('/:id/reopen', (req, res) => {
    const leadId = parseInt(req.params.id);
    const { reason } = req.body;
    const user = req.session.user;

    // Only Admin/Manager can re-open
    if (!['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({ error: 'Only Admin/Manager can re-open closed leads' });
    }

    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A reason is required to re-open a lead' });
    }

    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const TERMINAL = ['Booking Confirmed', 'Not Interested'];
    if (!TERMINAL.includes(lead.status)) {
        return res.status(400).json({ error: 'Lead is not in a terminal status' });
    }

    // Re-open to 'Contacted' (safe midpoint)
    runStmt('UPDATE leads SET status = ?, ml_status = NULL WHERE id = ?',
        ['Contacted', leadId]);

    logAudit(runStmt, user.id, leadId, 'lead_reopened', {
        reason: reason.trim(),
        previous_status: lead.status,
        reopened_by: user.username
    });

    // Recalculate fresh score
    recalculateAndSave(leadId, queryOne, runStmt, user.id);

    const updated = queryOne('SELECT * FROM leads WHERE id = ?', [leadId]);
    return res.json({ message: 'Lead re-opened', lead: updated });
});

module.exports = router;
