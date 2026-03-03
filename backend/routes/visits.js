const express = require('express');
const { body, validationResult } = require('express-validator');
const { queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');

const router = express.Router();

router.use(isAuthenticated);

const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Site Visit Scheduled',
    'Site Visited', 'Negotiation', 'Booking Confirmed', 'Not Interested'
];

// POST /api/visits/:lead_id/schedule
router.post('/:lead_id/schedule',
    body('site_name').notEmpty().withMessage('Site name is required'),
    body('visit_date').notEmpty().withMessage('Visit date is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const lead_id = parseInt(req.params.lead_id);
        const { site_name, visit_date, property_id, assigned_agent } = req.body;
        const user = req.session.user;

        const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        if (user.role === 'telecaller' && lead.assigned_telecaller !== user.id && lead.created_by !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (user.role === 'agent' && lead.assigned_agent !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const pendingVisit = await queryOne(
            'SELECT id, site_name FROM site_visits WHERE lead_id = $1 AND post_visit_status IS NULL',
            [lead_id]
        );
        if (pendingVisit) {
            return res.status(400).json({
                error: `Cannot schedule new visit: Pending feedback required for previous visit "${pendingVisit.site_name}".`
            });
        }

        const result = await runStmt(
            'INSERT INTO site_visits (lead_id, site_name, visit_date, feedback_notes, post_visit_status, property_id) VALUES ($1, $2, $3, NULL, NULL, $4)',
            [lead_id, site_name, visit_date, property_id ? parseInt(property_id) : null]
        );

        const newVisit = await queryOne('SELECT * FROM site_visits WHERE id = $1', [result.lastInsertRowid]);

        const currentIdx = PIPELINE_ORDER.indexOf(lead.status);
        const targetIdx = PIPELINE_ORDER.indexOf('Site Visit Scheduled');
        if (currentIdx >= 0 && currentIdx < targetIdx) {
            await runStmt('UPDATE leads SET status = $1 WHERE id = $2', ['Site Visit Scheduled', lead_id]);
        }

        if (property_id) {
            await runStmt('UPDATE leads SET matched_property_id = $1 WHERE id = $2', [parseInt(property_id), lead_id]);
        }

        if (assigned_agent) {
            await runStmt('UPDATE leads SET assigned_agent = $1 WHERE id = $2', [parseInt(assigned_agent), lead_id]);
            await logAudit(user.id, lead_id, 'assignment',
                { type: 'baton_pass', assigned_agent: parseInt(assigned_agent), trigger: 'first_visit_schedule' });
        }

        const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead_id]);
        return res.json({ visit: newVisit, lead: updatedLead });
    }
);

// PUT /api/visits/:visit_id/feedback
router.put('/:visit_id/feedback',
    body('post_visit_status').notEmpty().withMessage('Post-visit status is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const visit_id = parseInt(req.params.visit_id);
        const { post_visit_status, feedback_notes, new_property_id, new_property_name } = req.body;
        const user = req.session.user;

        const visit = await queryOne('SELECT * FROM site_visits WHERE id = $1', [visit_id]);
        if (!visit) {
            return res.status(404).json({ error: 'Site visit not found' });
        }

        const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [visit.lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        if (user.role === 'agent' && lead.assigned_agent !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await runStmt(
            'UPDATE site_visits SET post_visit_status = $1, feedback_notes = $2 WHERE id = $3',
            [post_visit_status, feedback_notes || null, visit_id]
        );

        const updatedVisit = await queryOne('SELECT * FROM site_visits WHERE id = $1', [visit_id]);

        await logAudit(user.id, lead.id, 'feedback_submitted', {
            visit_id: visit_id,
            property: visit.site_name,
            status: post_visit_status,
            agent: user.username
        });

        await runStmt('UPDATE leads SET last_interaction_at = NOW() WHERE id = $1', [lead.id]);

        if (post_visit_status === 'Not Interested') {
            await runStmt('UPDATE leads SET status = $1, ml_status = $2 WHERE id = $3',
                ['Not Interested', 'Cold', lead.id]);
            await logAudit(user.id, lead.id, 'status_change',
                { from: lead.status, to: 'Not Interested', trigger: 'visit_not_interested' });
            const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead.id]);
            return res.json({ visit: updatedVisit, lead: updatedLead, new_ml_status: 'Cold' });
        }

        // Visit Loop: "Want Another Property"
        if (post_visit_status === 'Want Another' && new_property_id) {
            const propId = parseInt(new_property_id);
            const siteName = new_property_name || 'New Visit';

            const newVisitResult = await runStmt(
                "INSERT INTO site_visits (lead_id, site_name, visit_date, feedback_notes, post_visit_status, property_id) VALUES ($1, $2, (CURRENT_DATE + INTERVAL '3 days'), NULL, NULL, $3)",
                [lead.id, siteName, propId]
            );
            const newVisit = await queryOne('SELECT * FROM site_visits WHERE id = $1', [newVisitResult.lastInsertRowid]);

            await runStmt('UPDATE leads SET status = $1, matched_property_id = $2 WHERE id = $3',
                ['Site Visit Scheduled', propId, lead.id]);

            await logAudit(user.id, lead.id, 'status_change',
                { from: lead.status, to: 'Site Visit Scheduled', trigger: 'want_another_property', new_property_id: propId });

            let scoreResult = null;
            try { scoreResult = await recalculateAndSave(lead.id, user.id); } catch (e) { }
            const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead.id]);

            return res.json({
                visit: updatedVisit,
                new_visit: newVisit,
                lead: updatedLead,
                loop: true,
                new_ml_status: scoreResult ? scoreResult.status : lead.ml_status,
                score: scoreResult ? scoreResult.score : null
            });
        }

        // Normal flow: Advance pipeline to 'Site Visited'
        const currentIdx = PIPELINE_ORDER.indexOf(lead.status);
        const targetIdx = PIPELINE_ORDER.indexOf('Site Visited');
        if (currentIdx >= 0 && currentIdx < targetIdx) {
            await runStmt('UPDATE leads SET status = $1 WHERE id = $2', ['Site Visited', lead.id]);
        }

        let scoreResult = null;
        try { scoreResult = await recalculateAndSave(lead.id, user.id); } catch (e) { }
        const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead.id]);

        return res.json({
            visit: updatedVisit,
            lead: updatedLead,
            new_ml_status: scoreResult ? scoreResult.status : lead.ml_status,
            score: scoreResult ? scoreResult.score : null,
            breakdown: scoreResult ? scoreResult.breakdown : null
        });
    }
);

// Legacy POST /api/visits/:lead_id
router.post('/:lead_id',
    body('site_name').notEmpty().withMessage('Site name is required'),
    body('visit_date').notEmpty().withMessage('Visit date is required'),
    body('post_visit_status').notEmpty().withMessage('Post-visit status is required'),
    async (req, res) => {
        const lead_id = parseInt(req.params.lead_id);
        const { site_name, visit_date, feedback_notes, post_visit_status } = req.body;

        const lead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        if (req.session.user.role === 'agent' && lead.created_by !== req.session.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await runStmt(
            'INSERT INTO site_visits (lead_id, site_name, visit_date, feedback_notes, post_visit_status) VALUES ($1, $2, $3, $4, $5)',
            [lead_id, site_name, visit_date, feedback_notes || null, post_visit_status]
        );

        const newVisit = await queryOne('SELECT * FROM site_visits WHERE id = $1', [result.lastInsertRowid]);

        await runStmt('UPDATE leads SET last_interaction_at = NOW() WHERE id = $1', [lead_id]);

        if (post_visit_status === 'Not Interested') {
            await runStmt('UPDATE leads SET status = $1, ml_status = $2 WHERE id = $3',
                ['Not Interested', 'Cold', lead_id]);
            await logAudit(req.session.user.id, lead_id, 'status_change',
                { from: lead.status, to: 'Not Interested', trigger: 'visit_not_interested' });
            const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead_id]);
            return res.json({ new_status: 'Cold', visit: newVisit, lead: updatedLead });
        }

        let scoreResult = null;
        try { scoreResult = await recalculateAndSave(lead_id, req.session.user.id); } catch (e) { }
        const updatedLead = await queryOne('SELECT * FROM leads WHERE id = $1', [lead_id]);

        return res.json({
            new_status: scoreResult ? scoreResult.status : lead.ml_status,
            score: scoreResult ? scoreResult.score : null,
            visit: newVisit,
            lead: updatedLead
        });
    }
);

module.exports = router;
