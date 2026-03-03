const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');

router.use(isAuthenticated);

// ─────────────────────────────────────────────────────────────
// GET /api/negotiations/:leadId — All negotiations for a lead
// ─────────────────────────────────────────────────────────────
router.get('/:leadId', (req, res) => {
    const leadId = parseInt(req.params.leadId);
    const negotiations = queryAll(`
        SELECT n.*, p.property_name, p.property_type, p.price_inr, p.city, p.state,
               p.is_available, p.size_sqft, p.negotiation_count
        FROM negotiations n
        JOIN properties p ON n.property_id = p.id
        WHERE n.lead_id = ?
        ORDER BY n.created_at DESC
    `, [leadId]);

    const bookings = queryAll(`
        SELECT b.*, p.property_name, p.property_type, p.price_inr, p.city
        FROM bookings b
        JOIN properties p ON b.property_id = p.id
        WHERE b.lead_id = ?
        ORDER BY b.booking_date DESC
    `, [leadId]);

    return res.json({ negotiations, bookings });
});

// ─────────────────────────────────────────────────────────────
// GET /api/negotiations/property/:propertyId — Competition data
// ─────────────────────────────────────────────────────────────
router.get('/property/:propertyId', (req, res) => {
    const propertyId = parseInt(req.params.propertyId);
    const count = queryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE property_id = ? AND status = 'Active'`,
        [propertyId]
    );
    const leads = queryAll(`
        SELECT n.id, n.lead_id, l.name as lead_name, n.offered_price, n.created_at
        FROM negotiations n JOIN leads l ON n.lead_id = l.id
        WHERE n.property_id = ? AND n.status = 'Active'
        ORDER BY n.offered_price DESC
    `, [propertyId]);

    return res.json({ competition_count: count?.cnt || 0, active_negotiations: leads });
});

// ─────────────────────────────────────────────────────────────
// POST /api/negotiations — Create a new negotiation
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
    const { lead_id, property_id, offered_price, agent_notes } = req.body;
    const user = req.session.user;

    if (!lead_id || !property_id) {
        return res.status(400).json({ error: 'lead_id and property_id are required' });
    }

    // Verify property exists and is available
    const property = queryOne('SELECT * FROM properties WHERE id = ?', [property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    if (!property.is_available) return res.status(409).json({ error: 'Property is no longer available' });

    // Check for duplicate active negotiation
    const existing = queryOne(
        `SELECT id FROM negotiations WHERE lead_id = ? AND property_id = ? AND status = 'Active'`,
        [lead_id, property_id]
    );
    if (existing) return res.status(409).json({ error: 'Active negotiation already exists for this property' });

    const result = runStmt(
        `INSERT INTO negotiations (lead_id, property_id, offered_price, agent_notes)
         VALUES (?, ?, ?, ?)`,
        [lead_id, property_id, offered_price || 0, agent_notes || '']
    );

    // Update property negotiation count
    runStmt(
        `UPDATE properties SET negotiation_count = (
            SELECT COUNT(*) FROM negotiations WHERE property_id = ? AND status = 'Active'
        ) WHERE id = ?`,
        [property_id, property_id]
    );

    logAudit(runStmt, user.id, lead_id, 'negotiation_created', {
        negotiation_id: result.lastInsertRowid,
        property_id, property_name: property.property_name,
        offered_price: offered_price || 0
    });

    // Recalculate score (negotiation adds points)
    recalculateAndSave(lead_id, queryOne, runStmt, user.id);

    return res.status(201).json({
        id: result.lastInsertRowid,
        message: 'Negotiation created'
    });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/negotiations/:id — Update price or notes
// ─────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
    const negId = parseInt(req.params.id);
    const { offered_price, agent_notes } = req.body;
    const user = req.session.user;

    const neg = queryOne('SELECT * FROM negotiations WHERE id = ?', [negId]);
    if (!neg) return res.status(404).json({ error: 'Negotiation not found' });
    if (neg.status !== 'Active') return res.status(400).json({ error: 'Cannot update a closed negotiation' });

    runStmt(
        `UPDATE negotiations SET offered_price = ?, agent_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [offered_price ?? neg.offered_price, agent_notes ?? neg.agent_notes, negId]
    );

    logAudit(runStmt, user.id, neg.lead_id, 'negotiation_updated', {
        negotiation_id: negId, offered_price, agent_notes
    });

    return res.json({ message: 'Negotiation updated' });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/negotiations/:id/reject — Reject a negotiation
// ─────────────────────────────────────────────────────────────
router.put('/:id/reject', (req, res) => {
    const negId = parseInt(req.params.id);
    const user = req.session.user;

    const neg = queryOne('SELECT * FROM negotiations WHERE id = ?', [negId]);
    if (!neg) return res.status(404).json({ error: 'Negotiation not found' });
    if (neg.status !== 'Active') return res.status(400).json({ error: 'Negotiation already closed' });

    runStmt(
        `UPDATE negotiations SET status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [negId]
    );

    // Update property negotiation count
    runStmt(
        `UPDATE properties SET negotiation_count = (
            SELECT COUNT(*) FROM negotiations WHERE property_id = ? AND status = 'Active'
        ) WHERE id = ?`,
        [neg.property_id, neg.property_id]
    );

    logAudit(runStmt, user.id, neg.lead_id, 'negotiation_rejected', {
        negotiation_id: negId, property_id: neg.property_id
    });

    recalculateAndSave(neg.lead_id, queryOne, runStmt, user.id);

    return res.json({ message: 'Negotiation rejected' });
});

// ─────────────────────────────────────────────────────────────
// POST /api/negotiations/:id/book — DOMINO BOOKING HANDSHAKE
// ─────────────────────────────────────────────────────────────
router.post('/:id/book', (req, res) => {
    const negId = parseInt(req.params.id);
    const user = req.session.user;

    // RBAC: Only agent, manager, admin can book
    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot confirm bookings' });
    }

    const neg = queryOne('SELECT * FROM negotiations WHERE id = ?', [negId]);
    if (!neg) return res.status(404).json({ error: 'Negotiation not found' });
    if (neg.status !== 'Active') return res.status(400).json({ error: 'Negotiation is not active' });

    const property = queryOne('SELECT * FROM properties WHERE id = ?', [neg.property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    if (property.availability_status === 'Sold' || !property.is_available) {
        return res.status(409).json({ error: 'Property already sold' });
    }

    // If Reserved by another lead, check if booking lead has ROFR clearance
    if (property.availability_status === 'Reserved' && property.current_priority_lead_id &&
        property.current_priority_lead_id !== neg.lead_id) {
        return res.status(409).json({
            error: 'Property is Reserved by another lead. Use "Challenge Reservation" first.',
            current_priority_lead_id: property.current_priority_lead_id
        });
    }

    const finalPrice = neg.offered_price || property.price_inr;

    // ═══ ATOMIC DOMINO TRANSACTION ═══

    // 1. Create booking record
    const bookResult = runStmt(
        `INSERT INTO bookings (lead_id, property_id, negotiation_id, final_price, agent_id)
         VALUES (?, ?, ?, ?, ?)`,
        [neg.lead_id, neg.property_id, negId, finalPrice, user.id]
    );

    // 2. Convert this negotiation
    runStmt(
        `UPDATE negotiations SET status = 'Converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [negId]
    );

    // 3. Mark property as SOLD (both legacy and new columns)
    runStmt(
        `UPDATE properties SET is_available = 0, negotiation_count = 0,
         availability_status = 'Sold', current_priority_lead_id = NULL WHERE id = ?`,
        [neg.property_id]
    );

    // 3b. Override ALL active reservations for this property
    const expiredReservations = queryAll(
        `SELECT id, lead_id FROM reservations WHERE property_id = ? AND status = 'Active'`,
        [neg.property_id]
    );
    for (const res_row of expiredReservations) {
        runStmt(`UPDATE reservations SET status = 'Overridden', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [res_row.id]);
        logAudit(runStmt, user.id, res_row.lead_id, 'reservation_overridden_by_sale', {
            reservation_id: res_row.id, property_id: neg.property_id,
            sold_to_lead: neg.lead_id
        });
    }

    // 4. THE DOMINO EFFECT: Auto-reject ALL other negotiations for this property
    const othersAffected = queryAll(
        `SELECT n.id, n.lead_id, l.name as lead_name
         FROM negotiations n JOIN leads l ON n.lead_id = l.id
         WHERE n.property_id = ? AND n.id != ? AND n.status = 'Active'`,
        [neg.property_id, negId]
    );

    for (const other of othersAffected) {
        runStmt(
            `UPDATE negotiations SET status = 'Rejected - Property Sold', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [other.id]
        );
        logAudit(runStmt, user.id, other.lead_id, 'negotiation_auto_rejected', {
            negotiation_id: other.id,
            property_id: neg.property_id,
            property_name: property.property_name,
            reason: `Property sold to Lead #${neg.lead_id} by ${user.username}`
        });
        // Recalculate affected lead's score
        recalculateAndSave(other.lead_id, queryOne, runStmt, user.id);
    }

    // 5. Determine lead status
    const remainingActive = queryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE lead_id = ? AND status = 'Active'`,
        [neg.lead_id]
    );
    const totalBookings = queryOne(
        `SELECT COUNT(*) as cnt FROM bookings WHERE lead_id = ?`,
        [neg.lead_id]
    );

    let newLeadStatus = 'Booking Confirmed';
    if (remainingActive && remainingActive.cnt > 0) {
        newLeadStatus = 'Partially Booked';
    }

    runStmt('UPDATE leads SET status = ? WHERE id = ?', [newLeadStatus, neg.lead_id]);

    // 6. Check investor status
    if (totalBookings && totalBookings.cnt > 1) {
        runStmt('UPDATE leads SET is_investor = 1 WHERE id = ?', [neg.lead_id]);
    }

    // 7. Audit log for booking
    logAudit(runStmt, user.id, neg.lead_id, 'booking_confirmed', {
        booking_id: bookResult.lastInsertRowid,
        negotiation_id: negId,
        property_id: neg.property_id,
        property_name: property.property_name,
        final_price: finalPrice,
        domino_affected: othersAffected.length
    });

    // 8. Recalculate buyer's score
    recalculateAndSave(neg.lead_id, queryOne, runStmt, user.id);

    return res.json({
        message: 'Booking confirmed!',
        booking_id: bookResult.lastInsertRowid,
        lead_status: newLeadStatus,
        is_investor: totalBookings && totalBookings.cnt > 1,
        domino_affected: othersAffected.length,
        affected_leads: othersAffected.map(o => ({ id: o.lead_id, name: o.lead_name }))
    });
});

// ─────────────────────────────────────────────────────────────
// GET /api/negotiations/analytics/hot-sellers — Properties with >3 active negotiations
// ─────────────────────────────────────────────────────────────
router.get('/analytics/hot-sellers', (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'manager') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const hotSellers = queryAll(`
        SELECT p.id, p.property_name, p.property_type, p.city, p.price_inr,
               COUNT(n.id) as active_negotiations,
               SUM(n.offered_price) as total_offered
        FROM properties p
        JOIN negotiations n ON p.id = n.property_id AND n.status = 'Active'
        GROUP BY p.id
        HAVING active_negotiations >= 3
        ORDER BY active_negotiations DESC
    `);

    const totalRevenue = queryOne(`
        SELECT SUM(offered_price) as total FROM negotiations WHERE status = 'Active'
    `);

    return res.json({
        hot_sellers: hotSellers,
        revenue_forecast: totalRevenue?.total || 0
    });
});

module.exports = router;
