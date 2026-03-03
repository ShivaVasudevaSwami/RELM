const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const { recalculateAndSave } = require('../services/scoringEngine');

// Multer config
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
    dest: uploadsDir,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('Only .csv, .xlsx and .xls files are allowed'));
        }
    }
});

// Valid values
const VALID_PROPERTY_TYPES = ['Flat', 'Villa', 'Plot'];
const VALID_BUDGET_RANGES = ['20-40', '40-60', '60-80', '80-100', '1Cr+'];
const VALID_FUNDING = ['Self-Funded', 'Home Loan'];
const VALID_URGENCY = ['Immediate', '3 Months', '1 Year'];
const VALID_OCCUPATIONS = ['Salaried', 'Business', 'Professional', 'Retired'];
const VALID_PURPOSES = ['Self-Use', 'Investment'];
const PHONE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const norm = (val) => (val !== undefined && val !== null) ? String(val).trim() : '';

const normalizePropertyType = (raw) => {
    if (!raw) return null;
    const lower = raw.toLowerCase().trim();
    const map = { flat: 'Flat', villa: 'Villa', plot: 'Plot', apartment: 'Flat' };
    return map[lower] || (VALID_PROPERTY_TYPES.includes(raw) ? raw : null);
};

const buildExtraDetails = (propType, bhkOrConfig, sizeOrFloor, extraSpec) => {
    if (!propType) return null;
    if (propType === 'Flat') {
        return JSON.stringify({ bhk_config: bhkOrConfig || '', floor_pref: sizeOrFloor || '', furnishing: extraSpec || '' });
    }
    if (propType === 'Villa') {
        return JSON.stringify({ configuration: bhkOrConfig || '', private_garden: (extraSpec || '').toLowerCase() === 'yes', parking: parseInt(sizeOrFloor) || 1 });
    }
    if (propType === 'Plot') {
        return JSON.stringify({ plot_size: sizeOrFloor || '', zoning: bhkOrConfig || '', road_width: extraSpec || '' });
    }
    return null;
};

const validateRow = (row, index) => {
    const errors = [];
    const warnings = [];

    const name = norm(row['Name'] || row['Full Name'] || row['name'] || row['NAME']);
    const phone = norm(
        row['Phone'] || row['Phone Number'] || row['phone'] || row['PHONE'] || row['Mobile']
    ).replace(/\D/g, '');
    const email = norm(row['Email'] || row['Email Address'] || row['email'] || row['EMAIL']);
    const rawType = norm(row['Property Type'] || row['Preferred Property Type'] || row['property_type'] || row['Type']);
    const state = norm(row['State'] || row['Preferred State'] || row['state']);
    const city = norm(row['City'] || row['Preferred City'] || row['city']);
    const area = norm(row['Area'] || row['Preferred Area'] || row['area']);
    const budgetRange = norm(row['Budget Range'] || row['budget_range'] || row['Budget']);
    const funding = norm(row['Funding Source'] || row['funding_source'] || row['Funding']);
    const urgency = norm(row['Urgency'] || row['Timeline to Buy'] || row['urgency'] || row['Timeline']);
    const occupation = norm(row['Occupation'] || row['occupation']);
    const purchasePurpose = norm(row['Purchase Purpose'] || row['purchase_purpose']);
    const bhkOrConfig = norm(row['BHK_or_Config'] || row['BHK'] || row['Config']);
    const sizeOrFloor = norm(row['Size_or_Floor'] || row['Floor'] || row['Size']);
    const extraSpec = norm(row['Extra_Spec'] || row['Extra'] || row['Spec']);

    const propertyType = normalizePropertyType(rawType);

    if (!name || name.length < 2) errors.push('Name is required (min 2 characters)');
    if (!phone || !PHONE_REGEX.test(phone)) errors.push('Valid 10-digit Indian phone number required');
    if (email && !EMAIL_REGEX.test(email)) warnings.push('Email format looks invalid — will be skipped');
    if (rawType && !propertyType)
        warnings.push(`Property Type "${rawType}" not recognized — use Flat/Villa/Plot`);
    if (budgetRange && !VALID_BUDGET_RANGES.includes(budgetRange))
        warnings.push(`Budget Range "${budgetRange}" not recognized — use 20-40/40-60/60-80/80-100/1Cr+`);
    if (funding && !VALID_FUNDING.includes(funding))
        warnings.push(`Funding "${funding}" not recognized — use Self-Funded/Home Loan`);
    if (urgency && !VALID_URGENCY.includes(urgency))
        warnings.push(`Urgency "${urgency}" not recognized — use Immediate/3 Months/1 Year`);
    if (occupation && !VALID_OCCUPATIONS.includes(occupation))
        warnings.push(`Occupation "${occupation}" not recognized — use Salaried/Business/Professional/Retired`);
    if (purchasePurpose && !VALID_PURPOSES.includes(purchasePurpose))
        warnings.push(`Purchase Purpose "${purchasePurpose}" not recognized — use Self-Use/Investment`);

    const extraDetails = buildExtraDetails(propertyType, bhkOrConfig, sizeOrFloor, extraSpec);

    return {
        rowIndex: index + 2,
        name, phone,
        email: email && EMAIL_REGEX.test(email) ? email : null,
        preferred_property_type: propertyType || null,
        preferred_state: state || null,
        preferred_city: city || null,
        preferred_area: area || null,
        budget_range: VALID_BUDGET_RANGES.includes(budgetRange) ? budgetRange : null,
        funding_source: VALID_FUNDING.includes(funding) ? funding : null,
        urgency: VALID_URGENCY.includes(urgency) ? urgency : null,
        occupation: VALID_OCCUPATIONS.includes(occupation) ? occupation : null,
        purchase_purpose: VALID_PURPOSES.includes(purchasePurpose) ? purchasePurpose : null,
        extra_details: extraDetails,
        isValid: errors.length === 0,
        errors, warnings
    };
};

// POST /api/import/preview
router.post('/preview', isAuthenticated, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

        if (rows.length === 0) return res.status(400).json({ error: 'File is empty or has no data rows' });
        if (rows.length > 500) return res.status(400).json({ error: 'File has too many rows. Maximum 500 leads per import.' });

        const validated = rows.map((row, i) => validateRow(row, i));

        let duplicateCount = 0;
        for (const row of validated) {
            if (!row.phone || !row.isValid) continue;
            const existing = await queryOne(
                'SELECT id, name, status, is_vip, assigned_agent FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
                [row.phone]
            );
            if (existing) {
                row.isDuplicate = true;
                row.existingLeadId = existing.id;
                row.existingLeadName = existing.name;
                row.existingLeadStatus = existing.status;
                if (existing.is_vip) {
                    row.isVip = true;
                    row.previousAgentId = existing.assigned_agent;
                    row.warnings.push(`⭐ VIP lead — will trigger new Inquiry Session & notify Agent #${existing.assigned_agent || 'N/A'}`);
                } else if (['Not Interested', 'Booking Confirmed'].includes(existing.status)) {
                    row.warnings.push(`Re-inquiry — previous lead #${existing.id} was "${existing.status}"`);
                } else {
                    row.warnings.push(`Active duplicate — Lead #${existing.id} (${existing.name}) is "${existing.status}"`);
                }
                duplicateCount++;
            }
        }

        const validCount = validated.filter(r => r.isValid).length;
        const invalidCount = validated.filter(r => !r.isValid).length;

        return res.json({
            total: rows.length,
            valid: validCount,
            invalid: invalidCount,
            duplicates: duplicateCount,
            rows: validated,
            headers: Object.keys(rows[0] || {})
        });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        }
        console.error('Preview error:', err);
        return res.status(500).json({ error: 'Failed to parse file: ' + err.message });
    }
});

// POST /api/import/confirm
router.post('/confirm', isAuthenticated, async (req, res) => {
    try {
        const { rows } = req.body;
        const userId = req.session.user.id;

        if (!Array.isArray(rows) || rows.length === 0)
            return res.status(400).json({ error: 'No rows to import' });

        const validRows = rows.filter(r => r.isValid);
        if (validRows.length === 0)
            return res.status(400).json({ error: 'No valid rows to import' });

        const results = { imported: 0, skipped: 0, duplicates: 0, details: [] };

        for (const row of validRows) {
            const existing = await queryOne(
                'SELECT id, status FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
                [row.phone]
            );

            if (existing && existing.status !== 'Not Interested' && existing.status !== 'Booking Confirmed') {
                results.duplicates++;
                results.details.push({
                    phone: row.phone, name: row.name, status: 'skipped',
                    reason: `Duplicate — active lead exists (Lead #${existing.id})`
                });
                continue;
            }

            try {
                const result = await runStmt(
                    `INSERT INTO leads (name, phone, email, preferred_property_type,
                     preferred_state, preferred_city, preferred_area,
                     budget_range, funding_source, urgency,
                     occupation, purchase_purpose, extra_details,
                     status, ml_status, created_by, inquiry_count)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'New Inquiry', 'Cold', $14, 1)`,
                    [row.name, row.phone, row.email,
                    row.preferred_property_type, row.preferred_state,
                    row.preferred_city, row.preferred_area,
                    row.budget_range, row.funding_source, row.urgency,
                    row.occupation, row.purchase_purpose, row.extra_details,
                        userId]
                );

                try { await recalculateAndSave(result.lastInsertRowid, null); } catch (e) { /* non-blocking */ }

                results.imported++;
                results.details.push({
                    phone: row.phone, name: row.name, status: 'imported',
                    id: result.lastInsertRowid
                });
            } catch (insertErr) {
                results.skipped++;
                results.details.push({
                    phone: row.phone, name: row.name, status: 'error',
                    reason: insertErr.message
                });
            }
        }

        return res.json(results);
    } catch (err) {
        console.error('Import confirm error:', err);
        return res.status(500).json({ error: 'Import failed: ' + err.message });
    }
});

// GET /api/import/template
router.get('/template', isAuthenticated, (req, res) => {
    const headers = [
        'Full Name', 'Phone Number', 'Email Address',
        'Occupation', 'Purchase Purpose',
        'Preferred Property Type', 'Preferred State', 'Preferred City', 'Preferred Area',
        'Budget Range', 'Funding Source', 'Timeline to Buy',
        'BHK_or_Config', 'Size_or_Floor', 'Extra_Spec'
    ];
    const sampleRows = [
        ['Rahul Sharma', '9876543210', 'rahul@email.com',
            'Salaried', 'Self-Use',
            'Flat', 'Maharashtra', 'Mumbai', 'Andheri',
            '40-60', 'Home Loan', 'Immediate',
            '2 BHK', 'Mid (5-10)', 'Semi-Furnished'],
        ['Priya Patel', '8765432109', 'priya@email.com',
            'Business', 'Investment',
            'Villa', 'Gujarat', 'Ahmedabad', 'Satellite',
            '1Cr+', 'Self-Funded', '3 Months',
            '4 BHK Villa', '2', 'Yes'],
        ['Amit Kumar', '7654321098', '',
            'Professional', 'Self-Use',
            'Plot', 'Karnataka', 'Bangalore', 'Whitefield',
            '20-40', 'Home Loan', '1 Year',
            'Residential', '1200', '30']
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
    ws['!cols'] = headers.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Leads Template');

    const guideHeaders = ['Column Name', 'Required', 'Valid Values', 'Notes'];
    const guideRows = [
        ['Full Name', 'Yes', '2–60 characters', 'Letters and spaces only'],
        ['Phone Number', 'Yes', '10-digit starting with 6-9', 'Indian mobile number'],
        ['Email Address', 'No', 'Valid email format', 'Optional'],
        ['Occupation', 'No', 'Salaried / Business / Professional / Retired', 'Boosts scoring accuracy'],
        ['Purchase Purpose', 'No', 'Self-Use / Investment', 'Boosts scoring accuracy'],
        ['Preferred Property Type', 'No', 'Flat / Villa / Plot', 'Enables spec matching'],
        ['Preferred State', 'No', 'Any Indian state', ''],
        ['Preferred City', 'No', 'Any city', ''],
        ['Preferred Area', 'No', 'Locality name', ''],
        ['Budget Range', 'No', '20-40 / 40-60 / 60-80 / 80-100 / 1Cr+', 'Lakhs INR. Exact match required'],
        ['Funding Source', 'No', 'Self-Funded / Home Loan', ''],
        ['Timeline to Buy', 'No', 'Immediate / 3 Months / 1 Year', ''],
        ['BHK_or_Config', 'No', 'Flat: 1/2/3/4+ BHK | Villa: 3/4/5+ BHK Villa | Plot: Zoning type', 'Maps to extra_details'],
        ['Size_or_Floor', 'No', 'Flat: Floor pref | Villa: Parking slots | Plot: Size in sq.ft', 'Maps to extra_details'],
        ['Extra_Spec', 'No', 'Flat: Furnishing | Villa: Garden Yes/No | Plot: Road width', 'Maps to extra_details'],
    ];
    const guideWs = XLSX.utils.aoa_to_sheet([guideHeaders, ...guideRows]);
    guideWs['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 45 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, guideWs, 'Field Guide');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="RE-LM_v4.1_Import_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(Buffer.from(buffer));
});

module.exports = router;
