const express = require('express');
const { body, validationResult } = require('express-validator');
const { getClient, queryOne, saveDB } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');

const router = express.Router();

router.use(isAuthenticated);

// Pipeline forward-only stage order
const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Qualified',
    'Site Visit Scheduled', 'Site Visited',
    'Negotiation', 'Booking Confirmed', 'Not Interested'
];

// Call statuses that qualify as "successful contact"
const SUCCESS_CALL_STATUSES = ['Interested', 'Picked', 'Busy / Call Back'];

// ═══════════════════════════════════════════════════════════════
// POST /api/interactions/:lead_id
// OPTIMIZED: Fire-and-forget scoring (respond before recalculate)
// ═══════════════════════════════════════════════════════════════
router.post('/:lead_id',
    body('call_status').notEmpty().withMessage('Call status is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const lead_id = parseInt(req.params.lead_id);
        const { call_status, feedback_notes, next_follow_up } = req.body;
        const note_length = feedback_notes ? feedback_notes.length : 0;
        const user = req.session.user;

        const client = await getClient();

        try {
            const leadResult = await client.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
            const lead = leadResult.rows[0];
            if (!lead) {
                client.release();
                return res.status(404).json({ error: 'Lead not found' });
            }

            // RBAC: Agents can only log calls for their assigned leads
            if (user.role === 'agent' && lead.created_by !== user.id) {
                client.release();
                return res.status(403).json({ error: 'Access denied' });
            }

            // Determine auto-progression eligibility
            const isSuccessCall = SUCCESS_CALL_STATUSES.includes(call_status);
            const hasMeaningfulNotes = feedback_notes && feedback_notes.length >= 30;
            const isNewInquiry = lead.status === 'New Inquiry';
            const currentIdx = PIPELINE_ORDER.indexOf(lead.status);
            const contactedIdx = PIPELINE_ORDER.indexOf('Contacted');
            const canAutoProgress = isNewInquiry && isSuccessCall && hasMeaningfulNotes
                && currentIdx < contactedIdx;

            let autoProgressed = false;
            let newPipelineStatus = lead.status;

            // ── ATOMIC TRANSACTION (primary task only) ──────────
            await client.query('BEGIN');

            // 1. Insert the interaction
            await client.query(
                "INSERT INTO interactions (lead_id, interaction_type, call_status, feedback_notes, note_length, next_follow_up) VALUES ($1, 'Call', $2, $3, $4, $5)",
                [lead_id, call_status, feedback_notes || null, note_length, next_follow_up || null]
            );

            // 2. Update lead columns
            let updateCols = ['last_call_status = $1'];
            let updateVals = [call_status];
            let paramIdx = 2;

            if (hasMeaningfulNotes) {
                updateCols.push('last_interaction_at = NOW()');
            }
            if (next_follow_up && call_status !== 'Not Interested') {
                updateCols.push(`next_follow_up = $${paramIdx}`);
                updateVals.push(next_follow_up);
                paramIdx++;
            }

            updateVals.push(lead_id);
            await client.query(
                `UPDATE leads SET ${updateCols.join(', ')} WHERE id = $${paramIdx}`,
                updateVals
            );

            // 3. AUTO-PROGRESSION: New Inquiry → Contacted
            if (canAutoProgress) {
                await client.query(
                    "UPDATE leads SET status = 'Contacted' WHERE id = $1 AND status = 'New Inquiry'",
                    [lead_id]
                );
                autoProgressed = true;
                newPipelineStatus = 'Contacted';

                await client.query(
                    "INSERT INTO audit_logs (user_id, lead_id, action, details) VALUES ($1, $2, $3, $4)",
                    [user.id, lead_id, 'AUTO_STAGE_UPDATE',
                    `Moved to Contacted via valid Call Log by ${user.username}. Call: ${call_status}`]
                );
            }

            // 4. Handle "Not Interested" override (synchronous — must be in transaction)
            if (call_status === 'Not Interested') {
                await client.query(
                    'UPDATE leads SET status = $1, ml_status = $2, score = 0 WHERE id = $3',
                    ['Not Interested', 'Cold', lead_id]
                );
                newPipelineStatus = 'Not Interested';
                autoProgressed = false;

                await client.query(
                    "INSERT INTO audit_logs (user_id, lead_id, action, details) VALUES ($1, $2, $3, $4)",
                    [user.id, lead_id, 'status_change',
                    JSON.stringify({ from: lead.status, to: 'Not Interested', trigger: 'call_not_interested' })]
                );
            }

            // COMMIT the primary task
            await client.query('COMMIT');
            client.release();

            // ══ EARLY RESPONSE — send immediately after COMMIT ══
            res.json({
                success: true,
                message: 'Interaction saved',
                new_status: call_status === 'Not Interested' ? 'Cold' : lead.ml_status,
                score: call_status === 'Not Interested' ? 0 : lead.score,
                auto_progressed: autoProgressed,
                pipeline_status: newPipelineStatus,
                scoring: call_status === 'Not Interested' ? 'complete' : 'pending',
                auto_message: autoProgressed
                    ? `Pipeline auto-updated to Stage 2: Contacted`
                    : null
            });

            // ══ FIRE-AND-FORGET: Scoring runs in background ══
            // Skip scoring for "Not Interested" — already handled synchronously above
            if (call_status !== 'Not Interested') {
                recalculateAndSave(lead_id, user.id).catch(err => {
                    console.error('[Scoring] Background scoring error (non-fatal):', err.message);
                });
            }

        } catch (err) {
            try { await client.query('ROLLBACK'); } catch (_) { }
            client.release();
            console.error('Interaction transaction error:', err);
            return res.status(500).json({ success: false, error: 'Failed to save interaction', details: err.message });
        }
    }
);

module.exports = router;
