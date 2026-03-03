const express = require('express');
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const isAdminOrManager = require('../middleware/isAdminOrManager');

const router = express.Router();

// GET /api/properties
router.get('/', isAuthenticated, async (req, res) => {
    const { type, city, available } = req.query;
    let sql = `SELECT properties.*, users.username as added_by_name
      FROM properties LEFT JOIN users ON properties.added_by = users.id WHERE 1=1`;
    const params = [];
    let paramIdx = 1;
    if (type) { sql += ` AND properties.property_type = $${paramIdx}`; params.push(type); paramIdx++; }
    if (city) { sql += ` AND properties.city = $${paramIdx}`; params.push(city); paramIdx++; }
    if (available !== undefined && available !== '') { sql += ` AND properties.is_available = $${paramIdx}`; params.push(parseInt(available)); paramIdx++; }
    sql += ' ORDER BY properties.created_at DESC';
    const properties = await queryAll(sql, params);
    return res.json(properties);
});

// GET /api/properties/sold
router.get('/sold', isAuthenticated, async (req, res) => {
    const properties = await queryAll(
        `SELECT properties.*, users.username as added_by_name
         FROM properties LEFT JOIN users ON properties.added_by = users.id
         WHERE properties.is_available = 0
         ORDER BY properties.updated_at DESC`
    );
    return res.json(properties);
});

// POST /api/properties
router.post('/', isAuthenticated, isAdminOrManager,
    body('property_name').notEmpty().isLength({ min: 2, max: 100 })
        .withMessage('Property name is required (2–100 characters)'),
    body('property_type').isIn(['Flat', 'Villa', 'Plot'])
        .withMessage('Property type must be Flat, Villa, or Plot'),
    body('location').notEmpty().withMessage('Location is required'),
    body('area').notEmpty().isLength({ min: 2 }).withMessage('Area is required (min 2 characters)'),
    body('city').notEmpty().withMessage('City is required'),
    body('state').notEmpty().withMessage('State is required'),
    body('price_inr').isFloat({ min: 100000 }).withMessage('Enter a valid price (minimum ₹1 Lakh)'),
    body('size_sqft').isFloat({ min: 1 }).withMessage('Enter a valid size in square feet'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const { property_name, property_type, location, area, city, state,
            country, price_inr, size_sqft, description, extra_details } = req.body;

        const result = await runStmt(
            `INSERT INTO properties (property_name, property_type, location, area, city, state,
             country, price_inr, size_sqft, description, extra_details, is_available, added_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12)`,
            [property_name, property_type, location, area, city, state,
                country || 'India', price_inr, size_sqft, description || null,
                extra_details || null,
                req.session.user.id]
        );
        const newProperty = await queryOne('SELECT * FROM properties WHERE id = $1', [result.lastInsertRowid]);
        return res.status(201).json({ property: newProperty });
    }
);

// GET /api/properties/:id — with Reverse Matching leads
router.get('/:id', isAuthenticated, async (req, res) => {
    const property = await queryOne(`SELECT properties.*, users.username as added_by_name
      FROM properties LEFT JOIN users ON properties.added_by = users.id
      WHERE properties.id = $1`, [parseInt(req.params.id)]);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    const matchingLeads = await queryAll(
        `SELECT id, name, phone, email, preferred_property_type, preferred_state,
                preferred_city, preferred_area, budget_range, ml_status, status, extra_details
         FROM leads
         WHERE preferred_property_type = $1
           AND status NOT IN ('Not Interested', 'Booking Confirmed')
         ORDER BY score DESC`,
        [property.property_type]
    );

    return res.json({ property, matchingLeads });
});

// PUT /api/properties/:id
router.put('/:id', isAuthenticated, isAdminOrManager,
    body('property_name').optional().isLength({ min: 2, max: 100 })
        .withMessage('Property name must be 2–100 characters'),
    body('property_type').optional().isIn(['Flat', 'Villa', 'Plot'])
        .withMessage('Property type must be Flat, Villa, or Plot'),
    body('price_inr').optional().isFloat({ min: 100000 })
        .withMessage('Enter a valid price (minimum ₹1 Lakh)'),
    body('size_sqft').optional().isFloat({ min: 1 })
        .withMessage('Enter a valid size in square feet'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const propertyId = parseInt(req.params.id);
        const existing = await queryOne('SELECT * FROM properties WHERE id = $1', [propertyId]);
        if (!existing) return res.status(404).json({ error: 'Property not found' });

        const { property_name, property_type, location, area, city, state,
            country, price_inr, size_sqft, description, is_available, extra_details } = req.body;

        await runStmt(
            `UPDATE properties SET
             property_name = COALESCE($1, property_name),
             property_type = COALESCE($2, property_type),
             location = COALESCE($3, location),
             area = COALESCE($4, area),
             city = COALESCE($5, city),
             state = COALESCE($6, state),
             country = COALESCE($7, country),
             price_inr = COALESCE($8, price_inr),
             size_sqft = COALESCE($9, size_sqft),
             description = COALESCE($10, description),
             extra_details = COALESCE($11, extra_details),
             is_available = COALESCE($12, is_available),
             updated_at = NOW()
           WHERE id = $13`,
            [property_name || null, property_type || null, location || null,
            area || null, city || null, state || null, country || null,
            price_inr || null, size_sqft || null, description || null,
            extra_details || null,
            is_available !== undefined ? is_available : null, propertyId]
        );
        const updated = await queryOne('SELECT * FROM properties WHERE id = $1', [propertyId]);
        return res.json({ property: updated });
    }
);

// DELETE /api/properties/:id
router.delete('/:id', isAuthenticated, isAdminOrManager, async (req, res) => {
    const propertyId = parseInt(req.params.id);
    const existing = await queryOne('SELECT * FROM properties WHERE id = $1', [propertyId]);
    if (!existing) return res.status(404).json({ error: 'Property not found' });
    await runStmt('UPDATE leads SET matched_property_id = NULL WHERE matched_property_id = $1', [propertyId]);
    await runStmt('DELETE FROM properties WHERE id = $1', [propertyId]);
    return res.json({ message: 'Property deleted' });
});

module.exports = router;
