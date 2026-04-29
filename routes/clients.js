const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

// Получить клиента по ID
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить список клиентов
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Добавить клиента
router.post('/', authenticate, async (req, res) => {
  const { name, phone, email, address, inn, type } = req.body;
  try {
    const query = `
      INSERT INTO clients (name, phone, email, address, inn, type)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
    `;
    const values = [name, phone, email, address, inn, type];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Редактировать клиента
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, inn, type } = req.body;
  try {
    const query = `
      UPDATE clients
      SET name = $1, phone = $2, email = $3, address = $4, inn = $5, type = $6
      WHERE id = $7 RETURNING *;
    `;
    const values = [name, phone, email, address, inn, type, id];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить клиента
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    // Проверка на активные аренды
    const activeRentals = await pool.query('SELECT * FROM rentals WHERE client_id = $1 AND status != $2', [id, 'Завершена']);
    if (activeRentals.rows.length > 0) {
      return res.status(400).json({ error: 'Невозможно удалить клиента с активными арендами.' });
    }

    const query = 'DELETE FROM clients WHERE id = $1';
    await pool.query(query, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Поиск клиентов
router.get('/search/:query', authenticate, async (req, res) => {
  const { query } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM clients WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1',
      [`%${query}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;