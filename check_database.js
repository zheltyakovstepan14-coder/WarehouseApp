const { pool } = require('./db');

async function checkDatabaseRecords() {
    console.log('Checking database records...');

    try {
        // Check inventory table
        const inventoryResult = await pool.query('SELECT * FROM inventory');
        console.log('📦 Inventory records:', inventoryResult.rows.length);
        if (inventoryResult.rows.length > 0) {
            console.log('Sample inventory records:');
            inventoryResult.rows.slice(0, 3).forEach((row, index) => {
                console.log(`${index + 1}. ${row.name} (Quantity: ${row.quantity})`);
            });
        }

        // Check rentals table
        const rentalsResult = await pool.query(`
            SELECT r.id, r.start_date, r.end_date, c.name as client_name, e.name as employee_name
            FROM rentals r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN employees e ON r.employee_id = e.id
        `);
        console.log('📋 Rentals records:', rentalsResult.rows.length);
        if (rentalsResult.rows.length > 0) {
            console.log('Sample rentals records:');
            rentalsResult.rows.slice(0, 3).forEach((row, index) => {
                console.log(`${index + 1}. ${row.client_name || 'No client'} rented by ${row.employee_name || 'No employee'} (${row.start_date} to ${row.end_date})`);
            });
        }

        // Check events table
        const eventsResult = await pool.query(`
            SELECT e.id, e.name, e.start_date, e.end_date, emp.name as employee_name
            FROM events e
            LEFT JOIN employees emp ON e.employee_id = emp.id
        `);
        console.log('🎉 Events records:', eventsResult.rows.length);
        if (eventsResult.rows.length > 0) {
            console.log('Sample events records:');
            eventsResult.rows.slice(0, 3).forEach((row, index) => {
                console.log(`${index + 1}. ${row.name} (${row.start_date} to ${row.end_date}) by ${row.employee_name || 'No employee'}`);
            });
        }

        if (inventoryResult.rows.length === 0 && rentalsResult.rows.length === 0) {
            console.log('⚠️  Database is empty - no records found in either table');
        }

    } catch (error) {
        console.error('❌ Error checking database:', error.message);
    } finally {
        await pool.end();
    }
}

checkDatabaseRecords();