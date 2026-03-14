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
// ─────────────────────────────────────────────────────────────
async function roundRobinAssign(role) {
    const candidates = await queryAll(
        `SELECT u.id, u.username, u.capacity_limit,
                COUNT(l.id) as active_leads
         FROM users u
         LEFT JOIN leads l ON (
           (u.role = 'telecaller' AND l.assigned_telecaller = u.id)
           OR (u.role = 'agent' AND l.assigned_agent = u.id)
         ) AND l.status NOT IN ('Booking Confirmed', 'Not Interested')
         WHERE u.role = $1 AND u.is_active = 1
         GROUP BY u.id, u.username, u.capacity_limit
         HAVING COUNT(l.id) < COALESCE(u.capacity_limit, 20)
         ORDER BY COUNT(l.id) ASC, u.last_assigned_at ASC NULLS FIRST
         LIMIT 1`,
        [role]
    );
    if (candidates.length > 0) {
        await runStmt('UPDATE users SET last_assigned_at = NOW() WHERE id = $1', [candidates[0].id]);
        return candidates[0];
    }
    return null;
}

const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Site Visit Scheduled',
    'Site Visited', 'Negotiation', 'Booking Confirmed', 'Not Interested'
];

// GET /api/leads/check-phone — Check if phone exists
router.get('/check-phone',
    async (req, res) => {
        const { phone } = req.query;
        if (!phone) return res.status(400).json({ error: 'phone param required' });

        const lead = await queryOne(
            'SELECT id, name, status, ml_status, created_at FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
            [phone]
        );
        if (!lead) return res.json({ exists: false });

        const totalRow = await queryOne('SELECT COUNT(*) as cnt FROM leads WHERE phone = $1', [phone]);
        const total = totalRow ? parseInt(totalRow.cnt) : 0;
        return res.json({
            exists: true,
            status: lead.status,
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
    // Build lookup from DB rows — may be empty, that's fine
    const rowMap = {};
    (rows || []).forEach(r => { rowMap[r.period] = r; });

    const result = [];
    // Always generate the full skeleton from startDate to endDate
    const current = startDate ? new Date(startDate) : new Date();
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
// PostgreSQL uses AT TIME ZONE 'Asia/Kolkata' for IST conversion
router.get('/timeline', async (req, res) => {
    try {
        const { granularity = 'month', range = '1y' } = req.query;
        const user = req.session.user;

        const roleParams = [];
        let roleFilter = '';
        let paramIdx = 1;

        if (user.role !== 'admin' && user.role !== 'manager') {
            roleFilter = `AND created_by = $${paramIdx}`;
            roleParams.push(user.id);
            paramIdx++;
        }

        // Special case: day_hour (1D – hourly grouping)
        if (granularity === 'day_hour') {
            // Get today's date in IST
            const todayResult = await queryOne("SELECT to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') as today");
            const todayStr = todayResult.today;

            const sql = `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'HH24') as hour,
                COUNT(*) as total,
                SUM(CASE WHEN ml_status = 'Hot' THEN 1 ELSE 0 END) as hot,
                SUM(CASE WHEN ml_status = 'Warm' THEN 1 ELSE 0 END) as warm,
                SUM(CASE WHEN ml_status = 'Cold' THEN 1 ELSE 0 END) as cold,
                SUM(CASE WHEN status = 'Booking Confirmed' THEN 1 ELSE 0 END) as confirmed
                FROM leads
                WHERE to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${paramIdx} ${roleFilter}
                GROUP BY hour ORDER BY hour ASC`;
            const rows = await queryAll(sql, [...roleParams, todayStr]);

            const rowMap = {};
            rows.forEach(r => { rowMap[r.hour] = r; });
            const filled = [];
            for (let h = 0; h <= 23; h++) {
                const hourKey = String(h).padStart(2, '0');
                const period = `${todayStr}T${hourKey}`;
                const row = rowMap[hourKey];
                filled.push({
                    period,
                    total: parseInt(row?.total) || 0,
                    hot: parseInt(row?.hot) || 0,
                    warm: parseInt(row?.warm) || 0,
                    cold: parseInt(row?.cold) || 0,
                    confirmed: parseInt(row?.confirmed) || 0
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
            case 'day': dateFormat = "to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')"; break;
            case 'year': dateFormat = "to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY')"; break;
            default: dateFormat = "to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')"; break;
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
            sql += ` AND created_by = $${params.indexOf(user.id) + 1}`;
        }
        if (startDate) {
            params.push(startDate.toISOString());
            sql += ` AND created_at >= $${params.length}`;
        }
        sql += ' GROUP BY period ORDER BY period ASC';

        const rows = await queryAll(sql, params);
        // Convert bigint counts to numbers
        const normalized = rows.map(r => ({
            ...r,
            total: parseInt(r.total) || 0,
            hot: parseInt(r.hot) || 0,
            warm: parseInt(r.warm) || 0,
            cold: parseInt(r.cold) || 0,
            confirmed: parseInt(r.confirmed) || 0
        }));
        const filledRows = fillMissingPeriods(normalized, granularity, startDate, now);

        return res.json({ granularity, range, data: filledRows });
    } catch (err) {
        console.error('Timeline error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/leads/by-period — leads for a specific period
router.get('/by-period', async (req, res) => {
    try {
        const { period, granularity = 'month', ml_status } = req.query;
        const user = req.session.user;
        if (!period) return res.status(400).json({ error: 'period param required' });

        let dateFilter;
        const params = [];
        let paramIdx = 1;

        switch (granularity) {
            case 'day_hour': {
                const [datePart, hourPart] = period.split('T');
                dateFilter = `to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${paramIdx} AND to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24') = $${paramIdx + 1}`;
                params.push(datePart, String(hourPart || '00').padStart(2, '0'));
                paramIdx += 2;
                break;
            }
            case 'day':
                dateFilter = `to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${paramIdx}`;
                params.push(period); paramIdx++; break;
            case 'year':
                dateFilter = `to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY') = $${paramIdx}`;
                params.push(period); paramIdx++; break;
            default:
                dateFilter = `to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $${paramIdx}`;
                params.push(period); paramIdx++; break;
        }

        let roleFilter = '';
        if (user.role !== 'admin' && user.role !== 'manager') {
            roleFilter = `AND l.created_by = $${paramIdx}`;
            params.push(user.id);
            paramIdx++;
        }

        let mlFilter = '';
        if (ml_status && ['Hot', 'Warm', 'Cold'].includes(ml_status)) {
            mlFilter = `AND l.ml_status = $${paramIdx}`;
            params.push(ml_status);
            paramIdx++;
        }

        const leads = await queryAll(
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
router.get('/', async (req, res) => {
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
    let paramIdx = 1;

    if (user.role === 'telecaller') {
        sql += ` AND (leads.assigned_telecaller = $${paramIdx} OR leads.created_by = $${paramIdx + 1})`;
        params.push(user.id, user.id);
        paramIdx += 2;
    } else if (user.role === 'agent') {
        sql += ` AND leads.assigned_agent = $${paramIdx}`;
        params.push(user.id);
        paramIdx++;
    }

    const mlFilter = ml_status || (status && ML_VALUES.includes(status) ? status : null);
    if (mlFilter && ML_VALUES.includes(mlFilter)) {
        sql += ` AND leads.ml_status = $${paramIdx}`;
        params.push(mlFilter);
        paramIdx++;
    }

    const stageFilter = stage || (status && PIPELINE_STAGES.includes(status) && !ML_VALUES.includes(status) ? status : null);
    if (stageFilter && PIPELINE_STAGES.includes(stageFilter)) {
        sql += ` AND leads.status = $${paramIdx}`;
        params.push(stageFilter);
        paramIdx++;
    }

    sql += ' ORDER BY leads.created_at DESC';
    const leads = await queryAll(sql, params);
    return res.json(leads);
});

// POST /api/leads — Create (with duplicate phone check + inquiry counter)
router.post('/',
    body('name').notEmpty().isLength({ min: 2, max: 60 }).matches(/^[a-zA-Z\s]+$/)
        .withMessage('Name must be 2–60 characters and contain only letters'),
    body('phone').matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number starting with 6-9'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address'),
    body('preferred_property_type').optional(),
    body('budget_range').optional(),
    async (req, res) => {
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
        const existingLead = await queryOne('SELECT * FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [phone]);
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

        const countRow = await queryOne('SELECT COUNT(*) as cnt FROM leads WHERE phone = $1', [phone]);
        const prevCount = countRow ? parseInt(countRow.cnt) : 0;
        const inquiryCount = prevCount + 1;

        const extraDetailsJson = extra_details ? JSON.stringify(extra_details) : null;

        const user = req.session.user;
        let telecallerId = assigned_telecaller || (user.role === 'telecaller' ? user.id : null);
        let agentId = assigned_agent || null;

        // VIP Auto-Assignment
        if (existingLead && existingLead.is_vip && existingLead.assigned_agent) {
            agentId = existingLead.assigned_agent;
            await logAudit(user.id, null, 'vip_auto_assign', {
                message: `VIP returning — auto-assigned to previous agent (ID: ${agentId})`,
                original_lead_id: existingLead.id
            });
        }

        if (!telecallerId) {
            const assignedTc = await roundRobinAssign('telecaller');
            if (assignedTc) telecallerId = assignedTc.id;
        }

        const result = await runStmt(
            `INSERT INTO leads (name, phone, email, preferred_property_type,
       preferred_state, preferred_city, preferred_area, budget_range,
       funding_source, urgency, occupation, purchase_purpose,
       possession_timeline, extra_details,
       status, ml_status, matched_property_id,
       inquiry_count, linked_phone, created_by,
       assigned_telecaller, assigned_agent, next_follow_up)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'New Inquiry', 'Cold', $15, $16, $17, $18, $19, $20, $21)`,
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
            const creatorUser = await queryOne('SELECT username FROM users WHERE id = $1', [existingLead.created_by]);
            await runStmt(
                `INSERT INTO lead_history
         (phone, lead_id, source_lead_id, lead_name, property_type, budget_range,
           final_stage, added_by_username, added_date, closure_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [phone, newLeadId, existingLead.id, existingLead.name,
                    existingLead.preferred_property_type, existingLead.budget_range,
                    existingLead.status, creatorUser ? creatorUser.username : 'Unknown',
                    existingLead.created_at, existingLead.status]
            );
        }

        // Calculate initial lead score
        let scoreResult = null;
        try {
            scoreResult = await recalculateAndSave(newLeadId, req.session.user.id);
        } catch (e) { console.warn('[Scoring] Error on new lead:', e.message); }

        // v4.2 Zombie Resurrection
        let isZombie = false;
        if (existingLead && (existingLead.status === 'Not Interested' || existingLead.status === 'Booking Confirmed')) {
            const daysSinceClosed = (Date.now() - new Date(existingLead.created_at).getTime()) / 86400000;
            isZombie = daysSinceClosed >= 180;
            if (!isZombie && existingLead.assigned_agent) {
                await logAudit(req.session.user.id, newLeadId, 'zombie_short_return', {
                    message: `Lead re-inquired within 180 days. Original agent (ID: ${existingLead.assigned_agent}) should be notified.`,
                    original_lead_id: existingLead.id,
                    days_since_close: Math.round(daysSinceClosed)
                });
            }
        }

        await logAudit(req.session.user.id, newLeadId, 'lead_created',
            { name, phone, assigned_telecaller: telecallerId, assigned_agent: assigned_agent || null });

        const newLead = await queryOne('SELECT * FROM leads WHERE id = $1', [newLeadId]);
        return res.status(201).json({
            lead: newLead,
            score: scoreResult ? scoreResult.score : null,
            breakdown: scoreResult ? scoreResult.breakdown : null
        });
    }
);

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
    const user = req.session.user;
    const leadId = parseInt(req.params.id);

    const lead = await queryOne(`SELECT leads.*, users.username as agent_name
    FROM leads LEFT JOIN users ON leads.created_by = users.id WHERE leads.id = $1`, [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (user.role === 'telecaller' && lead.assigned_telecaller !== user.id && lead.created_by !== user.id)
        return res.status(403).json({ error: 'Access denied' });
    if (user.role === 'agent' && lead.assigned_agent !== user.id)
        return res.status(403).json({ error: 'Access denied' });

    const interactions = await queryAll(
        'SELECT * FROM interactions WHERE lead_id = $1 ORDER BY interaction_date DESC', [leadId]);
    const site_visits = await queryAll(
        'SELECT * FROM site_visits WHERE lead_id = $1 ORDER BY logged_at DESC', [leadId]);
    let matched_property = null;
    if (lead.matched_property_id)
        matched_property = await queryOne('SELECT * FROM properties WHERE id = $1', [lead.matched_property_id]);

    const negotiation_count = await queryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE lead_id = $1 AND status = 'Active'`, [leadId]);
    const booking_count = await queryOne(
        `SELECT COUNT(*) as cnt FROM bookings WHERE lead_id = $1`, [leadId]);

    return res.json({
        lead, interactions, site_visits, matched_property,
        active_negotiations: parseInt(negotiation_count?.cnt) || 0,
        total_bookings: parseInt(booking_count?.cnt) || 0
    });
});

// GET /api/leads/:id/history — Lead history by phone
router.get('/:id/history', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const lead = await queryOne('SELECT phone FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const history = await queryAll(
        'SELECT * FROM lead_history WHERE phone = $1 ORDER BY added_date DESC',
        [lead.phone]
    );
    return res.json({ history });
});

// PUT /api/leads/:id/status
router.put('/:id/status',
    body('status').notEmpty().withMessage('Status is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

        const leadId = parseInt(req.params.id);
        const { status: newStatus, next_follow_up } = req.body;
        const user = req.session.user;

        if (!PIPELINE_ORDER.includes(newStatus))
            return res.status(400).json({ error: `Invalid status. Must be one of: ${PIPELINE_ORDER.join(', ')}` });

        const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        if (user.role === 'agent' && lead.created_by !== user.id)
            return res.status(403).json({ error: 'Access denied' });

        // Reverse Logic
        if (lead.status === 'Booking Confirmed' && newStatus !== 'Booking Confirmed') {
            if (lead.matched_property_id) {
                await runStmt('UPDATE properties SET is_available = 1, updated_at = NOW() WHERE id = $1',
                    [lead.matched_property_id]);
            }
        }

        // Booking Confirmed
        if (newStatus === 'Booking Confirmed') {
            const propertyPrice = lead.matched_property_id
                ? ((await queryOne('SELECT price_inr FROM properties WHERE id = $1', [lead.matched_property_id]))?.price_inr || 0)
                : 0;
            await runStmt(
                `UPDATE leads SET status = $1, ml_status = 'Gold', is_vip = 1,
                 lifetime_value = COALESCE(lifetime_value, 0) + $2 WHERE id = $3`,
                ['Booking Confirmed', propertyPrice, leadId]
            );

            let soldProperty = null;
            if (lead.matched_property_id) {
                await runStmt(`UPDATE properties SET is_available = 0, availability_status = 'Sold',
                    updated_at = NOW() WHERE id = $1`, [lead.matched_property_id]);
                soldProperty = await queryOne('SELECT * FROM properties WHERE id = $1', [lead.matched_property_id]);
            }

            await logAudit(user.id, leadId, 'vip_status_granted', {
                message: 'Lead achieved Booking Confirmed — permanent VIP/Gold status',
                lifetime_value: (lead.lifetime_value || 0) + propertyPrice
            });

            const updated = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
            return res.json({
                lead: updated, property_sold: !!soldProperty,
                sold_property: soldProperty, vip_granted: true
            });
        }

        // Not Interested: VIP protection
        if (newStatus === 'Not Interested') {
            if (lead.is_vip) {
                await logAudit(user.id, leadId, 'vip_inquiry_closed', {
                    message: 'VIP rejected current inquiry but retains Gold status',
                    from: lead.status, attempted: 'Not Interested'
                });
                const updated = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
                return res.json({
                    lead: updated, vip_protected: true,
                    message: 'VIP lead is protected. Inquiry session closed but Gold status preserved.'
                });
            }
            await runStmt('UPDATE leads SET status = $1, ml_status = $2 WHERE id = $3',
                ['Not Interested', 'Cold', leadId]);
            await logAudit(user.id, leadId, 'status_change', { from: lead.status, to: 'Not Interested' });
            const updated = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
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

        // Quality Gate (v4.2)
        if (newStatus === 'Site Visit Scheduled') {
            let extra = {};
            try { extra = typeof lead.extra_details === 'string' ? JSON.parse(lead.extra_details) : (lead.extra_details || {}); } catch (e) { extra = {}; }
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

            // Baton Pass (v4.2)
            const { assigned_agent: batonAgent } = req.body;
            if (!batonAgent && !lead.assigned_agent) {
                return res.status(400).json({ error: 'Baton Pass: You must select an assigned Agent before scheduling a site visit.' });
            }
            if (batonAgent) {
                await runStmt('UPDATE leads SET assigned_agent = $1 WHERE id = $2', [batonAgent, leadId]);
                await logAudit(user.id, leadId, 'baton_pass', {
                    from_telecaller: user.id, to_agent: batonAgent,
                    message: 'TC ownership ended — lead transferred to Agent'
                });
            }
        }

        if (next_follow_up) {
            await runStmt('UPDATE leads SET status = $1, next_follow_up = $2 WHERE id = $3', [newStatus, next_follow_up, leadId]);
        } else {
            await runStmt('UPDATE leads SET status = $1 WHERE id = $2', [newStatus, leadId]);
        }

        await logAudit(user.id, leadId, 'status_change',
            { from: lead.status, to: newStatus, next_follow_up: next_follow_up || null });

        const updated = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
        return res.json({ lead: updated });
    }
);

// PUT /api/leads/:id/match-property
router.put('/:id/match-property', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { property_id } = req.body;
    const user = req.session.user;

    const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (user.role === 'agent' && lead.created_by !== user.id)
        return res.status(403).json({ error: 'Access denied' });

    if (lead.matched_property_id &&
        lead.matched_property_id !== (property_id ? parseInt(property_id) : null) &&
        lead.status === 'Booking Confirmed') {
        await runStmt('UPDATE properties SET is_available = 1, updated_at = NOW() WHERE id = $1',
            [lead.matched_property_id]);
    }

    if (property_id === null || property_id === undefined || property_id === '') {
        await runStmt('UPDATE leads SET matched_property_id = NULL WHERE id = $1', [leadId]);
    } else {
        const property = await queryOne('SELECT * FROM properties WHERE id = $1', [parseInt(property_id)]);
        if (!property) return res.status(404).json({ error: 'Property not found' });
        await runStmt('UPDATE leads SET matched_property_id = $1 WHERE id = $2', [parseInt(property_id), leadId]);

        if (lead.status === 'Booking Confirmed') {
            await runStmt('UPDATE properties SET is_available = 0, updated_at = NOW() WHERE id = $1',
                [parseInt(property_id)]);
        }
    }

    let scoreResult = null;
    try { scoreResult = await recalculateAndSave(leadId, req.session.user.id); } catch (e) { }
    const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);

    let soldProperty = null;
    if (lead.status === 'Booking Confirmed' && property_id) {
        soldProperty = await queryOne('SELECT * FROM properties WHERE id = $1', [parseInt(property_id)]);
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
router.delete('/:id', isAdmin, async (req, res) => {
    const leadId = parseInt(req.params.id);
    const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (lead.status === 'Booking Confirmed' && lead.matched_property_id) {
        await runStmt('UPDATE properties SET is_available = 1, updated_at = NOW() WHERE id = $1',
            [lead.matched_property_id]);
    }

    await runStmt('DELETE FROM interactions WHERE lead_id = $1', [leadId]);
    await runStmt('DELETE FROM site_visits WHERE lead_id = $1', [leadId]);
    await runStmt('DELETE FROM leads WHERE id = $1', [leadId]);
    return res.json({ message: 'Lead deleted' });
});

// PUT /api/leads/:id/assign — Manager/Admin: reassign
router.put('/:id/assign', isManagerOrAdmin, async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { assigned_telecaller, assigned_agent } = req.body;
    const user = req.session.user;

    const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = [];
    const params = [];
    const auditDetails = {};
    let paramIdx = 1;

    if (assigned_telecaller !== undefined) {
        updates.push(`assigned_telecaller = $${paramIdx}`);
        params.push(assigned_telecaller || null);
        auditDetails.assigned_telecaller = { from: lead.assigned_telecaller, to: assigned_telecaller || null };
        paramIdx++;
    }
    if (assigned_agent !== undefined) {
        updates.push(`assigned_agent = $${paramIdx}`);
        params.push(assigned_agent || null);
        auditDetails.assigned_agent = { from: lead.assigned_agent, to: assigned_agent || null };
        paramIdx++;
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(leadId);
    await runStmt(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
    await logAudit(user.id, leadId, 'assignment', auditDetails);

    const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    return res.json({ lead: updatedLead, message: 'Lead reassigned successfully' });
});

// PUT /api/leads/:id/flag-junk
router.put('/:id/flag-junk', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { reason } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Only Agents/Managers can flag leads as junk' });
    }
    if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ error: 'A reason (min 5 chars) is required' });
    }

    const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await runStmt('UPDATE leads SET is_junk = 1, junk_reason = $1, ml_status = $2 WHERE id = $3',
        [reason, 'Cold', leadId]);

    await logAudit(user.id, leadId, 'lead_flagged_junk', {
        reason, flagged_by: user.username, assigning_tc: lead.assigned_telecaller
    });

    try { await recalculateAndSave(leadId, user.id); } catch (e) { }

    return res.json({ message: 'Lead flagged as Junk. Score penalized by -50.' });
});

// PUT /api/leads/:id/decision-deadline
router.put('/:id/decision-deadline', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { decision_deadline } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Only Agents/Managers can set decision deadlines' });
    }
    if (!decision_deadline) {
        return res.status(400).json({ error: 'decision_deadline is required (ISO date)' });
    }

    const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await runStmt('UPDATE leads SET decision_deadline = $1 WHERE id = $2', [decision_deadline, leadId]);

    await logAudit(user.id, leadId, 'decision_deadline_set', {
        deadline: decision_deadline, set_by: user.username
    });

    return res.json({ message: 'Decision deadline set', decision_deadline });
});

// PUT /api/leads/:id/reopen
router.put('/:id/reopen', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { reason } = req.body;
    const user = req.session.user;

    if (!['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({ error: 'Only Admin/Manager can re-open closed leads' });
    }

    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A reason is required to re-open a lead' });
    }

    const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const TERMINAL = ['Booking Confirmed', 'Not Interested'];
    if (!TERMINAL.includes(lead.status)) {
        return res.status(400).json({ error: 'Lead is not in a terminal status' });
    }

    await runStmt('UPDATE leads SET status = $1, ml_status = NULL WHERE id = $2', ['Contacted', leadId]);

    await logAudit(user.id, leadId, 'lead_reopened', {
        reason: reason.trim(), previous_status: lead.status, reopened_by: user.username
    });

    try { await recalculateAndSave(leadId, user.id); } catch (e) { }

    const updated = await queryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    return res.json({ message: 'Lead re-opened', lead: updated });
});

module.exports = router;
