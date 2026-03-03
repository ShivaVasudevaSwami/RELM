const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const isAdminOrManager = require('../middleware/isAdminOrManager');
const { recalculateAndSave } = require('../services/scoringEngine');

const generateToken = () => crypto.randomBytes(24).toString('hex');

// ── Round-Robin: find the telecaller with fewest active leads ──
const getNextTelecaller = () => {
    try {
        const telecaller = queryOne(
            `SELECT u.id FROM users u
             LEFT JOIN leads l ON l.assigned_telecaller = u.id
                AND l.status NOT IN ('Not Interested', 'Booking Confirmed')
             WHERE u.role = 'Telecaller'
             GROUP BY u.id
             ORDER BY COUNT(l.id) ASC
             LIMIT 1`
        );
        return telecaller ? telecaller.id : null;
    } catch { return null; }
};

// ── Build extra_details JSON from incoming form fields ──
const buildExtraDetails = (propType, bhkConfig) => {
    if (!propType || !bhkConfig) return null;

    if (propType === 'Flat') {
        return JSON.stringify({ bhk_config: bhkConfig, floor_pref: '', furnishing: '' });
    }
    if (propType === 'Villa') {
        return JSON.stringify({ configuration: bhkConfig, private_garden: false, parking: 1 });
    }
    if (propType === 'Plot') {
        return JSON.stringify({ plot_size: '', zoning: bhkConfig, road_width: '' });
    }
    return null;
};

// GET /api/forms — list all connected forms
router.get('/', isAuthenticated, (req, res) => {
    try {
        const forms = queryAll(
            `SELECT f.*, u.username as added_by_username
             FROM forms_config f
             LEFT JOIN users u ON f.added_by = u.id
             ORDER BY f.created_at DESC`
        );
        const parsed = forms.map(f => ({
            ...f,
            field_mapping: (() => { try { return JSON.parse(f.field_mapping || '{}'); } catch { return {}; } })(),
            webhook_url: `http://localhost:3001/api/forms/webhook/${f.webhook_token}`
        }));
        return res.json(parsed);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/forms — add new form connection
router.post('/', isAuthenticated, isAdminOrManager, (req, res) => {
    try {
        const { form_name, field_mapping } = req.body;
        if (!form_name || form_name.trim().length < 2)
            return res.status(400).json({ error: 'Form name is required (min 2 chars)' });

        const token = generateToken();
        const mapping = field_mapping || {
            name: 'Full Name',
            phone: 'Phone Number',
            email: 'Email',
            occupation: 'Occupation',
            purchase_purpose: 'Purchase Purpose',
            preferred_property_type: 'Property Type',
            bhk_config: 'BHK/Config Needed',
            preferred_state: 'State',
            preferred_city: 'City',
            preferred_area: 'Area/Locality',
            budget_range: 'Budget Range',
            funding_source: 'Funding Source',
            urgency: 'Timeline to Buy'
        };

        const result = runStmt(
            `INSERT INTO forms_config (form_name, webhook_token, field_mapping, added_by)
             VALUES (?, ?, ?, ?)`,
            [form_name.trim(), token, JSON.stringify(mapping), req.session.user.id]
        );

        const newForm = queryOne('SELECT * FROM forms_config WHERE id = ?', [result.lastInsertRowid]);
        return res.json({
            ...newForm,
            field_mapping: mapping,
            webhook_url: `http://localhost:3001/api/forms/webhook/${token}`
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/forms/:id — remove form connection
router.delete('/:id', isAuthenticated, isAdminOrManager, (req, res) => {
    try {
        runStmt('DELETE FROM forms_config WHERE id = ?', [parseInt(req.params.id)]);
        return res.json({ message: 'Form connection removed' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// PATCH /api/forms/:id/toggle — activate/deactivate
router.patch('/:id/toggle', isAuthenticated, isAdminOrManager, (req, res) => {
    try {
        const form = queryOne('SELECT * FROM forms_config WHERE id = ?', [parseInt(req.params.id)]);
        if (!form) return res.status(404).json({ error: 'Form not found' });

        const newStatus = form.is_active === 1 ? 0 : 1;
        runStmt('UPDATE forms_config SET is_active = ? WHERE id = ?', [newStatus, parseInt(req.params.id)]);
        return res.json({ is_active: newStatus });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/forms/webhook/:token — receives Google Form submissions (PUBLIC)
router.post('/webhook/:token', (req, res) => {
    try {
        const { token } = req.params;
        const formConfig = queryOne(
            'SELECT * FROM forms_config WHERE webhook_token = ? AND is_active = 1',
            [token]
        );
        if (!formConfig) return res.status(404).json({ error: 'Invalid or inactive webhook token' });

        let mapping;
        try { mapping = JSON.parse(formConfig.field_mapping); } catch { mapping = {}; }
        const data = req.body;

        const getValue = (fieldName) => {
            if (!fieldName) return null;
            const val = data[fieldName] || data[fieldName.toLowerCase()] || null;
            return val ? String(val).trim() : null;
        };

        const name = getValue(mapping.name);
        const phone = (getValue(mapping.phone) || '').replace(/\D/g, '');
        const email = getValue(mapping.email);
        const occupation = getValue(mapping.occupation);
        const purchasePurpose = getValue(mapping.purchase_purpose);
        const propertyType = getValue(mapping.preferred_property_type);
        const bhkConfig = getValue(mapping.bhk_config);
        const state = getValue(mapping.preferred_state);
        const city = getValue(mapping.preferred_city);
        const area = getValue(mapping.preferred_area);
        const budgetRange = getValue(mapping.budget_range);
        const funding = getValue(mapping.funding_source);
        const urgency = getValue(mapping.urgency);

        if (!name || name.length < 2)
            return res.status(400).json({ error: 'Name is required' });
        if (!phone || !/^[6-9]\d{9}$/.test(phone))
            return res.status(400).json({ error: 'Valid phone number required' });

        // Check duplicate
        const existing = queryOne(
            'SELECT id, status FROM leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
            [phone]
        );
        if (existing && existing.status !== 'Not Interested' && existing.status !== 'Booking Confirmed') {
            return res.status(409).json({
                error: 'duplicate',
                message: `Active lead already exists for phone ${phone}`,
                existing_lead_id: existing.id
            });
        }

        const VALID_TYPES = ['Flat', 'Villa', 'Plot'];
        const VALID_BUDGETS = ['20-40', '40-60', '60-80', '80-100', '1Cr+'];
        const VALID_FUNDING = ['Self-Funded', 'Home Loan'];
        const VALID_URGENCY = ['Immediate', '3 Months', '1 Year'];
        const VALID_OCCUPATIONS = ['Salaried', 'Business', 'Professional', 'Retired'];
        const VALID_PURPOSES = ['Self-Use', 'Investment'];

        const validType = VALID_TYPES.includes(propertyType) ? propertyType : null;
        const validOccupation = VALID_OCCUPATIONS.includes(occupation) ? occupation : null;
        const validPurpose = VALID_PURPOSES.includes(purchasePurpose) ? purchasePurpose : null;

        // Build extra_details from bhk_config
        const extraDetails = buildExtraDetails(validType, bhkConfig);

        // Round-Robin telecaller assignment
        const assignedTelecaller = getNextTelecaller();

        const result = runStmt(
            `INSERT INTO leads (name, phone, email,
             occupation, purchase_purpose,
             preferred_property_type,
             preferred_state, preferred_city, preferred_area,
             budget_range, funding_source, urgency,
             extra_details, assigned_telecaller,
             status, ml_status, created_by, inquiry_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New Inquiry', 'Cold', NULL, 1)`,
            [name, phone, email,
                validOccupation, validPurpose,
                validType,
                state || null, city || null, area || null,
                VALID_BUDGETS.includes(budgetRange) ? budgetRange : null,
                VALID_FUNDING.includes(funding) ? funding : null,
                VALID_URGENCY.includes(urgency) ? urgency : null,
                extraDetails,
                assignedTelecaller]
        );

        // Trigger initial scoring
        try { recalculateAndSave(result.lastInsertRowid, queryOne, runStmt, null); } catch (e) { /* non-blocking */ }

        return res.json({
            success: true,
            lead_id: result.lastInsertRowid,
            assigned_telecaller: assignedTelecaller,
            message: 'Lead created successfully'
        });
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

module.exports = router;
