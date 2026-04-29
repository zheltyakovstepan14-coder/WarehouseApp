const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticate, secret } = require('../middleware/auth');
const { config } = require('../config/app-config');

async function isAdminExists() {
  const result = await pool.query("SELECT count(*) AS cnt FROM users WHERE role = 'admin'");
  return parseInt(result.rows[0].cnt, 10) > 0;
}

async function isFirstAdmin() {
  return !(await isAdminExists());
}

function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Требуются права администратора' });
}

function buildTempPassword() {
  return `Temp${Math.random().toString(36).slice(2, 8)}!`;
}

// register first user (если база пуста)
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isFirstAdmin())) {
      return res.status(403).json({ error: 'Регистрация новых пользователей возможна только администратором' });
    }

    const hashed = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role, active) VALUES ($1, $2, $3, $4)', [username, hashed, 'admin', true]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (user.active === false) {
      return res.status(403).json({ error: 'Пользователь деактивирован. Вход запрещён.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      secret,
      { expiresIn: config.auth.tokenExpiresIn }
    );
    res.json({
      token,
      id: user.id,
      user_id: user.id,
      role: user.role,
      username: user.username,
      active: user.active,
      permissions: user.custom_permissions || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify token
router.get('/verify', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// admin creates new user
router.post('/create', authenticate, isAdmin, async (req, res) => {
  const { username, password, role, active = true } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password, role, active, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [username.trim(), hashed, role, active !== false]
    );
    res.json({ success: true });
  } catch (err) {
    const status = err.code === '23505' ? 409 : 500;
    res.status(status).json({ error: err.code === '23505' ? 'Пользователь с таким именем уже существует' : err.message });
  }
});

// admin gets users list
router.get('/', authenticate, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, active, last_login, custom_permissions AS permissions FROM users ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, password, role, active } = req.body;
  const hasPermissionsField = Object.prototype.hasOwnProperty.call(req.body, 'permissions');

  if (!username || !role) {
    return res.status(400).json({ error: 'Имя пользователя и роль обязательны' });
  }

  try {
    const currentResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const currentUser = currentResult.rows[0];
    const isSelf = Number(req.user.id) === Number(id);

    if (isSelf && active === false) {
      return res.status(400).json({ error: 'Нельзя деактивировать собственную учетную запись администратора' });
    }

    if (isSelf && req.user.role === 'admin' && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя снять с себя роль администратора' });
    }

    const nextPassword = password ? await bcrypt.hash(password, 10) : currentUser.password;
    const nextPermissions = hasPermissionsField ? (req.body.permissions || null) : currentUser.custom_permissions;

    await pool.query(
      `UPDATE users
       SET username = $1,
           password = $2,
           role = $3,
           active = $4,
           custom_permissions = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [username.trim(), nextPassword, role, active !== false, nextPermissions, id]
    );

    res.json({ success: true });
  } catch (err) {
    const status = err.code === '23505' ? 409 : 500;
    res.status(status).json({ error: err.code === '23505' ? 'Пользователь с таким именем уже существует' : err.message });
  }
});

router.post('/:id/reset-password', authenticate, isAdmin, async (req, res) => {
  const { id } = req.params;
  const tempPassword = String(req.body.password || buildTempPassword());

  try {
    const hashed = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
      [hashed, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ success: true, temporaryPassword: tempPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (Number(req.user.id) === Number(id)) {
      return res.status(400).json({ error: 'Нельзя удалить собственную учетную запись' });
    }

    const targetResult = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (targetResult.rows[0].role === 'admin') {
      const adminsResult = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND active = TRUE");
      if (Number(adminsResult.rows[0].cnt) <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего активного администратора' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
