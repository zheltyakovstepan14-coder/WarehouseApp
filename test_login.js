const fetch = require('node-fetch');

async function testLogin() {
  try {
    const response = await fetch('http://localhost:3001/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', password: 'test123' })
    });

    const data = await response.json();
    console.log('Статус ответа:', response.status);
    console.log('Данные ответа:', data);

    if (response.ok && data.token) {
      console.log('Вход успешен!');
    } else {
      console.log('Вход не удался:', data.error);
    }
  } catch (err) {
    console.error('Ошибка:', err);
  }
}

testLogin();