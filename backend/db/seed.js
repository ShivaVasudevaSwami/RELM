const bcrypt = require('bcryptjs');
const { queryOne, runStmt } = require('./database');

async function seedAdmin() {
    const userCount = await queryOne('SELECT COUNT(*) as count FROM users');

    if (!userCount || parseInt(userCount.count) === 0) {
        const passwordHash = bcrypt.hashSync('swami@120', 10);

        await runStmt(
            "INSERT INTO users (username, password_hash, role, is_active) VALUES ($1, $2, 'admin', 1)",
            ['shiva', passwordHash]
        );

        console.log('[Seed] Default admin user "shiva" created');
    } else {
        console.log('[Seed] Users table already has data — skipping seed');
    }
}

module.exports = { seedAdmin };
