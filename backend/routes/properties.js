const express = require('express');
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const isAdminOrManager = require('../middleware/isAdminOrManager');

const router = express.Router();

// GET /api/properties
router.get('/', isAuthenticated, (req, res) => {
    const { type, city, available } = req.query;
    let sql = `SELECT properties.*, users.username as added_by_name
      FROM properties LEFT JOIN users ON properties.added_by = users.id WHERE 1=1`;
    const params = [];
    if (type) { sql += ' AND properties.property_type = ?'; params.push(type); }
    if (city) { sql += ' AND properties.city = ?'; params.push(city); }
    if (available !== undefined && available !== '') { sql += ' AND properties.is_available = ?'; params.push(parseInt(available)); }
    sql += ' ORDER BY properties.created_at DESC';
    return res.json(queryAll(sql, params));
});

// GET /api/properties/sold — returns only sold/unavailable properties
router.get('/sold', isAuthenticated, (req, res) => {
    const properties = queryAll(
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
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const { property_name, property_type, location, area, city, state,
            country, price_inr, size_sqft, description, extra_details } = req.body;

        const result = runStmt(
            `INSERT INTO properties (property_name, property_type, location, area, city, state,
             country, price_inr, size_sqft, description, extra_details, is_available, added_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [property_name, property_type, location, area, city, state,
                country || 'India', price_inr, size_sqft, description || null,
                extra_details || null,
                req.session.user.id]
        );
        const newProperty = queryOne('SELECT * FROM properties WHERE id = ?', [result.lastInsertRowid]);
        return res.status(201).json({ property: newProperty });
    }
);

// GET /api/properties/:id — with Reverse Matching leads
router.get('/:id', isAuthenticated, (req, res) => {
    const property = queryOne(`SELECT properties.*, users.username as added_by_name
      FROM properties LEFT JOIN users ON properties.added_by = users.id
      WHERE properties.id = ?`, [parseInt(req.params.id)]);
    if (!property) return res.status(404).json({ error: 'Property not found' });

    // Reverse Match: Find active leads whose preferred_property_type matches
    const matchingLeads = queryAll(
        `SELECT id, name, phone, email, preferred_property_type, preferred_state,
                preferred_city, preferred_area, budget_range, ml_status, status, extra_details
         FROM leads
         WHERE preferred_property_type = ?
           AND status NOT IN ('Not Interested', 'Booking Confirmed')
         ORDER BY score DESC`,
        [property.property_type]
    );

    return res.json({ property, matchingLeads });
});

// PUT /api/properties/:id — supports is_available toggle + full field update
router.put('/:id', isAuthenticated, isAdminOrManager,
    body('property_name').optional().isLength({ min: 2, max: 100 })
        .withMessage('Property name must be 2–100 characters'),
    body('property_type').optional().isIn(['Flat', 'Villa', 'Plot'])
        .withMessage('Property type must be Flat, Villa, or Plot'),
    body('price_inr').optional().isFloat({ min: 100000 })
        .withMessage('Enter a valid price (minimum ₹1 Lakh)'),
    body('size_sqft').optional().isFloat({ min: 1 })
        .withMessage('Enter a valid size in square feet'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const propertyId = parseInt(req.params.id);
        const existing = queryOne('SELECT * FROM properties WHERE id = ?', [propertyId]);
        if (!existing) return res.status(404).json({ error: 'Property not found' });

        const { property_name, property_type, location, area, city, state,
            country, price_inr, size_sqft, description, is_available, extra_details } = req.body;

        runStmt(
            `UPDATE properties SET
             property_name = COALESCE(?, property_name),
             property_type = COALESCE(?, property_type),
             location = COALESCE(?, location),
             area = COALESCE(?, area),
             city = COALESCE(?, city),
             state = COALESCE(?, state),
             country = COALESCE(?, country),
             price_inr = COALESCE(?, price_inr),
             size_sqft = COALESCE(?, size_sqft),
             description = COALESCE(?, description),
             extra_details = COALESCE(?, extra_details),
             is_available = COALESCE(?, is_available),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
            [property_name || null, property_type || null, location || null,
            area || null, city || null, state || null, country || null,
            price_inr || null, size_sqft || null, description || null,
            extra_details || null,
            is_available !== undefined ? is_available : null, propertyId]
        );
        const updated = queryOne('SELECT * FROM properties WHERE id = ?', [propertyId]);
        return res.json({ property: updated });
    }
);

// DELETE /api/properties/:id
router.delete('/:id', isAuthenticated, isAdminOrManager, (req, res) => {
    const propertyId = parseInt(req.params.id);
    const existing = queryOne('SELECT * FROM properties WHERE id = ?', [propertyId]);
    if (!existing) return res.status(404).json({ error: 'Property not found' });
    runStmt('UPDATE leads SET matched_property_id = NULL WHERE matched_property_id = ?', [propertyId]);
    runStmt('DELETE FROM properties WHERE id = ?', [propertyId]);
    return res.json({ message: 'Property deleted' });
});

module.exports = router;
