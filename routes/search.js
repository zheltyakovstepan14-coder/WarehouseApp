const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/global', authenticate, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.json({ results: [] });
  }

  const like = `%${query}%`;
  try {
    const [documentsResult, clientsResult, inventoryResult] = await Promise.all([
      pool.query(
        `SELECT number, basis_label, counterparty, status, doc_type, date
         FROM (
           SELECT
             ia.act_number AS number,
             CASE
               WHEN ia.source_type = 'rental' THEN CONCAT('Аренда №', ia.source_id)
               ELSE CONCAT('Мероприятие №', ia.source_id)
             END AS basis_label,
             ''::text AS counterparty,
             COALESCE(NULLIF(TRIM(ia.status), ''), 'Проведен') AS status,
             'issuance'::text AS doc_type,
             ia.created_at AS date
           FROM issuance_acts ia
           UNION ALL
           SELECT
             wa.act_number AS number,
             COALESCE(wa.basis_label, '') AS basis_label,
             COALESCE(wa.basis_name, '') AS counterparty,
             COALESCE(NULLIF(TRIM(wa.status), ''), 'Проведен') AS status,
             'writeoff'::text AS doc_type,
             wa.act_date AS date
           FROM writeoff_acts wa
         ) docs
         WHERE number ILIKE $1 OR basis_label ILIKE $1 OR counterparty ILIKE $1
         ORDER BY date DESC NULLS LAST
         LIMIT 20`,
        [like]
      ),
      pool.query(
        `SELECT id, name, phone, email
         FROM clients
         WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
         ORDER BY name
         LIMIT 20`,
        [like]
      ),
      pool.query(
        `SELECT id, name, category, status
         FROM inventory
         WHERE id ILIKE $1 OR name ILIKE $1 OR category ILIKE $1
         ORDER BY name
         LIMIT 20`,
        [like]
      )
    ]);

    const results = [
      ...documentsResult.rows.map((row) => ({
        kind: 'document',
        title: row.number || 'Документ',
        subtitle: `${row.doc_type} • ${row.basis_label || 'Без основания'}`,
        meta: row.status || '',
        payload: row
      })),
      ...clientsResult.rows.map((row) => ({
        kind: 'client',
        title: row.name || `Клиент #${row.id}`,
        subtitle: `Клиент • ${row.phone || 'без телефона'}`,
        meta: row.email || '',
        payload: row
      })),
      ...inventoryResult.rows.map((row) => ({
        kind: 'inventory',
        title: row.name || row.id,
        subtitle: `Объект • ${row.category || 'Без категории'}`,
        meta: row.status || '',
        payload: row
      }))
    ].slice(0, 40);

    return res.json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Ошибка глобального поиска' });
  }
});

module.exports = router;
