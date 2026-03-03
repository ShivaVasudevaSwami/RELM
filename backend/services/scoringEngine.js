/**
 * ════════════════════════════════════════════════════════════════
 * RE-LM v4.1 — Feedback-Driven Lead Temperature Engine
 * ════════════════════════════════════════════════════════════════
 *
 * A deterministic, rule-based Business Intelligence engine that
 * replaces the Python Flask ML backend. Each lead receives a
 * transparent, explainable score based on five weighted factors:
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │  FACTOR                     │  MAX POINTS   │  PRIORITY   │
 * │─────────────────────────────│───────────────│─────────────│
 * │  1. Base Score              │  20           │  Default    │
 * │  2. Pipeline Stage          │  0 – 40       │  Medium     │
 * │  3. Call Sentiment          │  −5 to +20    │  Medium     │
 * │  4. Post-Visit Feedback     │  −100 to +40  │  ★ HIGHEST  │
 * │  5. Property Mirroring      │  0 – 20       │  Low        │
 * │  6. Stagnation Penalty      │  −10 per 3d   │  Decay      │
 * └────────────────────────────────────────────────────────────┘
 *
 * HARD OVERRIDES (bypass all calculation):
 *   • Not Interested (call/visit/status) → force COLD (score = 0)
 *   • Negotiation stage                  → force HOT  (score = 100)
 *   • Booking Confirmed stage            → force HOT  (score = 100)
 *
 * THRESHOLDS:
 *   HOT  :  score > 75
 *   WARM :  score 40 – 75
 *   COLD :  score < 40
 *
 * VIVA NOTE: This engine is fully deterministic — given the same
 * inputs, it always produces the same output. Every factor is
 * weighted and capped. The logic is transparent and auditable.
 * ════════════════════════════════════════════════════════════════
 */

// ─── CONSTANTS ──────────────────────────────────────────────

/**
 * BASE_SCORE: Every new lead starts at 20 points.
 * This represents the inherent value of a fresh inquiry.
 */
const BASE_SCORE = 20;

/**
 * PIPELINE STAGE POINTS (Max 40):
 * Reflects how far the lead has progressed through the sales funnel.
 * Each stage adds incremental points to reflect deeper engagement.
 *
 * New Inquiry   → 0   (just entered the system)
 * Contacted     → +10 (first human touchpoint)
 * Qualified     → +15 (lead passes initial screening)
 * Site Visit Scheduled → +25 (concrete action step taken)
 * Site Visited  → +25 (visited but feedback determines real intent)
 * Negotiation   → +40 (hard override to HOT — deal in progress)
 * Booking Confirmed → +40 (hard override to HOT — deal done)
 */
const PIPELINE_POINTS = {
    'New Inquiry': 0,
    'Contacted': 10,
    'Qualified': 15,
    'Site Visit Scheduled': 25,
    'Site Visited': 25,
    'Negotiation': 40,
    'Booking Confirmed': 40
};

/**
 * CALL SENTIMENT POINTS (Max +20):
 * Based on the most recent call interaction status.
 *
 * Interested    → +20 (verbal confirmation of intent)
 * Picked        → +5  (neutral — picked but no clear signal)
 * No Response   → −5  (slight negative — unreachable)
 * Not Interested → −100 (HARD OVERRIDE → force COLD)
 */
const CALL_SENTIMENT = {
    'Interested': 20,
    'Picked': 5,
    'Busy / Call Back': 0,
    'No Response': -5,
    'Not Interested': -100
};

/**
 * ★ POST-VISIT FEEDBACK POINTS (The Primary Driver):
 * This is the HIGHEST PRIORITY factor. A site visit outcome
 * tells us more about intent than any other signal.
 *
 * Interested     → +40 (strongest intent signal — usually pushes to HOT)
 * Want Another   → +15 (positive engagement, rejected specific unit not concept)
 * Not Interested → −100 (HARD OVERRIDE → force COLD, score = 0)
 *
 * ONLY the LATEST visit feedback is used — reflects current mindset.
 */
const FEEDBACK_SENTIMENT = {
    'Interested': 40,
    'Want Another': 15,
    'Not Interested': -100
};

/**
 * STAGNATION PENALTY:
 * −10 points for every STAGNATION_DAYS (3) days without contact.
 * Reflects "going cold" — if no one follows up, interest decays.
 */
const STAGNATION_DAYS = 3;
const STAGNATION_PENALTY = -10;

// ─── HELPERS ────────────────────────────────────────────────

/**
 * Parse extra_details JSON safely from lead or property.
 * Used for BHK/size matching (Property Mirroring factor).
 * @param {string|Object|null} raw
 * @returns {Object}
 */
function parseExtra(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        // Null guard fallback
        return {};
    }
}

/**
 * Calculate the number of days since a given ISO date string.
 * Used for stagnation penalty calculation.
 * @param {string} dateStr - ISO date string
 * @returns {number} days since (0 if invalid/null)
 */
function daysSince(dateStr) {
    if (!dateStr) return 0;
    const then = new Date(dateStr).getTime();
    if (isNaN(then)) return 0;
    return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

/**
 * Parse a budget range string into numeric min/max values (in INR).
 * E.g. '40-60' → { min: 4000000, max: 6000000 }
 *      '1Cr+' → { min: 10000000, max: Infinity }
 *      '50+'  → { min: 5000000, max: Infinity }  (legacy)
 */
function parseBudgetRange(range) {
    if (!range) return null;
    if (range === '1Cr+') return { min: 10000000, max: Infinity };
    // Legacy format: '50+'
    if (range.endsWith('+')) {
        const n = parseFloat(range);
        return isNaN(n) ? null : { min: n * 100000, max: Infinity };
    }
    // Format: 'X-Y' (in Lakhs)
    const parts = range.split('-').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { min: parts[0] * 100000, max: parts[1] * 100000 };
    }
    return null;
}

// ─── MAIN SCORING FUNCTION ─────────────────────────────────

/**
 * Calculate a lead's score using the multi-factor temperature engine.
 *
 * @param {Object} lead            - Lead record from DB
 * @param {Object|null} lastCall   - Most recent interaction { call_status, interaction_date }
 * @param {Object|null} lastVisit  - Most recent site visit { post_visit_status, logged_at }
 * @param {Object|null} matchedProp - Matched property record (for BHK/size mirroring)
 * @param {Object} negotiationData - { activeCount, totalBookings, highCompetition }
 * @returns {{ score: number, status: string, breakdown: Object }}
 */
function calculate(lead, lastCall, lastVisit, matchedProp, negotiationData = {}) {

    // ─── BREAKDOWN OBJECT ────────────────────────────────────
    // This object records the contribution of each factor.
    // It makes the scoring "Explainable" for the Viva presentation.
    const breakdown = {
        base: BASE_SCORE,
        pipeline: 0,
        callSentiment: 0,
        feedbackSentiment: 0,
        bhkMatch: 0,
        sizeMatch: 0,
        budgetMatch: 0,
        stagnation: 0,
        negotiationBonus: 0,
        competitionUrgency: 0,
        rofrUrgency: 0,
        expiryPenalty: 0,
        velocity: 0,
        familyVisit: 0,
        noShow: 0,
        junkPenalty: 0,
        deadlineMiss: 0,
        zombieBonus: 0,
        overrideApplied: null,
        vipBonus: 0,
        offerPenalty: 0
    };

    // ═══════════════════════════════════════════════════════════
    // HARD OVERRIDE #0: VIP/GOLD PRESERVATION
    // Once a lead achieves Booking Confirmed, they become VIP.
    // VIPs NEVER drop to Cold — score is fixed at 100, status = 'Gold'.
    // ═══════════════════════════════════════════════════════════
    if (lead.is_vip) {
        breakdown.overrideApplied = 'VIP/Gold: Lifetime customer → fixed GOLD (score 100)';
        breakdown.pipeline = 40;
        return { score: 100, status: 'Gold', breakdown };
    }

    // ═══════════════════════════════════════════════════════════
    // HARD OVERRIDE #1: "Not Interested" from ANY source → COLD
    // If the lead, the last call, or the last visit indicates
    // "Not Interested", the deal is dead → score = 0, status = Cold.
    // ═══════════════════════════════════════════════════════════
    if (lead.status === 'Not Interested') {
        breakdown.overrideApplied = 'Pipeline: Not Interested → forced COLD';
        return { score: 0, status: 'Cold', breakdown };
    }
    if (lastCall && lastCall.call_status === 'Not Interested') {
        breakdown.overrideApplied = 'Call Sentiment: Not Interested → forced COLD';
        breakdown.callSentiment = -100;
        return { score: 0, status: 'Cold', breakdown };
    }
    if (lastVisit && lastVisit.post_visit_status === 'Not Interested') {
        breakdown.overrideApplied = 'Visit Feedback: Not Interested → forced COLD';
        breakdown.feedbackSentiment = -100;
        return { score: 0, status: 'Cold', breakdown };
    }

    // ═══════════════════════════════════════════════════════════
    // HARD OVERRIDE #1b: JUNK/FAKE Profile → COLD with −50
    // If an Agent has flagged this lead as junk, heavily penalize.
    // ═══════════════════════════════════════════════════════════
    if (lead.is_junk) {
        breakdown.overrideApplied = 'Agent flagged as Junk/Fake → forced COLD';
        breakdown.junkPenalty = -50;
        return { score: 0, status: 'Cold', breakdown };
    }

    // ═══════════════════════════════════════════════════════════
    // HARD OVERRIDE #2: Negotiation / Booking → HOT
    // If the lead has reached Negotiation or Booking, the deal
    // is highly likely → score = 100, status = Hot.
    // ═══════════════════════════════════════════════════════════
    if (lead.status === 'Negotiation') {
        breakdown.overrideApplied = 'Pipeline: Negotiation → forced HOT';
        breakdown.pipeline = PIPELINE_POINTS['Negotiation'];
        return { score: 100, status: 'Hot', breakdown };
    }
    if (lead.status === 'Booking Confirmed' || lead.status === 'Partially Booked') {
        // ULTRA HOT: investor with >1 bookings
        if (lead.is_investor || (negotiationData.totalBookings && negotiationData.totalBookings > 1)) {
            breakdown.overrideApplied = 'Investor: >1 bookings → forced ULTRA HOT';
            breakdown.pipeline = PIPELINE_POINTS['Booking Confirmed'];
            return { score: 100, status: 'Ultra Hot', breakdown };
        }
        breakdown.overrideApplied = 'Pipeline: Booking Confirmed → forced HOT';
        breakdown.pipeline = PIPELINE_POINTS['Booking Confirmed'];
        return { score: 100, status: 'Hot', breakdown };
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 1: PIPELINE STAGE POINTS (0 – 40)
    //
    // The lead's current position in the sales funnel.
    // Higher stages = deeper engagement = more points.
    // ═══════════════════════════════════════════════════════════
    breakdown.pipeline = PIPELINE_POINTS[lead.status] || 0;

    // ═══════════════════════════════════════════════════════════
    // FACTOR 2: CALL SENTIMENT (−5 to +20)
    //
    // Based on the LAST phone call interaction status.
    // Reflects verbal intent — "Interested" is a strong signal.
    // ═══════════════════════════════════════════════════════════
    if (lastCall && lastCall.call_status) {
        const baseSentiment = CALL_SENTIMENT[lastCall.call_status] || 0;

        // 30-character Note Rule Precision: If positive sentiment, ensure note length is adequate.
        if (baseSentiment > 0 && lastCall.note_length !== undefined && lastCall.note_length < 30) {
            breakdown.callSentiment = 0; // Short notes receive 0 points (preventing crash and strictly enforcing integrity)
        } else {
            breakdown.callSentiment = baseSentiment;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ★ FACTOR 3: POST-VISIT FEEDBACK SENTIMENT (+15 to +40)
    //
    // THIS IS THE PRIMARY DRIVER of the temperature engine.
    // A site visit outcome tells us more about real intent than
    // any other signal. Only the LATEST visit is considered.
    //
    // Interested   → +40 (usually pushes total to >80 → HOT)
    // Want Another → +15 (engagement is positive, unit was wrong)
    // ═══════════════════════════════════════════════════════════
    if (lastVisit && lastVisit.post_visit_status) {
        breakdown.feedbackSentiment = FEEDBACK_SENTIMENT[lastVisit.post_visit_status] || 0;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 4: PROPERTY MIRRORING — "PERFECT MATCH" SCORING
    //
    // Leverages SYMMETRIC extra_details between Lead and Property.
    // Both forms now collect identical field names/enum values,
    // enabling direct 1-to-1 comparison.
    //
    // Type Match   → prerequisite (must match to score anything)
    // BHK Match    → +25 (exact bhk_config or configuration match)
    // Spec Match   → +10 (furnishing, garden, or zoning match)
    // Size Match   → +10 (property size >= lead's min_size_sqft)
    // ═══════════════════════════════════════════════════════════
    if (matchedProp) {
        const leadExtra = parseExtra(lead.extra_details);
        const propExtra = parseExtra(matchedProp.extra_details);

        // Only score property match if the property type matches the lead's preference
        const typeMatch = lead.preferred_property_type === matchedProp.property_type;

        if (typeMatch) {
            const propType = matchedProp.property_type;

            // ── BHK MATCH (Flat/Villa) ───────────────────────────
            if (propType === 'Flat' || propType === 'Villa') {
                const leadBhk = leadExtra.bhk_config || leadExtra.configuration || leadExtra.bhk;
                const propBhk = propExtra.bhk_config || propExtra.configuration || propExtra.bhk;

                // Extract numeric BHK values
                const leadBhkNum = parseInt(String(leadBhk).replace(/\D/g, '')) || 0;
                const propBhkNum = parseInt(String(propBhk).replace(/\D/g, '')) || 0;

                if (leadBhkNum > 0 && propBhkNum > 0) {
                    if (leadBhkNum === propBhkNum) {
                        // EXACT BHK MATCH → +30
                        breakdown.bhkMatch = 30;
                    } else if (propBhkNum > leadBhkNum) {
                        // UPGRADE BONUS: property BHK > lead BHK AND price <= budget → +45
                        const budget = parseBudgetRange(lead.budget_range);
                        const propPrice = parseFloat(matchedProp.price_inr) || 0;
                        if (budget && propPrice > 0 && propPrice <= budget.max) {
                            breakdown.bhkMatch = 45; // Ultra Hot — better BHK within budget
                        } else {
                            breakdown.bhkMatch = 10; // Upgrade but over budget
                        }
                    }
                }

                // SPEC MATCH: furnishing/garden
                if (propType === 'Flat' && leadExtra.furnishing && propExtra.furnishing &&
                    leadExtra.furnishing === propExtra.furnishing) {
                    breakdown.sizeMatch += 10;
                }
                if (propType === 'Villa' && leadExtra.private_garden && propExtra.private_garden) {
                    breakdown.sizeMatch += 10;
                }
            }

            // ── PLOT MATCH (Zoning + Size ±15%) ──────────────────
            if (propType === 'Plot') {
                // ZONING CHECK (CRITICAL): Mismatch = FORCE COLD
                const leadZoning = (leadExtra.zoning || '').toLowerCase().trim();
                const propZoning = (propExtra.zoning || '').toLowerCase().trim();

                if (leadZoning && propZoning && !propZoning.includes(leadZoning.split(' ')[0]) && !leadZoning.includes(propZoning.split(' ')[0])) {
                    // ZONING MISMATCH: −100 → Force Cold
                    breakdown.bhkMatch = -100;
                } else if (leadZoning && propZoning) {
                    // Zoning match: +10
                    breakdown.sizeMatch += 10;
                }

                // PLOT SIZE ±15% TOLERANCE
                const leadPlotSize = parseInt(leadExtra.plot_size) || 0;
                const propPlotSize = parseInt(propExtra.plot_size || propExtra.size_sqft) || 0;
                if (leadPlotSize > 0 && propPlotSize > 0) {
                    const deviation = Math.abs(propPlotSize - leadPlotSize) / leadPlotSize;
                    if (deviation <= 0.15) {
                        // Within ±15% → +30
                        breakdown.sizeMatch += 30;
                    } else if (deviation <= 0.30) {
                        // Within ±30% → +10 (acceptable deviation)
                        breakdown.sizeMatch += 10;
                    }
                }
            }
        }

        // SIZE MATCH (Flat/Villa): +10 if property size >= lead's minimum
        const leadMinSize = parseFloat(leadExtra.min_size_sqft || leadExtra.min_size) || 0;
        const propSize = parseFloat(propExtra.size_sqft || matchedProp.size_sqft) || 0;
        if (leadMinSize > 0 && propSize >= leadMinSize) {
            breakdown.sizeMatch += 10;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 4b: BUDGET RANGE MATCH (+20 points)
    //
    // If the lead has a budget_range and the matched property has
    // a price_inr, check if the price falls within the budget.
    // ═══════════════════════════════════════════════════════════
    if (matchedProp && lead.budget_range) {
        const budget = parseBudgetRange(lead.budget_range);
        const propPrice = parseFloat(matchedProp.price_inr) || 0;
        if (budget && propPrice >= budget.min && propPrice <= budget.max) {
            breakdown.budgetMatch = 20;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 5: PROGRESSIVE STAGNATION PENALTY (v4.2)
    //
    // Day 1-3:  No penalty (grace period)
    // Day 4-7:  −5 per day (mild decay)
    // Day 8+:   −15 per day (aggressive decay)
    // ═══════════════════════════════════════════════════════════
    if (lead.last_interaction_at) {
        const daysSinceInteraction = daysSince(lead.last_interaction_at);
        if (daysSinceInteraction >= 8) {
            // Days 4-7 contribute −5 each (4 days × −5 = −20)
            // Days 8+ contribute −15 each
            const aggressiveDays = daysSinceInteraction - 7;
            breakdown.stagnation = (4 * -5) + (aggressiveDays * -15);
        } else if (daysSinceInteraction >= 4) {
            const mildDays = daysSinceInteraction - 3;
            breakdown.stagnation = mildDays * -5;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 6: VELOCITY / MOMENTUM (v4.2 Predictive)
    //
    // If lead moved from Inquiry to Site Visit Scheduled in <48hrs:
    // +20 (fast mover, high intent)
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.velocityBonus) {
        breakdown.velocity = 20;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 6b: FAMILY VISIT (2nd+ visit = +30)
    //
    // Multiple site visits signal serious buyer intent.
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.visitCount >= 2) {
        breakdown.familyVisit = 30;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 6c: NO-SHOW PENALTY (−40)
    //
    // If a visit was scheduled but post_visit_status = 'No Show'
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.hasNoShow) {
        breakdown.noShow = -40;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 6d: DECISION DEADLINE MISS (−20)
    //
    // If decision_deadline has passed without an update
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.deadlineMissed) {
        breakdown.deadlineMiss = -20;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 6e: ZOMBIE RESURRECTION (+50)
    //
    // Re-inquiry after 180+ days from a previously closed lead
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.zombieResurrection) {
        breakdown.zombieBonus = 50;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 9: VIP RE-ENQUIRY BONUS (+40)
    //
    // If a previous inquiry was booked (linked_phone match)
    // the new session gets a trust boost.
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.vipReEnquiry) {
        breakdown.vipBonus = 40;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 10: OFFER < 75% OF PRICE (−20)
    //
    // Low-ball offers signal weak intent
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.hasLowballOffer) {
        breakdown.offerPenalty = -20;
    }

    // ═══════════════════════════════════════════════════════════
    // TOTAL SCORE & STATUS CLASSIFICATION
    //
    // Sum all factors, clamp to 0–100, then classify:
    //   HOT  : score > 75
    //   WARM : score 40 – 75
    //   COLD : score < 40
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    // FACTOR 7: NEGOTIATION ACTIVITY (Multi-Booking Hub)
    //
    // Each active negotiation → +30 (investor engagement)
    // High competition property → +10 (urgency)
    // ═══════════════════════════════════════════════════════════
    const activeNeg = negotiationData.activeCount || 0;
    breakdown.negotiationBonus = activeNeg * 30;
    if (negotiationData.highCompetition) {
        breakdown.competitionUrgency = 10;
    }

    // ═══════════════════════════════════════════════════════════
    // FACTOR 8: RESERVATION INTEGRITY (Conflict Resolution)
    //
    // ROFR Challenge received → +20 (urgency to act)
    // Tier-2 expired without action → −30 penalty
    // ═══════════════════════════════════════════════════════════
    if (negotiationData.underRofrChallenge) {
        breakdown.rofrUrgency = 20;
    }
    if (negotiationData.expiredReservations > 0) {
        breakdown.expiryPenalty = -30 * negotiationData.expiredReservations;
    }

    const rawScore = breakdown.base
        + breakdown.pipeline
        + breakdown.callSentiment
        + breakdown.feedbackSentiment
        + breakdown.bhkMatch
        + breakdown.sizeMatch
        + breakdown.budgetMatch
        + breakdown.stagnation
        + breakdown.negotiationBonus
        + breakdown.competitionUrgency
        + breakdown.rofrUrgency
        + breakdown.expiryPenalty
        + breakdown.velocity
        + breakdown.familyVisit
        + breakdown.noShow
        + breakdown.deadlineMiss
        + breakdown.zombieBonus
        + breakdown.vipBonus
        + breakdown.offerPenalty;

    // Clamp score to 0–100 range
    const score = Math.max(0, Math.min(100, rawScore));

    let status;
    if (score > 75) {
        status = 'Hot';
    } else if (score >= 40) {
        status = 'Warm';
    } else {
        status = 'Cold';
    }

    return { score, status, breakdown };
}

// ─── CONVENIENCE: RECALCULATE & SAVE ────────────────────────

// Import DB functions directly for async PostgreSQL
const { queryOne: dbQueryOne, runStmt: dbRunStmt } = require('../db/database');

/**
 * Fetch all scoring inputs for a lead, calculate score, and
 * persist the result to the database. Also logs audit trail
 * if the temperature (ml_status) changed.
 *
 * @param {number} leadId
 * @param {number|null} userId - Who triggered the recalculation
 * @returns {Promise<{ score: number, status: string, breakdown: Object } | null>}
 */
async function recalculateAndSave(leadId, userId = null) {
    // 1. Fetch the lead
    const lead = await dbQueryOne('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return null;

    // SCORE FREEZE: Terminal statuses are frozen — no recalculation
    const TERMINAL = ['Booking Confirmed', 'Not Interested'];
    if (TERMINAL.includes(lead.status)) {
        return { score: lead.score || 0, status: lead.ml_status || 'Cold', breakdown: { frozen: true } };
    }

    // 2. Fetch the LATEST call interaction
    const lastCall = await dbQueryOne(
        'SELECT call_status, interaction_date, note_length FROM interactions WHERE lead_id = $1 ORDER BY interaction_date DESC LIMIT 1',
        [leadId]
    );

    // 3. Fetch the LATEST site visit with feedback
    const lastVisit = await dbQueryOne(
        'SELECT post_visit_status, logged_at FROM site_visits WHERE lead_id = $1 AND post_visit_status IS NOT NULL ORDER BY logged_at DESC LIMIT 1',
        [leadId]
    );

    // 4. Fetch matched property for BHK/size mirroring
    let matchedProp = null;
    if (lead.matched_property_id) {
        matchedProp = await dbQueryOne('SELECT * FROM properties WHERE id = $1', [lead.matched_property_id]);
    }

    // 5. Fetch negotiation data
    const activeNegCount = await dbQueryOne(
        `SELECT COUNT(*) as cnt FROM negotiations WHERE lead_id = $1 AND status = 'Active'`, [leadId]
    );
    const totalBookings = await dbQueryOne(
        `SELECT COUNT(*) as cnt FROM bookings WHERE lead_id = $1`, [leadId]
    );
    const highCompNeg = await dbQueryOne(
        `SELECT n.property_id FROM negotiations n
         JOIN properties p ON n.property_id = p.id
         WHERE n.lead_id = $1 AND n.status = 'Active' AND p.negotiation_count >= 3
         LIMIT 1`, [leadId]
    );
    const negotiationData = {
        activeCount: parseInt(activeNegCount?.cnt) || 0,
        totalBookings: parseInt(totalBookings?.cnt) || 0,
        highCompetition: !!highCompNeg,
        underRofrChallenge: false,
        expiredReservations: 0
    };

    // 5b. Reservation data
    const rofrChallenge = await dbQueryOne(
        `SELECT id FROM reservations WHERE lead_id = $1 AND status = 'Active' AND rofr_challenge_by IS NOT NULL LIMIT 1`,
        [leadId]
    );
    const expiredRes = await dbQueryOne(
        `SELECT COUNT(*) as cnt FROM reservations WHERE lead_id = $1 AND tier = 2 AND status = 'Expired'`,
        [leadId]
    );
    negotiationData.underRofrChallenge = !!rofrChallenge;
    negotiationData.expiredReservations = parseInt(expiredRes?.cnt) || 0;

    // 5c. Predictive Intent
    const firstVisitScheduled = await dbQueryOne(
        `SELECT MIN(created_at) as first_date FROM audit_logs
         WHERE lead_id = $1 AND action = 'status_change'
         AND details LIKE '%Site Visit Scheduled%'`, [leadId]
    );
    if (firstVisitScheduled?.first_date && lead.created_at) {
        const hoursToVisit = (new Date(firstVisitScheduled.first_date).getTime() - new Date(lead.created_at).getTime()) / 3600000;
        negotiationData.velocityBonus = hoursToVisit <= 48;
    }

    const visitCount = await dbQueryOne(`SELECT COUNT(*) as cnt FROM site_visits WHERE lead_id = $1`, [leadId]);
    negotiationData.visitCount = parseInt(visitCount?.cnt) || 0;

    const noShow = await dbQueryOne(
        `SELECT id FROM site_visits WHERE lead_id = $1 AND post_visit_status = 'No Show' LIMIT 1`, [leadId]
    );
    negotiationData.hasNoShow = !!noShow;

    if (lead.decision_deadline) {
        negotiationData.deadlineMissed = new Date(lead.decision_deadline).getTime() < Date.now();
    }

    if (lead.inquiry_count > 1 && lead.linked_phone) {
        const prevLead = await dbQueryOne(
            `SELECT created_at FROM leads WHERE phone = $1 AND id != $2 ORDER BY created_at DESC LIMIT 1`,
            [lead.phone, leadId]
        );
        if (prevLead?.created_at) {
            const daysSincePrev = daysSince(prevLead.created_at);
            negotiationData.zombieResurrection = daysSincePrev >= 180;
        }
    }

    if (lead.linked_phone || lead.inquiry_count > 1) {
        const vipPrev = await dbQueryOne(
            `SELECT id FROM leads WHERE phone = $1 AND id != $2 AND is_vip = 1 LIMIT 1`,
            [lead.phone, leadId]
        );
        negotiationData.vipReEnquiry = !!vipPrev;
    }

    const lowball = await dbQueryOne(
        `SELECT n.id FROM negotiations n
         JOIN properties p ON n.property_id = p.id
         WHERE n.lead_id = $1 AND n.status = 'Active'
         AND n.offered_price > 0 AND p.price_inr > 0
         AND n.offered_price < (p.price_inr * 0.75)
         LIMIT 1`, [leadId]
    );
    negotiationData.hasLowballOffer = !!lowball;

    // 6. Calculate
    const result = calculate(lead, lastCall, lastVisit, matchedProp, negotiationData);

    // 6b. Save score + ml_status
    const lastCallStatus = lastCall ? lastCall.call_status : null;
    await dbRunStmt(
        'UPDATE leads SET ml_status = $1, score = $2, last_call_status = $3 WHERE id = $4',
        [result.status, result.score, lastCallStatus, leadId]
    );

    // 7. Audit log if temperature changed
    const oldStatus = lead.ml_status;
    if (oldStatus !== result.status && userId) {
        await dbRunStmt(
            'INSERT INTO audit_logs (user_id, lead_id, action, details) VALUES ($1, $2, $3, $4)',
            [userId, leadId, 'score_change',
                JSON.stringify({
                    from: oldStatus,
                    to: result.status,
                    score: result.score,
                    breakdown: result.breakdown
                })]
        );
    }

    return result;
}

// ─── AUDIT HELPER ───────────────────────────────────────────

/**
 * Insert an audit log entry.
 * @param {number} userId
 * @param {number} leadId
 * @param {string} action
 * @param {Object} details - JSON-serializable
 */
async function logAudit(userId, leadId, action, details) {
    await dbRunStmt(
        'INSERT INTO audit_logs (user_id, lead_id, action, details) VALUES ($1, $2, $3, $4)',
        [userId, leadId, action, JSON.stringify(details)]
    );
}

// ─── EXPORTS ────────────────────────────────────────────────

module.exports = {
    calculate,
    recalculateAndSave,
    logAudit,
    parseExtra,
    PIPELINE_POINTS,
    BASE_SCORE,
    CALL_SENTIMENT,
    FEEDBACK_SENTIMENT,
    STAGNATION_DAYS,
    STAGNATION_PENALTY
};
