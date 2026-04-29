const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

// Получить сотрудника по ID
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сотрудник не найден.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить список сотрудников
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Добавить сотрудника
router.post('/', authenticate, async (req, res) => {
  const { name, position, phone, email, hire_date, active } = req.body;
  try {
    const query = `
      INSERT INTO employees (name, position, phone, email, hire_date, active)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
    `;
    const values = [name, position, phone, email, hire_date, active !== undefined ? active : true];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Редактировать сотрудника
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, position, phone, email, hire_date, active } = req.body;
  try {
    const query = `
      UPDATE employees
      SET name = $1, position = $2, phone = $3, email = $4, hire_date = $5, active = $6
      WHERE id = $7 RETURNING *;
    `;
    const values = [name, position, phone, email, hire_date, active, id];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить сотрудника
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    // Проверка на активные аренды
    const activeRentals = await pool.query('SELECT * FROM rentals WHERE employee_id = $1 AND status != $2', [id, 'Завершена']);
    if (activeRentals.rows.length > 0) {
      return res.status(400).json({ error: 'Невозможно удалить сотрудника с активными арендами.' });
    }

    const query = 'DELETE FROM employees WHERE id = $1';
    await pool.query(query, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;