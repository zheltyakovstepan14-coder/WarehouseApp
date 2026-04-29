const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { config } = require('../config/app-config');

const secret = config.auth.jwtSecret;

if (!secret) {
  throw new Error('Missing required environment variable: JWT_SECRET');
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid Authorization header' });

  jwt.verify(token, secret, async (err, payload) => {
    if (err) return res.status(403).json({ error: 'Token invalid or expired' });

    try {
      const result = await pool.query('SELECT id, username, role, active, custom_permissions AS permissions FROM users WHERE id = $1', [payload.id]);
      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Пользователь не найден' });
      }

      const user = result.rows[0];
      if (user.active === false) {
        return res.status(403).json({ error: 'Учетная запись деактивирована' });
      }

      req.user = { id: user.id, username: user.username, role: user.role, active: user.active, permissions: user.permissions || null };
      next();
    } catch (dbError) {
      return res.status(500).json({ error: dbError.message });
    }
  });
}

module.exports = { authenticate, secret };
