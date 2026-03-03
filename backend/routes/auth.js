const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { queryOne } = require('../db/database');

const router = express.Router();

// POST /api/auth/login
router.post('/login',
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const { username, password } = req.body;

        const user = await queryOne('SELECT * FROM users WHERE username = $1', [username]);

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        if (user.is_active === 0) {
            return res.status(403).json({ error: 'Account disabled. Contact your admin.' });
        }

        const isMatch = bcrypt.compareSync(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        return res.json({
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    }
);

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.clearCookie('connect.sid');
        return res.json({ message: 'Logged out' });
    });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ user: req.session.user });
    }
    return res.status(401).json({ error: 'Not logged in' });
});

module.exports = router;
