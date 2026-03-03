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

// POST /api/visits/:lead_id/schedule — Schedule a site visit (with baton pass + property link)
router.post('/:lead_id/schedule',
    body('site_name').notEmpty().withMessage('Site name is required'),
    body('visit_date').notEmpty().withMessage('Visit date is required'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const lead_id = parseInt(req.params.lead_id);
        const { site_name, visit_date, property_id, assigned_agent } = req.body;
        const user = req.session.user;

        const lead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // RBAC: telecaller must own the lead, agent must be assigned
        if (user.role === 'telecaller' && lead.assigned_telecaller !== user.id && lead.created_by !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (user.role === 'agent' && lead.assigned_agent !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // PRE-SCHEDULE CHECK: Block if any previous visit has pending feedback
        const pendingVisit = queryOne(
            'SELECT id, site_name FROM site_visits WHERE lead_id = ? AND post_visit_status IS NULL',
            [lead_id]
        );
        if (pendingVisit) {
            return res.status(400).json({
                error: `Cannot schedule new visit: Pending feedback required for previous visit "${pendingVisit.site_name}".`
            });
        }

        // Insert visit record with property_id
        const result = runStmt(
            'INSERT INTO site_visits (lead_id, site_name, visit_date, feedback_notes, post_visit_status, property_id) VALUES (?, ?, ?, NULL, NULL, ?)',
            [lead_id, site_name, visit_date, property_id ? parseInt(property_id) : null]
        );

        const newVisit = queryOne('SELECT * FROM site_visits WHERE id = ?', [result.lastInsertRowid]);

        // Auto-advance pipeline to 'Site Visit Scheduled' if currently before that stage
        const currentIdx = PIPELINE_ORDER.indexOf(lead.status);
        const targetIdx = PIPELINE_ORDER.indexOf('Site Visit Scheduled');
        if (currentIdx >= 0 && currentIdx < targetIdx) {
            runStmt('UPDATE leads SET status = ? WHERE id = ?', ['Site Visit Scheduled', lead_id]);
        }

        // Link matched property if provided
        if (property_id) {
            runStmt('UPDATE leads SET matched_property_id = ? WHERE id = ?', [parseInt(property_id), lead_id]);
        }

        // BATON PASS: Assign agent if provided (telecaller → agent handoff)
        if (assigned_agent) {
            runStmt('UPDATE leads SET assigned_agent = ? WHERE id = ?', [parseInt(assigned_agent), lead_id]);
            logAudit(runStmt, user.id, lead_id, 'assignment',
                { type: 'baton_pass', assigned_agent: parseInt(assigned_agent), trigger: 'first_visit_schedule' });
        }

        const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);
        return res.json({ visit: newVisit, lead: updatedLead });
    }
);

// PUT /api/visits/:visit_id/feedback — Submit feedback + handle "Want Another" loop
router.put('/:visit_id/feedback',
    body('post_visit_status').notEmpty().withMessage('Post-visit status is required'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const visit_id = parseInt(req.params.visit_id);
        const { post_visit_status, feedback_notes, new_property_id, new_property_name } = req.body;
        const user = req.session.user;

        const visit = queryOne('SELECT * FROM site_visits WHERE id = ?', [visit_id]);
        if (!visit) {
            return res.status(404).json({ error: 'Site visit not found' });
        }

        const lead = queryOne('SELECT * FROM leads WHERE id = ?', [visit.lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // RBAC check
        if (user.role === 'agent' && lead.assigned_agent !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Update the visit record
        runStmt(
            'UPDATE site_visits SET post_visit_status = ?, feedback_notes = ? WHERE id = ?',
            [post_visit_status, feedback_notes || null, visit_id]
        );

        const updatedVisit = queryOne('SELECT * FROM site_visits WHERE id = ?', [visit_id]);

        // Audit: Log feedback submission
        logAudit(runStmt, user.id, lead.id, 'feedback_submitted', {
            visit_id: visit_id,
            property: visit.site_name,
            status: post_visit_status,
            agent: user.username
        });

        // Update last_interaction_at for stagnation tracking
        runStmt('UPDATE leads SET last_interaction_at = CURRENT_TIMESTAMP WHERE id = ?', [lead.id]);

        // Handle 'Not Interested' post-visit — override to Cold
        if (post_visit_status === 'Not Interested') {
            runStmt('UPDATE leads SET status = ?, ml_status = ? WHERE id = ?',
                ['Not Interested', 'Cold', lead.id]);
            logAudit(runStmt, user.id, lead.id, 'status_change',
                { from: lead.status, to: 'Not Interested', trigger: 'visit_not_interested' });
            const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead.id]);
            return res.json({ visit: updatedVisit, lead: updatedLead, new_ml_status: 'Cold' });
        }

        // ═══════════════════════════════════════════════════════════
        // VISIT LOOP: "Want Another Property"
        // → Create new site_visit for the new property
        // → Reset pipeline to "Site Visit Scheduled"
        // → Keep same assigned_agent
        // ═══════════════════════════════════════════════════════════
        if (post_visit_status === 'Want Another' && new_property_id) {
            const propId = parseInt(new_property_id);
            const siteName = new_property_name || 'New Visit';

            // Create new site_visit record
            const newVisitResult = runStmt(
                'INSERT INTO site_visits (lead_id, site_name, visit_date, feedback_notes, post_visit_status, property_id) VALUES (?, ?, date("now", "+3 days"), NULL, NULL, ?)',
                [lead.id, siteName, propId]
            );
            const newVisit = queryOne('SELECT * FROM site_visits WHERE id = ?', [newVisitResult.lastInsertRowid]);

            // Reset pipeline to "Site Visit Scheduled" and update matched property
            runStmt('UPDATE leads SET status = ?, matched_property_id = ? WHERE id = ?',
                ['Site Visit Scheduled', propId, lead.id]);

            logAudit(runStmt, user.id, lead.id, 'status_change',
                { from: lead.status, to: 'Site Visit Scheduled', trigger: 'want_another_property', new_property_id: propId });

            // Recalculate score
            const scoreResult = recalculateAndSave(lead.id, queryOne, runStmt, user.id);
            const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead.id]);

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
            runStmt('UPDATE leads SET status = ? WHERE id = ?', ['Site Visited', lead.id]);
        }

        // Recalculate lead score
        const scoreResult = recalculateAndSave(lead.id, queryOne, runStmt, user.id);
        const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead.id]);

        return res.json({
            visit: updatedVisit,
            lead: updatedLead,
            new_ml_status: scoreResult ? scoreResult.status : lead.ml_status,
            score: scoreResult ? scoreResult.score : null,
            breakdown: scoreResult ? scoreResult.breakdown : null
        });
    }
);

// Legacy POST /api/visits/:lead_id — kept for backwards compatibility
router.post('/:lead_id',
    body('site_name').notEmpty().withMessage('Site name is required'),
    body('visit_date').notEmpty().withMessage('Visit date is required'),
    body('post_visit_status').notEmpty().withMessage('Post-visit status is required'),
    (req, res) => {
        const lead_id = parseInt(req.params.lead_id);
        const { site_name, visit_date, feedback_notes, post_visit_status } = req.body;

        const lead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        if (req.session.user.role === 'agent' && lead.created_by !== req.session.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = runStmt(
            'INSERT INTO site_visits (lead_id, site_name, visit_date, feedback_notes, post_visit_status) VALUES (?, ?, ?, ?, ?)',
            [lead_id, site_name, visit_date, feedback_notes || null, post_visit_status]
        );

        const newVisit = queryOne('SELECT * FROM site_visits WHERE id = ?', [result.lastInsertRowid]);

        // Update last_interaction_at for stagnation tracking
        runStmt('UPDATE leads SET last_interaction_at = CURRENT_TIMESTAMP WHERE id = ?', [lead_id]);

        // Handle 'Not Interested'
        if (post_visit_status === 'Not Interested') {
            runStmt('UPDATE leads SET status = ?, ml_status = ? WHERE id = ?',
                ['Not Interested', 'Cold', lead_id]);
            logAudit(runStmt, req.session.user.id, lead_id, 'status_change',
                { from: lead.status, to: 'Not Interested', trigger: 'visit_not_interested' });
            const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);
            return res.json({ new_status: 'Cold', visit: newVisit, lead: updatedLead });
        }

        // Recalculate lead score
        const scoreResult = recalculateAndSave(lead_id, queryOne, runStmt, req.session.user.id);
        const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);

        return res.json({
            new_status: scoreResult ? scoreResult.status : lead.ml_status,
            score: scoreResult ? scoreResult.score : null,
            visit: newVisit,
            lead: updatedLead
        });
    }
);

module.exports = router;
