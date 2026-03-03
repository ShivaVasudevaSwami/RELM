const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, runStmt } = require('../db/database');
const isAuthenticated = require('../middleware/isAuthenticated');
const isAdmin = require('../middleware/isAdmin');
const isAdminOrManager = require('../middleware/isAdminOrManager');

const router = express.Router();
router.use(isAuthenticated);

// GET /api/admin/users
router.get('/users', isAdmin, (req, res) => {
    const users = queryAll('SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC');
    return res.json(users);
});

// GET /api/admin/users/by-role?role=agent — accessible by any authenticated user
router.get('/users/by-role', (req, res) => {
    const { role } = req.query;
    let sql = 'SELECT id, username, role, is_active FROM users WHERE is_active = 1';
    const params = [];
    if (role) { sql += ' AND role = ?'; params.push(role); }
    sql += ' ORDER BY username ASC';
    return res.json(queryAll(sql, params));
});

// GET /api/admin/users/available-agents — agents under their capacity_limit
router.get('/users/available-agents', (req, res) => {
    const agents = queryAll(
        `SELECT u.id, u.username, u.capacity_limit, u.performance_rating,
                COUNT(l.id) as active_leads
         FROM users u
         LEFT JOIN leads l ON l.assigned_agent = u.id
            AND l.status NOT IN ('Not Interested', 'Booking Confirmed')
         WHERE u.role = 'agent' AND u.is_active = 1
         GROUP BY u.id
         HAVING active_leads < COALESCE(u.capacity_limit, 5)
         ORDER BY active_leads ASC, u.performance_rating DESC`
    );
    return res.json(agents);
});

// POST /api/admin/users
router.post('/users', isAdminOrManager,
    body('username').isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username must be 3–30 characters (letters, numbers, underscores only)'),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[A-Za-z])(?=.*\d)/)
        .withMessage('Password must be at least 8 characters with letters and numbers'),
    body('role').isIn(['telecaller', 'agent', 'manager', 'admin'])
        .withMessage('Role must be telecaller, agent, manager, or admin'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const { username, password, role } = req.body;

        // Manager cannot create Admins
        if (req.session.user.role === 'manager' && role === 'admin') {
            return res.status(403).json({ error: 'Managers cannot create Admin users. Only an Admin can create another Admin.' });
        }

        const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) return res.status(409).json({ error: 'Username already exists' });

        const passwordHash = bcrypt.hashSync(password, 10);
        const result = runStmt('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            [username, passwordHash, role]);
        const newUser = queryOne('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?',
            [result.lastInsertRowid]);
        return res.status(201).json({ user: newUser });
    }
);

// GET /api/admin/users/:id
router.get('/users/:id', isAdmin, (req, res) => {
    const user = queryOne('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?',
        [parseInt(req.params.id)]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', isAdmin,
    body('username').isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username must be 3–30 characters (letters, numbers, underscores only)'),
    body('role').isIn(['telecaller', 'agent', 'manager', 'admin'])
        .withMessage('Role must be telecaller, agent, manager, or admin'),
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const userId = parseInt(req.params.id);
        const { username, role, password } = req.body;

        const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (userId === req.session.user.id && role !== 'admin')
            return res.status(400).json({ error: 'Cannot demote your own admin role' });

        const existing = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
        if (existing) return res.status(409).json({ error: 'Username already exists' });

        if (password && password.trim().length > 0) {
            if (password.length < 8 || !/^(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
                return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
            }
            const passwordHash = bcrypt.hashSync(password, 10);
            runStmt('UPDATE users SET username = ?, role = ?, password_hash = ? WHERE id = ?',
                [username, role, passwordHash, userId]);
        } else {
            runStmt('UPDATE users SET username = ?, role = ? WHERE id = ?', [username, role, userId]);
        }

        const updatedUser = queryOne('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?', [userId]);
        return res.json({ user: updatedUser });
    }
);

// PATCH /api/admin/users/:id/toggle
router.patch('/users/:id/toggle', isAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId === req.session.user.id)
        return res.status(400).json({ error: 'Cannot deactivate your own account' });
    const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const newStatus = user.is_active === 1 ? 0 : 1;
    runStmt('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);
    return res.json({ is_active: newStatus });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', isAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId === req.session.user.id)
        return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Deletion Protection: block if user has active leads assigned
    const activeLeads = queryOne(
        `SELECT COUNT(*) as cnt FROM leads
         WHERE (assigned_telecaller = ? OR assigned_agent = ? OR created_by = ?)
         AND status NOT IN ('Not Interested', 'Booking Confirmed')`,
        [userId, userId, userId]
    );
    if (activeLeads && activeLeads.cnt > 0) {
        return res.status(400).json({
            error: `Cannot delete user with ${activeLeads.cnt} active leads. Use Bulk Reassign first.`,
            active_lead_count: activeLeads.cnt
        });
    }

    runStmt('UPDATE leads SET created_by = NULL WHERE created_by = ?', [userId]);
    runStmt('DELETE FROM users WHERE id = ?', [userId]);
    return res.json({ message: 'User deleted' });
});

module.exports = router;
