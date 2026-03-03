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

// ─────────────────────────────────────────────────────────────
// GET /api/reservations/:propertyId — All reservations for a property
// ─────────────────────────────────────────────────────────────
router.get('/:propertyId', (req, res) => {
    const propertyId = parseInt(req.params.propertyId);
    const reservations = queryAll(`
        SELECT r.*, l.name as lead_name, l.phone as lead_phone,
               u.username as challenger_agent
        FROM reservations r
        JOIN leads l ON r.lead_id = l.id
        LEFT JOIN leads cl ON r.rofr_challenge_by = cl.id
        LEFT JOIN users u ON cl.assigned_agent = u.id
        WHERE r.property_id = ?
        ORDER BY r.tier ASC, r.created_at DESC
    `, [propertyId]);

    return res.json({ reservations });
});

// ─────────────────────────────────────────────────────────────
// GET /api/reservations/lead/:leadId — All reservations for a lead
// ─────────────────────────────────────────────────────────────
router.get('/lead/:leadId', (req, res) => {
    const leadId = parseInt(req.params.leadId);
    const reservations = queryAll(`
        SELECT r.*, p.property_name, p.property_type, p.city, p.price_inr,
               p.availability_status
        FROM reservations r
        JOIN properties p ON r.property_id = p.id
        WHERE r.lead_id = ? AND r.status = 'Active'
        ORDER BY r.tier ASC, r.expires_at ASC
    `, [leadId]);

    return res.json({ reservations });
});

// ─────────────────────────────────────────────────────────────
// POST /api/reservations — Create a reservation (Tier 2 or 3)
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
    const { lead_id, property_id, tier } = req.body;
    const user = req.session.user;

    // RBAC: Only agent, manager, admin can create reservations
    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot create reservations' });
    }

    if (!lead_id || !property_id || ![2, 3].includes(tier)) {
        return res.status(400).json({ error: 'lead_id, property_id, and tier (2 or 3) are required' });
    }

    // Check property exists
    const property = queryOne('SELECT * FROM properties WHERE id = ?', [property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    // Property must be Available or have only Tier-3 interests
    if (property.availability_status === 'Sold') {
        return res.status(409).json({ error: 'Property is already sold' });
    }

    // RULE 1: One-Block Limit — a lead can only have ONE active Tier-2
    if (tier === 2) {
        const existingTier2 = queryOne(
            `SELECT id, property_id FROM reservations WHERE lead_id = ? AND tier = 2 AND status = 'Active'`,
            [lead_id]
        );
        if (existingTier2) {
            return res.status(409).json({
                error: 'One-Block Limit: This lead already has an active Tier-2 reservation',
                existing_reservation_id: existingTier2.id,
                existing_property_id: existingTier2.property_id
            });
        }

        // Cannot Tier-2 reserve a property already Reserved by another lead
        if (property.availability_status === 'Reserved' && property.current_priority_lead_id !== lead_id) {
            return res.status(409).json({
                error: 'Property is already Reserved by another lead. Use "Challenge Reservation" instead.',
                current_priority_lead_id: property.current_priority_lead_id
            });
        }
    }

    // Check for duplicate active reservation for same lead+property
    const existing = queryOne(
        `SELECT id FROM reservations WHERE lead_id = ? AND property_id = ? AND status = 'Active'`,
        [lead_id, property_id]
    );
    if (existing) {
        return res.status(409).json({ error: 'Active reservation already exists for this lead on this property' });
    }

    // Calculate expiry
    const now = new Date();
    const durationMs = tier === 2 ? TIER2_DURATION_MS : TIER3_DURATION_MS;
    const expiresAt = new Date(now.getTime() + durationMs).toISOString();

    const result = runStmt(
        `INSERT INTO reservations (lead_id, property_id, tier, expires_at) VALUES (?, ?, ?, ?)`,
        [lead_id, property_id, tier, expiresAt]
    );

    // If Tier-2, update property status to Reserved
    if (tier === 2) {
        runStmt(
            `UPDATE properties SET availability_status = 'Reserved', current_priority_lead_id = ? WHERE id = ?`,
            [lead_id, property_id]
        );
    }

    logAudit(runStmt, user.id, lead_id, 'reservation_created', {
        reservation_id: result.lastInsertRowid, property_id, tier,
        property_name: property.property_name, expires_at: expiresAt
    });

    recalculateAndSave(lead_id, queryOne, runStmt, user.id);

    return res.status(201).json({
        id: result.lastInsertRowid,
        tier, expires_at: expiresAt,
        message: tier === 2 ? 'Tier-2 Soft-Block created. Property is now Reserved.' : 'Tier-3 Interest registered.'
    });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/reservations/:id/extend — Extend deadline
// ─────────────────────────────────────────────────────────────
router.put('/:id/extend', (req, res) => {
    const resId = parseInt(req.params.id);
    const { manager_comment } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot extend reservations' });
    }

    const reservation = queryOne('SELECT * FROM reservations WHERE id = ?', [resId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'Active') return res.status(400).json({ error: 'Reservation is not active' });

    // RULE 3: Renewal Cap
    if (reservation.extension_count >= 2) {
        return res.status(400).json({ error: 'Maximum extensions (2) reached. Cannot extend further.' });
    }

    // Second extension requires manager comment
    if (reservation.extension_count >= 1) {
        if (user.role !== 'manager' && user.role !== 'admin') {
            return res.status(403).json({ error: 'Second extension requires Manager/Admin approval' });
        }
        if (!manager_comment || manager_comment.trim().length < 5) {
            return res.status(400).json({ error: 'Manager comment (min 5 chars) is required for second extension' });
        }
    }

    // Extend by the tier's duration
    const durationMs = reservation.tier === 2 ? TIER2_DURATION_MS : TIER3_DURATION_MS;
    const currentExpiry = new Date(reservation.expires_at);
    const newExpiry = new Date(Math.max(currentExpiry.getTime(), Date.now()) + durationMs).toISOString();

    runStmt(
        `UPDATE reservations SET expires_at = ?, extension_count = extension_count + 1,
         manager_comment = COALESCE(?, manager_comment), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newExpiry, manager_comment || null, resId]
    );

    logAudit(runStmt, user.id, reservation.lead_id, 'reservation_extended', {
        reservation_id: resId, extension_number: reservation.extension_count + 1,
        new_expires_at: newExpiry, manager_comment: manager_comment || null
    });

    return res.json({
        message: `Reservation extended (${reservation.extension_count + 1}/2)`,
        new_expires_at: newExpiry
    });
});

// ─────────────────────────────────────────────────────────────
// POST /api/reservations/:id/challenge — ROFR Challenge
// ─────────────────────────────────────────────────────────────
router.post('/:id/challenge', (req, res) => {
    const resId = parseInt(req.params.id);
    const { challenger_lead_id } = req.body;
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot challenge reservations' });
    }

    if (!challenger_lead_id) {
        return res.status(400).json({ error: 'challenger_lead_id is required' });
    }

    const reservation = queryOne('SELECT * FROM reservations WHERE id = ?', [resId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'Active') return res.status(400).json({ error: 'Reservation is not active' });
    if (reservation.tier !== 2) return res.status(400).json({ error: 'Only Tier-2 reservations can be challenged' });
    if (reservation.lead_id === challenger_lead_id) {
        return res.status(400).json({ error: 'Cannot challenge your own reservation' });
    }

    // Already under ROFR challenge?
    if (reservation.rofr_challenge_by) {
        return res.status(409).json({ error: 'This reservation is already under ROFR challenge' });
    }

    const rofrDeadline = new Date(Date.now() + ROFR_WINDOW_MS).toISOString();

    runStmt(
        `UPDATE reservations SET rofr_challenge_by = ?, rofr_deadline = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [challenger_lead_id, rofrDeadline, resId]
    );

    logAudit(runStmt, user.id, reservation.lead_id, 'rofr_challenge_issued', {
        reservation_id: resId, challenger_lead_id,
        property_id: reservation.property_id, rofr_deadline: rofrDeadline,
        message: `ROFR Alert: A hard offer has been received. 2-hour window to complete booking.`
    });

    // +20 urgency to the challenged lead
    recalculateAndSave(reservation.lead_id, queryOne, runStmt, user.id);

    return res.json({
        message: 'ROFR Challenge issued! The reservation holder has 2 hours to complete booking.',
        rofr_deadline: rofrDeadline
    });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/reservations/:id/force-release — Manager Override
// ─────────────────────────────────────────────────────────────
router.put('/:id/force-release', (req, res) => {
    const resId = parseInt(req.params.id);
    const { reason } = req.body;
    const user = req.session.user;

    if (user.role !== 'manager' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Only Managers/Admins can force-release reservations' });
    }

    if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ error: 'A reason (min 5 chars) is required for force-release' });
    }

    const reservation = queryOne('SELECT * FROM reservations WHERE id = ?', [resId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'Active') return res.status(400).json({ error: 'Reservation is not active' });

    // Override reservation
    runStmt(
        `UPDATE reservations SET status = 'Overridden', manager_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reason, resId]
    );

    // If this was a Tier-2, release the property
    if (reservation.tier === 2) {
        runStmt(
            `UPDATE properties SET availability_status = 'Available', current_priority_lead_id = NULL WHERE id = ?`,
            [reservation.property_id]
        );
    }

    logAudit(runStmt, user.id, reservation.lead_id, 'reservation_force_released', {
        reservation_id: resId, property_id: reservation.property_id,
        reason, released_by: user.username
    });

    // Expiry penalty: -30 and recalculate
    recalculateAndSave(reservation.lead_id, queryOne, runStmt, user.id);

    return res.json({ message: 'Reservation force-released. Property is now Available.' });
});

// ─────────────────────────────────────────────────────────────
// GET /api/reservations/governance/report — Squatting + Heatmap
// ─────────────────────────────────────────────────────────────
router.get('/governance/report', (req, res) => {
    const user = req.session.user;
    if (user.role !== 'manager' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }

    // Squatting Report: agents with frequently expired reservations
    const squatters = queryAll(`
        SELECT u.username, u.id as user_id,
               COUNT(CASE WHEN r.status = 'Expired' THEN 1 END) as expired_count,
               COUNT(CASE WHEN r.status = 'Overridden' THEN 1 END) as overridden_count,
               SUM(r.extension_count) as total_extensions
        FROM reservations r
        JOIN leads l ON r.lead_id = l.id
        JOIN users u ON l.assigned_agent = u.id
        GROUP BY u.id
        HAVING expired_count > 0 OR overridden_count > 0
        ORDER BY expired_count DESC
    `);

    // Inventory Heatmap: properties under ROFR or Tier-2 blocks
    const heatmap = queryAll(`
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
        GROUP BY p.id
        ORDER BY active_reservation_count DESC
    `);

    // Reversal Log: cooling-off properties
    const coolingOff = queryAll(`
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
