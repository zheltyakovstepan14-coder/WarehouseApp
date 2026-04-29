const { pool } = require('./db');

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('Подключение к базе данных успешно!');

    // Проверяем таблицы
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('Таблицы в базе данных:');
    tables.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });

    // Проверяем пользователей
    const users = await client.query('SELECT id, username, role FROM users');
    console.log('Пользователи:');
    users.rows.forEach(user => {
      console.log(`- ${user.username} (${user.role})`);
    });

    // Проверяем клиентов
    const clients = await client.query('SELECT id, name, type FROM clients');
    console.log('Клиенты:');
    clients.rows.forEach(client => {
      console.log(`- ${client.name} (${client.type})`);
    });

    // Проверяем сотрудников
    const employees = await client.query('SELECT id, name, position FROM employees');
    console.log('Сотрудники:');
    employees.rows.forEach(employee => {
      console.log(`- ${employee.name} (${employee.position})`);
    });

    client.release();
  } catch (err) {
    console.error('Ошибка подключения к базе данных:', err);
  } finally {
    process.exit();
  }
}

testConnection();