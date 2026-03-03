/**
 * dataSanitizer.js — Clean-Pipe Data Sanitization Engine
 * RE-LM v4.2 — Regex-based sanitization for Plot sizes, Phone numbers,
 * and extra_details normalization
 */

const { BHK_MAP, PLOT_ZONINGS } = require('./constants');

// ── Phone Number Sanitizer ──────────────────────────────────
// Strips +91, 0-prefix, spaces, dashes → returns pure 10-digit number
function sanitizePhone(raw) {
    if (!raw) return null;
    let phone = String(raw).trim();
    phone = phone.replace(/[\s\-().]/g, '');      // strip formatting
    phone = phone.replace(/^\+91/, '');            // strip +91
    phone = phone.replace(/^91(?=\d{10}$)/, '');   // strip leading 91
    phone = phone.replace(/^0/, '');               // strip leading 0
    return /^[6-9]\d{9}$/.test(phone) ? phone : null;
}

// ── Plot Size Sanitizer ─────────────────────────────────────
// Converts any land measurement to sq. ft. (integer)
// Supports: sq. yards, sq. meters, acres, guntha, bigha, cents
function sanitizePlotSize(raw) {
    if (!raw && raw !== 0) return null;
    const str = String(raw).trim().toLowerCase();

    // Extract numeric value
    const numMatch = str.match(/([\d,.]+)/);
    if (!numMatch) return null;
    const num = parseFloat(numMatch[1].replace(/,/g, ''));
    if (isNaN(num) || num <= 0) return null;

    // Unit conversion to sq. ft.
    if (/sq\.?\s*yard|sq\.?\s*yd|gaj/i.test(str)) return Math.round(num * 9);
    if (/sq\.?\s*met|sq\.?\s*m\b|sqm/i.test(str)) return Math.round(num * 10.764);
    if (/acre/i.test(str)) return Math.round(num * 43560);
    if (/guntha|gunta/i.test(str)) return Math.round(num * 1089);
    if (/bigha/i.test(str)) return Math.round(num * 27000);
    if (/cent/i.test(str)) return Math.round(num * 435.6);

    // Default: assume sq. ft.
    return Math.round(num);
}

// ── Extra Details Normalizer ────────────────────────────────
// Normalizes the mirrored extra_details JSON for consistent matching
function normalizeExtraDetails(propertyType, raw) {
    if (!raw) return {};
    const details = typeof raw === 'string' ? JSON.parse(raw) : { ...raw };

    if (propertyType === 'Flat' || propertyType === 'Villa') {
        // Normalize BHK to numeric
        if (details.bhk && typeof details.bhk === 'string') {
            details.bhk_numeric = BHK_MAP[details.bhk] || parseInt(details.bhk) || null;
        }
        // Normalize size
        if (details.min_size) {
            details.min_size = parseInt(String(details.min_size).replace(/\D/g, '')) || null;
        }
    }

    if (propertyType === 'Plot') {
        // Sanitize plot size to integer sqft
        if (details.plot_size) {
            details.plot_size = sanitizePlotSize(details.plot_size);
        }
        // Normalize zoning
        if (details.zoning) {
            const z = details.zoning.trim();
            const match = PLOT_ZONINGS.find(pz =>
                pz.toLowerCase().includes(z.toLowerCase()) ||
                z.toLowerCase().includes(pz.toLowerCase().split(' ')[0])
            );
            if (match) details.zoning = match;
        }
    }

    return details;
}

// ── Budget Range Normalizer ─────────────────────────────────
function normalizeBudgetRange(raw) {
    if (!raw) return null;
    const str = String(raw).trim().replace(/\s+/g, '');
    // Handle common variations
    if (/1\s*cr|100\+|1cr\+|crore/i.test(str)) return '1Cr+';
    const numMatch = str.match(/(\d+)\s*[-–to]+\s*(\d+)/);
    if (numMatch) {
        const low = parseInt(numMatch[1]);
        const high = parseInt(numMatch[2]);
        const ranges = ['20-40', '40-60', '60-80', '80-100'];
        return ranges.find(r => {
            const [rl, rh] = r.split('-').map(Number);
            return rl === low && rh === high;
        }) || null;
    }
    return ['20-40', '40-60', '60-80', '80-100', '1Cr+'].includes(str) ? str : null;
}

module.exports = {
    sanitizePhone,
    sanitizePlotSize,
    normalizeExtraDetails,
    normalizeBudgetRange
};
