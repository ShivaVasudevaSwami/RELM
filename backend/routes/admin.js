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
router.get('/users', isAdmin, async (req, res) => {
    const users = await queryAll('SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC');
    return res.json(users);
});

// GET /api/admin/users/by-role?role=agent
router.get('/users/by-role', async (req, res) => {
    const { role } = req.query;
    let sql = 'SELECT id, username, role, is_active FROM users WHERE is_active = 1';
    const params = [];
    let paramIdx = 1;
    if (role) { sql += ` AND role = $${paramIdx}`; params.push(role); paramIdx++; }
    sql += ' ORDER BY username ASC';
    const users = await queryAll(sql, params);
    return res.json(users);
});

// GET /api/admin/users/available-agents
router.get('/users/available-agents', async (req, res) => {
    const agents = await queryAll(
        `SELECT u.id, u.username, u.capacity_limit, u.performance_rating,
                COUNT(l.id) as active_leads
         FROM users u
         LEFT JOIN leads l ON l.assigned_agent = u.id
            AND l.status NOT IN ('Not Interested', 'Booking Confirmed')
         WHERE u.role = 'agent' AND u.is_active = 1
         GROUP BY u.id, u.username, u.capacity_limit, u.performance_rating
         HAVING COUNT(l.id) < COALESCE(u.capacity_limit, 5)
         ORDER BY COUNT(l.id) ASC, u.performance_rating DESC`
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
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const { username, password, role } = req.body;

        if (req.session.user.role === 'manager' && role === 'admin') {
            return res.status(403).json({ error: 'Managers cannot create Admin users. Only an Admin can create another Admin.' });
        }

        const existing = await queryOne('SELECT id FROM users WHERE username = $1', [username]);
        if (existing) return res.status(409).json({ error: 'Username already exists' });

        const passwordHash = bcrypt.hashSync(password, 10);
        const result = await runStmt('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
            [username, passwordHash, role]);
        const newUser = await queryOne('SELECT id, username, role, is_active, created_at FROM users WHERE id = $1',
            [result.lastInsertRowid]);
        return res.status(201).json({ user: newUser });
    }
);

// GET /api/admin/users/:id
router.get('/users/:id', isAdmin, async (req, res) => {
    const user = await queryOne('SELECT id, username, role, is_active, created_at FROM users WHERE id = $1',
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
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
            });
        }
        const userId = parseInt(req.params.id);
        const { username, role, password } = req.body;

        const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (userId === req.session.user.id && role !== 'admin')
            return res.status(400).json({ error: 'Cannot demote your own admin role' });

        const existing = await queryOne('SELECT id FROM users WHERE username = $1 AND id != $2', [username, userId]);
        if (existing) return res.status(409).json({ error: 'Username already exists' });

        if (password && password.trim().length > 0) {
            if (password.length < 8 || !/^(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
                return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
            }
            const passwordHash = bcrypt.hashSync(password, 10);
            await runStmt('UPDATE users SET username = $1, role = $2, password_hash = $3 WHERE id = $4',
                [username, role, passwordHash, userId]);
        } else {
            await runStmt('UPDATE users SET username = $1, role = $2 WHERE id = $3', [username, role, userId]);
        }

        const updatedUser = await queryOne('SELECT id, username, role, is_active, created_at FROM users WHERE id = $1', [userId]);
        return res.json({ user: updatedUser });
    }
);

// PATCH /api/admin/users/:id/toggle
router.patch('/users/:id/toggle', isAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId === req.session.user.id)
        return res.status(400).json({ error: 'Cannot deactivate your own account' });
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const newStatus = user.is_active === 1 ? 0 : 1;
    await runStmt('UPDATE users SET is_active = $1 WHERE id = $2', [newStatus, userId]);
    return res.json({ is_active: newStatus });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', isAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId === req.session.user.id)
        return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const activeLeads = await queryOne(
        `SELECT COUNT(*) as cnt FROM leads
         WHERE (assigned_telecaller = $1 OR assigned_agent = $2 OR created_by = $3)
         AND status NOT IN ('Not Interested', 'Booking Confirmed')`,
        [userId, userId, userId]
    );
    if (activeLeads && parseInt(activeLeads.cnt) > 0) {
        return res.status(400).json({
            error: `Cannot delete user with ${activeLeads.cnt} active leads. Use Bulk Reassign first.`,
            active_lead_count: parseInt(activeLeads.cnt)
        });
    }

    await runStmt('UPDATE leads SET created_by = NULL WHERE created_by = $1', [userId]);
    await runStmt('DELETE FROM users WHERE id = $1', [userId]);
    return res.json({ message: 'User deleted' });
});

module.exports = router;
