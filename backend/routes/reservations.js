const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');

router.use(isAuthenticated);

// Tier durations (ms)
const TIER2_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const TIER3_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours
const ROFR_WINDOW_MS = 2 * 60 * 60 * 1000;     // 2 hours

// GET /api/reservations/:propertyId
router.get('/:propertyId', async (req, res) => {
    const propertyId = parseInt(req.params.propertyId);
    const reservations = await queryAll(`
        SELECT r.*, l.name as lead_name, l.phone as lead_phone,
               u.username as challenger_agent
        FROM reservations r
        JOIN leads l ON r.lead_id = l.id
        LEFT JOIN leads cl ON r.rofr_challenge_by = cl.id
        LEFT JOIN users u ON cl.assigned_agent = u.id
        WHERE r.property_id = $1
        ORDER BY r.tier ASC, r.created_at DESC
    `, [propertyId]);

    return res.json({ reservations });
});

// GET /api/reservations/lead/:leadId
router.get('/lead/:leadId', async (req, res) => {
    const leadId = parseInt(req.params.leadId);
    const reservations = await queryAll(`
        SELECT r.*, p.property_name, p.property_type, p.city, p.price_inr,
               p.availability_status
        FROM reservations r
        JOIN properties p ON r.property_id = p.id
        WHERE r.lead_id = $1 AND r.status = 'Active'
        ORDER BY r.tier ASC, r.expires_at ASC
    `, [leadId]);

    return res.json({ reservations });
});

// POST /api/reservations
router.post('/', async (req, res) => {
    const { lead_id, property_id, tier } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot create reservations' });
    }

    if (!lead_id || !property_id || ![2, 3].includes(tier)) {
        return res.status(400).json({ error: 'lead_id, property_id, and tier (2 or 3) are required' });
    }

    const property = await queryOne('SELECT * FROM properties WHERE id = $1', [property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    if (property.availability_status === 'Sold') {
        return res.status(409).json({ error: 'Property is already sold' });
    }

    if (tier === 2) {
        const existingTier2 = await queryOne(
            `SELECT id, property_id FROM reservations WHERE lead_id = $1 AND tier = 2 AND status = 'Active'`,
            [lead_id]
        );
        if (existingTier2) {
            return res.status(409).json({
                error: 'One-Block Limit: This lead already has an active Tier-2 reservation',
                existing_reservation_id: existingTier2.id,
                existing_property_id: existingTier2.property_id
            });
        }

        if (property.availability_status === 'Reserved' && property.current_priority_lead_id !== lead_id) {
            return res.status(409).json({
                error: 'Property is already Reserved by another lead. Use "Challenge Reservation" instead.',
                current_priority_lead_id: property.current_priority_lead_id
            });
        }
    }

    const existing = await queryOne(
        `SELECT id FROM reservations WHERE lead_id = $1 AND property_id = $2 AND status = 'Active'`,
        [lead_id, property_id]
    );
    if (existing) {
        return res.status(409).json({ error: 'Active reservation already exists for this lead on this property' });
    }

    const now = new Date();
    const durationMs = tier === 2 ? TIER2_DURATION_MS : TIER3_DURATION_MS;
    const expiresAt = new Date(now.getTime() + durationMs).toISOString();

    const result = await runStmt(
        `INSERT INTO reservations (lead_id, property_id, tier, expires_at) VALUES ($1, $2, $3, $4)`,
        [lead_id, property_id, tier, expiresAt]
    );

    if (tier === 2) {
        await runStmt(
            `UPDATE properties SET availability_status = 'Reserved', current_priority_lead_id = $1 WHERE id = $2`,
            [lead_id, property_id]
        );
    }

    await logAudit(user.id, lead_id, 'reservation_created', {
        reservation_id: result.lastInsertRowid, property_id, tier,
        property_name: property.property_name, expires_at: expiresAt
    });

    try { await recalculateAndSave(lead_id, user.id); } catch (e) { }

    return res.status(201).json({
        id: result.lastInsertRowid,
        tier, expires_at: expiresAt,
        message: tier === 2 ? 'Tier-2 Soft-Block created. Property is now Reserved.' : 'Tier-3 Interest registered.'
    });
});

// PUT /api/reservations/:id/extend
router.put('/:id/extend', async (req, res) => {
    const resId = parseInt(req.params.id);
    const { manager_comment } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot extend reservations' });
    }

    const reservation = await queryOne('SELECT * FROM reservations WHERE id = $1', [resId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'Active') return res.status(400).json({ error: 'Reservation is not active' });

    if (reservation.extension_count >= 2) {
        return res.status(400).json({ error: 'Maximum extensions (2) reached. Cannot extend further.' });
    }

    if (reservation.extension_count >= 1) {
        if (user.role !== 'manager' && user.role !== 'admin') {
            return res.status(403).json({ error: 'Second extension requires Manager/Admin approval' });
        }
        if (!manager_comment || manager_comment.trim().length < 5) {
            return res.status(400).json({ error: 'Manager comment (min 5 chars) is required for second extension' });
        }
    }

    const durationMs = reservation.tier === 2 ? TIER2_DURATION_MS : TIER3_DURATION_MS;
    const currentExpiry = new Date(reservation.expires_at);
    const newExpiry = new Date(Math.max(currentExpiry.getTime(), Date.now()) + durationMs).toISOString();

    await runStmt(
        `UPDATE reservations SET expires_at = $1, extension_count = extension_count + 1,
         manager_comment = COALESCE($2, manager_comment), updated_at = NOW() WHERE id = $3`,
        [newExpiry, manager_comment || null, resId]
    );

    await logAudit(user.id, reservation.lead_id, 'reservation_extended', {
        reservation_id: resId, extension_number: reservation.extension_count + 1,
        new_expires_at: newExpiry, manager_comment: manager_comment || null
    });

    return res.json({
        message: `Reservation extended (${reservation.extension_count + 1}/2)`,
        new_expires_at: newExpiry
    });
});

// POST /api/reservations/:id/challenge — ROFR Challenge
router.post('/:id/challenge', async (req, res) => {
    const resId = parseInt(req.params.id);
    const { challenger_lead_id } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot challenge reservations' });
    }

    if (!challenger_lead_id) {
        return res.status(400).json({ error: 'challenger_lead_id is required' });
    }

    const reservation = await queryOne('SELECT * FROM reservations WHERE id = $1', [resId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'Active') return res.status(400).json({ error: 'Reservation is not active' });
    if (reservation.tier !== 2) return res.status(400).json({ error: 'Only Tier-2 reservations can be challenged' });
    if (reservation.lead_id === challenger_lead_id) {
        return res.status(400).json({ error: 'Cannot challenge your own reservation' });
    }

    if (reservation.rofr_challenge_by) {
        return res.status(409).json({ error: 'This reservation is already under ROFR challenge' });
    }

    const rofrDeadline = new Date(Date.now() + ROFR_WINDOW_MS).toISOString();

    await runStmt(
        `UPDATE reservations SET rofr_challenge_by = $1, rofr_deadline = $2, updated_at = NOW() WHERE id = $3`,
        [challenger_lead_id, rofrDeadline, resId]
    );

    await logAudit(user.id, reservation.lead_id, 'rofr_challenge_issued', {
        reservation_id: resId, challenger_lead_id,
        property_id: reservation.property_id, rofr_deadline: rofrDeadline,
        message: `ROFR Alert: A hard offer has been received. 2-hour window to complete booking.`
    });

    try { await recalculateAndSave(reservation.lead_id, user.id); } catch (e) { }

    return res.json({
        message: 'ROFR Challenge issued! The reservation holder has 2 hours to complete booking.',
        rofr_deadline: rofrDeadline
    });
});

// PUT /api/reservations/:id/force-release — Manager Override
router.put('/:id/force-release', async (req, res) => {
    const resId = parseInt(req.params.id);
    const { reason } = req.body;
    const user = req.session.user;

    if (user.role !== 'manager' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Only Managers/Admins can force-release reservations' });
    }

    if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ error: 'A reason (min 5 chars) is required for force-release' });
    }

    const reservation = await queryOne('SELECT * FROM reservations WHERE id = $1', [resId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'Active') return res.status(400).json({ error: 'Reservation is not active' });

    await runStmt(
        `UPDATE reservations SET status = 'Overridden', manager_comment = $1, updated_at = NOW() WHERE id = $2`,
        [reason, resId]
    );

    if (reservation.tier === 2) {
        await runStmt(
            `UPDATE properties SET availability_status = 'Available', current_priority_lead_id = NULL WHERE id = $1`,
            [reservation.property_id]
        );
    }

    await logAudit(user.id, reservation.lead_id, 'reservation_force_released', {
        reservation_id: resId, property_id: reservation.property_id,
        reason, released_by: user.username
    });

    try { await recalculateAndSave(reservation.lead_id, user.id); } catch (e) { }

    return res.json({ message: 'Reservation force-released. Property is now Available.' });
});

// GET /api/reservations/governance/report
router.get('/governance/report', async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'manager' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const squatters = await queryAll(`
        SELECT u.username, u.id as user_id,
               COUNT(CASE WHEN r.status = 'Expired' THEN 1 END) as expired_count,
               COUNT(CASE WHEN r.status = 'Overridden' THEN 1 END) as overridden_count,
               SUM(r.extension_count) as total_extensions
        FROM reservations r
        JOIN leads l ON r.lead_id = l.id
        JOIN users u ON l.assigned_agent = u.id
        GROUP BY u.id, u.username
        HAVING COUNT(CASE WHEN r.status = 'Expired' THEN 1 END) > 0
           OR COUNT(CASE WHEN r.status = 'Overridden' THEN 1 END) > 0
        ORDER BY COUNT(CASE WHEN r.status = 'Expired' THEN 1 END) DESC
    `);

    const heatmap = await queryAll(`
        SELECT p.id, p.property_name, p.property_type, p.city, p.price_inr,
               p.availability_status, p.current_priority_lead_id,
               l.name as priority_lead_name,
               COUNT(r.id) as active_reservation_count,
               MAX(CASE WHEN r.rofr_challenge_by IS NOT NULL THEN 1 ELSE 0 END) as under_rofr
        FROM properties p
        LEFT JOIN reservations r ON p.id = r.property_id AND r.status = 'Active'
        LEFT JOIN leads l ON p.current_priority_lead_id = l.id
        WHERE p.availability_status IN ('Reserved', 'Cooling-Off')
           OR r.rofr_challenge_by IS NOT NULL
        GROUP BY p.id, p.property_name, p.property_type, p.city, p.price_inr,
                 p.availability_status, p.current_priority_lead_id, l.name
        ORDER BY COUNT(r.id) DESC
    `);

    const coolingOff = await queryAll(`
        SELECT p.id, p.property_name, p.city, p.availability_status,
               b.lead_id as original_buyer_lead_id, l.name as original_buyer_name,
               b.booking_date
        FROM properties p
        JOIN bookings b ON p.id = b.property_id
        JOIN leads l ON b.lead_id = l.id
        WHERE p.availability_status = 'Cooling-Off'
        ORDER BY b.booking_date DESC
    `);

    return res.json({ squatting_report: squatters, inventory_heatmap: heatmap, reversal_log: coolingOff });
});

module.exports = router;
