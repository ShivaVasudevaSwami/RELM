const express = require('express');
const { body, validationResult } = require('express-validator');
const { queryOne, runStmt, execSQL, saveDB } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave, logAudit } = require('../services/scoringEngine');

const router = express.Router();

router.use(isAuthenticated);

// ═══════════════════════════════════════════════════════════════
// PIPELINE: Forward-only stage order
// A stage can only auto-transition FORWARD in this list.
// ═══════════════════════════════════════════════════════════════
const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Qualified',
    'Site Visit Scheduled', 'Site Visited',
    'Negotiation', 'Booking Confirmed', 'Not Interested'
];

// Call statuses that qualify as "successful contact"
const SUCCESS_CALL_STATUSES = ['Interested', 'Picked', 'Busy / Call Back'];

// ═══════════════════════════════════════════════════════════════
// POST /api/interactions/:lead_id
//
// Log a call interaction AND auto-progress the pipeline if the
// call meets the "Contacted" trigger criteria:
//   1. Lead is currently "New Inquiry"
//   2. Call status is a success (Interested / Picked / Busy)
//   3. Notes are meaningful (≥ 30 characters)
//
// Uses SQL Transaction for atomic insert + status update.
// ═══════════════════════════════════════════════════════════════
router.post('/:lead_id',
    body('call_status').notEmpty().withMessage('Call status is required'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const lead_id = parseInt(req.params.lead_id);
        const { call_status, feedback_notes, next_follow_up } = req.body;
        const note_length = feedback_notes ? feedback_notes.length : 0;
        const user = req.session.user;

        const lead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // RBAC: Agents can only log calls for their assigned leads
        if (user.role === 'agent' && lead.created_by !== user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // ── Determine auto-progression eligibility ──────────
        const isSuccessCall = SUCCESS_CALL_STATUSES.includes(call_status);
        const hasMeaningfulNotes = feedback_notes && feedback_notes.length >= 30;
        const isNewInquiry = lead.status === 'New Inquiry';

        // Forward-only check: ensure we never move backward
        const currentIdx = PIPELINE_ORDER.indexOf(lead.status);
        const contactedIdx = PIPELINE_ORDER.indexOf('Contacted');
        const canAutoProgress = isNewInquiry && isSuccessCall && hasMeaningfulNotes
            && currentIdx < contactedIdx;

        // Track what happened for the response
        let autoProgressed = false;
        let newPipelineStatus = lead.status;

        try {
            // ── ATOMIC TRANSACTION ──────────────────────────
            execSQL('BEGIN TRANSACTION');

            // 1. Insert the interaction
            const result = runStmt(
                "INSERT INTO interactions (lead_id, interaction_type, call_status, feedback_notes, note_length, next_follow_up) VALUES (?, 'Call', ?, ?, ?, ?)",
                [lead_id, call_status, feedback_notes || null, note_length, next_follow_up || null]
            );

            // 2. Update lead columns:
            // - last_interaction_at (if meaningful notes)
            // - next_follow_up (if provided)
            // - last_call_status (always update to latest)
            let updateCols = ['last_call_status = ?'];
            let updateVals = [call_status];

            if (hasMeaningfulNotes) {
                updateCols.push('last_interaction_at = CURRENT_TIMESTAMP');
            }
            if (next_follow_up && call_status !== 'Not Interested') {
                updateCols.push('next_follow_up = ?');
                updateVals.push(next_follow_up);
            }

            updateVals.push(lead_id);
            runStmt(`UPDATE leads SET ${updateCols.join(', ')} WHERE id = ?`, updateVals);

            // 3. AUTO-PROGRESSION: New Inquiry → Contacted
            if (canAutoProgress) {
                runStmt("UPDATE leads SET status = 'Contacted' WHERE id = ? AND status = 'New Inquiry'", [lead_id]);
                autoProgressed = true;
                newPipelineStatus = 'Contacted';

                // Audit log: AUTO_STAGE_UPDATE
                logAudit(runStmt, user.id, lead_id, 'AUTO_STAGE_UPDATE',
                    `Moved to Contacted via valid Call Log by ${user.name || user.username}. Call: ${call_status}`
                );
            }

            // 4. Handle "Not Interested" override (terminal status)
            if (call_status === 'Not Interested') {
                runStmt('UPDATE leads SET status = ?, ml_status = ? WHERE id = ?',
                    ['Not Interested', 'Cold', lead_id]);
                newPipelineStatus = 'Not Interested';
                autoProgressed = false; // Not a "progression"

                logAudit(runStmt, user.id, lead_id, 'status_change',
                    { from: lead.status, to: 'Not Interested', trigger: 'call_not_interested' }
                );
            }

            // 5. Recalculate score DURING the transaction
            let scoreResult = null;
            try {
                scoreResult = recalculateAndSave(lead_id, queryOne, runStmt, user.id);
            } catch (scoreErr) {
                console.warn('[Scoring] Non-fatal scoring error:', scoreErr.message);
                // Score failure should NOT block the interaction save
            }

            const updatedLead = queryOne('SELECT * FROM leads WHERE id = ?', [lead_id]);
            const newInteraction = queryOne(
                'SELECT * FROM interactions WHERE lead_id = ? ORDER BY interaction_date DESC LIMIT 1',
                [lead_id]
            );

            execSQL('COMMIT');
            saveDB(); // Flush to disk AFTER commit

            return res.json({
                success: true,
                message: 'Interaction saved',
                new_status: scoreResult ? scoreResult.status : lead.ml_status,
                score: scoreResult ? scoreResult.score : null,
                breakdown: scoreResult ? scoreResult.breakdown : null,
                interaction: newInteraction,
                lead: updatedLead,
                // ── Auto-progression feedback ──────────────────
                auto_progressed: autoProgressed,
                pipeline_status: newPipelineStatus,
                auto_message: autoProgressed
                    ? `Pipeline auto-updated to Stage 2: Contacted`
                    : null
            });

        } catch (err) {
            try { execSQL('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
            console.error('Interaction transaction error:', err);
            return res.status(500).json({ success: false, error: 'Failed to save interaction', details: err.message });
        }
    }
);

module.exports = router;
