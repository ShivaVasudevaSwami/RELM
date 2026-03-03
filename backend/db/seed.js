const bcrypt = require('bcryptjs');
const { queryOne, runStmt } = require('./database');

async function seedAdmin() {
    const userCount = queryOne('SELECT COUNT(*) as count FROM users');

    if (!userCount || userCount.count === 0) {
        const passwordHash = bcrypt.hashSync('swami@120', 10);

        runStmt(
            "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)",
            ['shiva', passwordHash]
        );

        console.log('[Seed] Default admin user "shiva" created');
    } else {
        console.log('[Seed] Users table already has data — skipping seed');
    }
}

module.exports = { seedAdmin };
