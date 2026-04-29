const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

function generateDocumentNumber(prefix = 'АКТ') {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${randomPart}`;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeCategory(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/ё/g, 'е');

  if (!raw) return 'Не указана';
  if (/меб/.test(normalized)) return 'Мебель';
  if (/экс|эксп|эсп|эпск/.test(normalized)) return 'Экспонат';
  if (/инстру/.test(normalized)) return 'Инструмент';

  return raw;
}

async function getRentalDocumentData(rentalId) {
  const result = await pool.query(
    `SELECT r.id, r.client_id, r.employee_id, r.start_date, r.end_date, r.status,
            r.issuance_act_number,
            c.name AS client_name,
            e.name AS employee_name,
            COALESCE(
              json_agg(
                json_build_object(
                  'item_id', ri.item_id,
                  'item_name', COALESCE(i.name, 'Не найден'),
                  'category', COALESCE(i.category, ri.category),
                  'quantity', COALESCE(ri.quantity, 1),
                  'rent_price', ri.rent_price
                )
              ) FILTER (WHERE ri.item_id IS NOT NULL),
              '[]'::json
            ) AS items
     FROM rentals r
     LEFT JOIN clients c ON c.id = r.client_id
     LEFT JOIN employees e ON e.id = r.employee_id
     LEFT JOIN rental_items ri ON ri.rental_id = r.id
     LEFT JOIN inventory i ON i.id = ri.item_id
     WHERE r.id = $1
     GROUP BY r.id, c.name, e.name`,
    [rentalId]
  );

  if (result.rows.length === 0) {
    throw new Error('Аренда не найдена');
  }

  const rental = result.rows[0];
  const items = (rental.items || []).map(item => ({
    ...item,
    category: normalizeCategory(item.category)
  }));

  const issuanceActNumber = rental.issuance_act_number || generateDocumentNumber('АК');

  return {
    type: 'rental',
    id: rental.id,
    status: rental.status,
    client_name: rental.client_name || 'Не указан',
    employee_name: rental.employee_name || 'Не указан',
    start_date: rental.start_date,
    end_date: rental.end_date,
    startDateFormatted: formatDate(rental.start_date),
    endDateFormatted: formatDate(rental.end_date),
    items,
    documents: {
      transferActNumber: generateDocumentNumber('АКТ'),
      issuanceActNumber,
      acceptanceActNumber: generateDocumentNumber('ПРИЕМКА')
    },
    generatedAt: formatDate(new Date())
  };
}

async function getEventDocumentData(eventId) {
  const result = await pool.query(
    `SELECT e.id, e.name, e.start_date, e.end_date, e.location, e.status, e.employee_id,
            e.issuance_act_number,
            emp.name AS employee_name,
            COALESCE(
              json_agg(
                json_build_object(
                  'item_id', ei.item_id,
                  'item_name', COALESCE(i.name, 'Не найден'),
                  'category', COALESCE(i.category, ei.category),
                  'quantity', COALESCE(ei.quantity, 1),
                  'transfer_date', ei.transfer_date,
                  'return_date', ei.return_date,
                  'return_status', COALESCE(ei.return_status, 'Не возвращено')
                )
              ) FILTER (WHERE ei.item_id IS NOT NULL),
              '[]'::json
            ) AS items
     FROM events e
     LEFT JOIN employees emp ON emp.id = e.employee_id
     LEFT JOIN event_items ei ON ei.event_id = e.id
     LEFT JOIN inventory i ON i.id = ei.item_id
     WHERE e.id = $1
     GROUP BY e.id, emp.name`,
    [eventId]
  );

  if (result.rows.length === 0) {
    throw new Error('Мероприятие не найдено');
  }

  const event = result.rows[0];
  const items = (event.items || []).map(item => ({
    ...item,
    category: normalizeCategory(item.category),
    transfer_date_formatted: formatDate(item.transfer_date),
    return_date_formatted: formatDate(item.return_date)
  }));

  const issuanceActNumber = event.issuance_act_number || generateDocumentNumber('АК');

  return {
    type: 'event',
    id: event.id,
    name: event.name,
    location: event.location,
    status: event.status,
    employee_name: event.employee_name || 'Не указан',
    start_date: event.start_date,
    end_date: event.end_date,
    startDateFormatted: formatDate(event.start_date),
    endDateFormatted: formatDate(event.end_date),
    items,
    documents: {
      issuanceActNumber,
      acceptanceActNumber: generateDocumentNumber('ПРИЕМКА')
    },
    generatedAt: formatDate(new Date())
  };
}

async function sendDocumentData(res, loader) {
  try {
    const payload = await loader();
    res.json(payload);
  } catch (error) {
    const statusCode = /не найден/i.test(error.message) ? 404 : 500;
    res.status(statusCode).json({ error: error.message });
  }
}

router.get('/rentals/:rentalId', authenticate, async (req, res) => {
  await sendDocumentData(res, () => getRentalDocumentData(req.params.rentalId));
});

router.get('/rentals/:rentalId/generate', authenticate, async (req, res) => {
  await sendDocumentData(res, () => getRentalDocumentData(req.params.rentalId));
});

router.get('/events/:eventId', authenticate, async (req, res) => {
  await sendDocumentData(res, () => getEventDocumentData(req.params.eventId));
});

router.get('/events/:eventId/generate', authenticate, async (req, res) => {
  await sendDocumentData(res, () => getEventDocumentData(req.params.eventId));
});

// Обратная совместимость со старым фронтендом аренды
router.get('/generate/:rentalId', authenticate, async (req, res) => {
  await sendDocumentData(res, () => getRentalDocumentData(req.params.rentalId));
});

router.get('/:rentalId', authenticate, async (req, res) => {
  await sendDocumentData(res, () => getRentalDocumentData(req.params.rentalId));
});

module.exports = router;
