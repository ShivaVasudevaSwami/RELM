const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');

router.use(isAuthenticated);

// GET /api/negotiations/:leadId
router.get('/:leadId', async (req, res) => {
    const leadId = parseInt(req.params.leadId);
    const negotiations = await queryAll(`
        SELECT n.*, p.property_name, p.property_type, p.price_inr, p.city, p.state,
               p.is_available, p.size_sqft, p.negotiation_count
        FROM negotiations n
        JOIN properties p ON n.property_id = p.id
        WHERE n.lead_id = $1
        ORDER BY n.created_at DESC
    `, [leadId]);

    const bookings = await queryAll(`
        SELECT b.*, p.property_name, p.property_type, p.price_inr, p.city
        FROM bookings b
        JOIN properties p ON b.property_id = p.id
        WHERE b.lead_id = $1
        ORDER BY b.booking_date DESC
    `, [leadId]);

    return res.json({ negotiations, bookings });
});

// GET /api/negotiations/property/:propertyId
router.get('/property/:propertyId', async (req, res) => {
    const propertyId = parseInt(req.params.propertyId);
    const count = await queryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE property_id = $1 AND status = 'Active'`,
        [propertyId]
    );
    const leads = await queryAll(`
        SELECT n.id, n.lead_id, l.name as lead_name, n.offered_price, n.created_at
        FROM negotiations n JOIN leads l ON n.lead_id = l.id
        WHERE n.property_id = $1 AND n.status = 'Active'
        ORDER BY n.offered_price DESC
    `, [propertyId]);

    return res.json({ competition_count: parseInt(count?.cnt) || 0, active_negotiations: leads });
});

// POST /api/negotiations
router.post('/', async (req, res) => {
    const { lead_id, property_id, offered_price, agent_notes } = req.body;
    const user = req.session.user;

    if (!lead_id || !property_id) {
        return res.status(400).json({ error: 'lead_id and property_id are required' });
    }

    const property = await queryOne('SELECT * FROM properties WHERE id = $1', [property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    if (!property.is_available) return res.status(409).json({ error: 'Property is no longer available' });

    const existing = await queryOne(
        `SELECT id FROM negotiations WHERE lead_id = $1 AND property_id = $2 AND status = 'Active'`,
        [lead_id, property_id]
    );
    if (existing) return res.status(409).json({ error: 'Active negotiation already exists for this property' });

    const result = await runStmt(
        `INSERT INTO negotiations (lead_id, property_id, offered_price, agent_notes)
         VALUES ($1, $2, $3, $4)`,
        [lead_id, property_id, offered_price || 0, agent_notes || '']
    );

    await runStmt(
        `UPDATE properties SET negotiation_count = (
            SELECT COUNT(*) FROM negotiations WHERE property_id = $1 AND status = 'Active'
        ) WHERE id = $2`,
        [property_id, property_id]
    );

    await logAudit(user.id, lead_id, 'negotiation_created', {
        negotiation_id: result.lastInsertRowid,
        property_id, property_name: property.property_name,
        offered_price: offered_price || 0
    });

    try { await recalculateAndSave(lead_id, user.id); } catch (e) { }

    return res.status(201).json({
        id: result.lastInsertRowid,
        message: 'Negotiation created'
    });
});

// PUT /api/negotiations/:id
router.put('/:id', async (req, res) => {
    const negId = parseInt(req.params.id);
    const { offered_price, agent_notes } = req.body;
    const user = req.session.user;

    const neg = await queryOne('SELECT * FROM negotiations WHERE id = $1', [negId]);
    if (!neg) return res.status(404).json({ error: 'Negotiation not found' });
    if (neg.status !== 'Active') return res.status(400).json({ error: 'Cannot update a closed negotiation' });

    await runStmt(
        `UPDATE negotiations SET offered_price = $1, agent_notes = $2, updated_at = NOW() WHERE id = $3`,
        [offered_price ?? neg.offered_price, agent_notes ?? neg.agent_notes, negId]
    );

    await logAudit(user.id, neg.lead_id, 'negotiation_updated', {
        negotiation_id: negId, offered_price, agent_notes
    });

    return res.json({ message: 'Negotiation updated' });
});

// PUT /api/negotiations/:id/reject
router.put('/:id/reject', async (req, res) => {
    const negId = parseInt(req.params.id);
    const user = req.session.user;

    const neg = await queryOne('SELECT * FROM negotiations WHERE id = $1', [negId]);
    if (!neg) return res.status(404).json({ error: 'Negotiation not found' });
    if (neg.status !== 'Active') return res.status(400).json({ error: 'Negotiation already closed' });

    await runStmt(
        `UPDATE negotiations SET status = 'Rejected', updated_at = NOW() WHERE id = $1`,
        [negId]
    );

    await runStmt(
        `UPDATE properties SET negotiation_count = (
            SELECT COUNT(*) FROM negotiations WHERE property_id = $1 AND status = 'Active'
        ) WHERE id = $2`,
        [neg.property_id, neg.property_id]
    );

    await logAudit(user.id, neg.lead_id, 'negotiation_rejected', {
        negotiation_id: negId, property_id: neg.property_id
    });

    try { await recalculateAndSave(neg.lead_id, user.id); } catch (e) { }

    return res.json({ message: 'Negotiation rejected' });
});

// POST /api/negotiations/:id/book — DOMINO BOOKING HANDSHAKE
router.post('/:id/book', async (req, res) => {
    const negId = parseInt(req.params.id);
    const user = req.session.user;

    if (user.role === 'telecaller') {
        return res.status(403).json({ error: 'Telecallers cannot confirm bookings' });
    }

    const neg = await queryOne('SELECT * FROM negotiations WHERE id = $1', [negId]);
    if (!neg) return res.status(404).json({ error: 'Negotiation not found' });
    if (neg.status !== 'Active') return res.status(400).json({ error: 'Negotiation is not active' });

    const property = await queryOne('SELECT * FROM properties WHERE id = $1', [neg.property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    if (property.availability_status === 'Sold' || !property.is_available) {
        return res.status(409).json({ error: 'Property already sold' });
    }

    if (property.availability_status === 'Reserved' && property.current_priority_lead_id &&
        property.current_priority_lead_id !== neg.lead_id) {
        return res.status(409).json({
            error: 'Property is Reserved by another lead. Use "Challenge Reservation" first.',
            current_priority_lead_id: property.current_priority_lead_id
        });
    }

    const finalPrice = neg.offered_price || property.price_inr;

    // 1. Create booking record
    const bookResult = await runStmt(
        `INSERT INTO bookings (lead_id, property_id, negotiation_id, final_price, agent_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [neg.lead_id, neg.property_id, negId, finalPrice, user.id]
    );

    // 2. Convert this negotiation
    await runStmt(
        `UPDATE negotiations SET status = 'Converted', updated_at = NOW() WHERE id = $1`,
        [negId]
    );

    // 3. Mark property as SOLD
    await runStmt(
        `UPDATE properties SET is_available = 0, negotiation_count = 0,
         availability_status = 'Sold', current_priority_lead_id = NULL WHERE id = $1`,
        [neg.property_id]
    );

    // 3b. Override ALL active reservations for this property
    const expiredReservations = await queryAll(
        `SELECT id, lead_id FROM reservations WHERE property_id = $1 AND status = 'Active'`,
        [neg.property_id]
    );
    for (const res_row of expiredReservations) {
        await runStmt(`UPDATE reservations SET status = 'Overridden', updated_at = NOW() WHERE id = $1`, [res_row.id]);
        await logAudit(user.id, res_row.lead_id, 'reservation_overridden_by_sale', {
            reservation_id: res_row.id, property_id: neg.property_id,
            sold_to_lead: neg.lead_id
        });
    }

    // 4. THE DOMINO EFFECT: Auto-reject ALL other negotiations for this property
    const othersAffected = await queryAll(
        `SELECT n.id, n.lead_id, l.name as lead_name
         FROM negotiations n JOIN leads l ON n.lead_id = l.id
         WHERE n.property_id = $1 AND n.id != $2 AND n.status = 'Active'`,
        [neg.property_id, negId]
    );

    for (const other of othersAffected) {
        await runStmt(
            `UPDATE negotiations SET status = 'Rejected - Property Sold', updated_at = NOW() WHERE id = $1`,
            [other.id]
        );
        await logAudit(user.id, other.lead_id, 'negotiation_auto_rejected', {
            negotiation_id: other.id,
            property_id: neg.property_id,
            property_name: property.property_name,
            reason: `Property sold to Lead #${neg.lead_id} by ${user.username}`
        });
        try { await recalculateAndSave(other.lead_id, user.id); } catch (e) { }
    }

    // 5. Determine lead status
    const remainingActive = await queryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE lead_id = $1 AND status = 'Active'`,
        [neg.lead_id]
    );
    const totalBookings = await queryOne(
        `SELECT COUNT(*) as cnt FROM bookings WHERE lead_id = $1`,
        [neg.lead_id]
    );

    let newLeadStatus = 'Booking Confirmed';
    if (remainingActive && parseInt(remainingActive.cnt) > 0) {
        newLeadStatus = 'Partially Booked';
    }

    await runStmt('UPDATE leads SET status = $1 WHERE id = $2', [newLeadStatus, neg.lead_id]);

    // 6. Check investor status
    if (totalBookings && parseInt(totalBookings.cnt) > 1) {
        await runStmt('UPDATE leads SET is_investor = 1 WHERE id = $1', [neg.lead_id]);
    }

    // 7. Audit log for booking
    await logAudit(user.id, neg.lead_id, 'booking_confirmed', {
        booking_id: bookResult.lastInsertRowid,
        negotiation_id: negId,
        property_id: neg.property_id,
        property_name: property.property_name,
        final_price: finalPrice,
        domino_affected: othersAffected.length
    });

    // 8. Recalculate buyer's score
    try { await recalculateAndSave(neg.lead_id, user.id); } catch (e) { }

    return res.json({
        message: 'Booking confirmed!',
        booking_id: bookResult.lastInsertRowid,
        lead_status: newLeadStatus,
        is_investor: totalBookings && parseInt(totalBookings.cnt) > 1,
        domino_affected: othersAffected.length,
        affected_leads: othersAffected.map(o => ({ id: o.lead_id, name: o.lead_name }))
    });
});

// GET /api/negotiations/analytics/hot-sellers
router.get('/analytics/hot-sellers', async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'manager') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const hotSellers = await queryAll(`
        SELECT p.id, p.property_name, p.property_type, p.city, p.price_inr,
               COUNT(n.id) as active_negotiations,
               SUM(n.offered_price) as total_offered
        FROM properties p
        JOIN negotiations n ON p.id = n.property_id AND n.status = 'Active'
        GROUP BY p.id, p.property_name, p.property_type, p.city, p.price_inr
        HAVING COUNT(n.id) >= 3
        ORDER BY COUNT(n.id) DESC
    `);

    const totalRevenue = await queryOne(`
        SELECT SUM(offered_price) as total FROM negotiations WHERE status = 'Active'
    `);

    return res.json({
        hot_sellers: hotSellers,
        revenue_forecast: parseInt(totalRevenue?.total) || 0
    });
});

module.exports = router;
