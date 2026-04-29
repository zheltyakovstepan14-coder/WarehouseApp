const { pool } = require('./db');
const bcrypt = require('bcrypt');

async function checkAndCreateAdmin() {
  try {
    // Проверяем, есть ли пользователи
    const result = await pool.query('SELECT * FROM users');
    console.log('Текущие пользователи:', result.rows.map(u => ({ id: u.id, username: u.username, role: u.role })));

    // Создаем тестового пользователя, если его нет
    const testUser = result.rows.find(u => u.username === 'test');
    if (!testUser) {
      console.log('Создаем тестового пользователя...');
      const hashedPassword = await bcrypt.hash('test123', 10);
      await pool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['test', hashedPassword, 'Кладовщик']);
      console.log('Тестовый пользователь создан. Логин: test, Пароль: test123');
    } else {
      console.log('Тестовый пользователь уже существует');
    }
  } catch (err) {
    console.error('Ошибка:', err);
  } finally {
    process.exit();
  }
}

checkAndCreateAdmin();