const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const csv = require('csv-parser');
const fs = require('fs');
const XLSX = require('xlsx');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// POST import from CSV
router.post('/import/csv', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const results = [];
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Parse CSV file
            await new Promise((resolve, reject) => {
                fs.createReadStream(req.file.path)
                    .pipe(csv())
                    .on('data', (data) => results.push(data))
                    .on('end', resolve)
                    .on('error', reject);
            });

            // Process and insert data
            for (const item of results) {
                const id = item.id || Math.random().toString(36).substring(2, 9);
                const name = item.name || item.item_name || '';
                const quantity = parseInt(item.quantity) || parseInt(item.stock) || 0;
                const category = item.category || 'Склад';
                const location = item.location || '';
                const minstock = parseInt(item.minstock) || parseInt(item.min_stock) || 0;
                const description = item.description || '';

                await client.query(`
                    INSERT INTO inventory
                    (id, name, quantity, category, location, minstock, description)
                    VALUES($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    quantity = EXCLUDED.quantity,
                    category = EXCLUDED.category,
                    location = EXCLUDED.location,
                    minstock = EXCLUDED.minstock,
                    description = EXCLUDED.description,
                    updated_at = CURRENT_TIMESTAMP
                `, [id, name, quantity, category, location, minstock, description]);
            }

            await client.query('COMMIT');
            res.json({ success: true, imported: results.length });

        } catch (err) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
            // Clean up uploaded file
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST import from Excel
router.post('/import/excel', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            for (const item of jsonData) {
                const id = item.id || item.ID || Math.random().toString(36).substring(2, 9);
                const name = item.name || item.item_name || item.Item || '';
                const quantity = parseInt(item.quantity) || parseInt(item.stock) || parseInt(item.Quantity) || 0;
                const category = item.category || item.Category || 'Склад';
                const location = item.location || item.Location || '';
                const minstock = parseInt(item.minstock) || parseInt(item.min_stock) || parseInt(item.MinStock) || 0;
                const description = item.description || item.Description || '';

                await client.query(`
                    INSERT INTO inventory
                    (id, name, quantity, category, location, minstock, description)
                    VALUES($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    quantity = EXCLUDED.quantity,
                    category = EXCLUDED.category,
                    location = EXCLUDED.location,
                    minstock = EXCLUDED.minstock,
                    description = EXCLUDED.description,
                    updated_at = CURRENT_TIMESTAMP
                `, [id, name, quantity, category, location, minstock, description]);
            }

            await client.query('COMMIT');
            res.json({ success: true, imported: jsonData.length });

        } catch (err) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
            // Clean up uploaded file
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export to CSV
router.get('/export/csv', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id, name, quantity, category, location, minstock, description
            FROM inventory
            ORDER BY category, name
        `);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        // Convert to CSV format
        const csvHeader = 'ID,Name,Quantity,Category,Location,MinStock,Description\n';
        const csvRows = result.rows.map(row =>
            `${row.id},"${row.name}",${row.quantity},"${row.category}","${row.location}",${row.minstock},"${row.description}"`
        ).join('\n');

        const csvData = csvHeader + csvRows;

        res.header('Content-Type', 'text/csv');
        res.attachment('inventory_export_' + new Date().toISOString().split('T')[0] + '.csv');
        res.send(csvData);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export to Excel
router.get('/export/excel', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id as "ID",
                name as "Name",
                quantity as "Quantity",
                category as "Category",
                location as "Location",
                minstock as "Min Stock",
                description as "Description"
            FROM inventory
            ORDER BY category, name
        `);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        // Create Excel workbook
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(result.rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');

        // Generate Excel file
        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.attachment('inventory_export_' + new Date().toISOString().split('T')[0] + '.xlsx');
        res.send(excelBuffer);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export rentals to Excel
router.get('/export/rentals/excel', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                r.id as "ID",
                r.title as "Название",
                c.name as "Арендатор",
                r.start_date as "Начало",
                r.end_date as "Окончание",
                e.name as "Ответственный",
                r.status as "Статус"
            FROM rentals r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN employees e ON r.assigned_to = e.id
            ORDER BY r.start_date DESC
        `);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(result.rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Rentals');

        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.attachment('rentals_export_' + new Date().toISOString().split('T')[0] + '.xlsx');
        res.send(excelBuffer);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export events to Excel
router.get('/export/events/excel', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                e.id as "ID",
                e.title as "Название",
                e.start_date as "Начало",
                e.end_date as "Окончание",
                e.location as "Место",
                em.name as "Ответственный",
                e.status as "Статус"
            FROM events e
            LEFT JOIN employees em ON e.assigned_to = em.id
            ORDER BY e.start_date DESC
        `);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(result.rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Events');

        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.attachment('events_export_' + new Date().toISOString().split('T')[0] + '.xlsx');
        res.send(excelBuffer);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export movement history to Excel
router.get('/export/movements/excel', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                mh.id as "ID",
                mh.operation_date as "Дата",
                i.name as "Объект",
                i.category as "Категория",
                mh.operation_type as "Операция",
                mh.quantity as "Количество",
                e.name as "Кто",
                mh.source_location as "Откуда",
                mh.destination_location as "Куда",
                d.document_type as "Тип документа"
            FROM movements_history mh
            LEFT JOIN inventory i ON mh.inventory_id = i.id
            LEFT JOIN employees e ON mh.responsible_person = e.id
            LEFT JOIN (
                SELECT id, document_type, CONCAT(document_type, ' №', document_number) as document_label
                FROM documents
            ) d ON mh.document_id = d.id
            ORDER BY mh.operation_date DESC
        `);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(result.rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'History');

        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.attachment('movements_export_' + new Date().toISOString().split('T')[0] + '.xlsx');
        res.send(excelBuffer);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;