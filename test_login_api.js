// Тест логина
const fetch = require('node-fetch');

async function testLogin() {
    console.log('Тестируем логин...');

    const response = await fetch('http://localhost:3002/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', password: 'test123' })
    });

    console.log('Статус ответа:', response.status);
    const data = await response.json();
    console.log('Данные ответа:', data);

    if (response.ok && data.token) {
        console.log('✅ Логин успешен!');
    } else {
        console.log('❌ Логин не удался:', data.error);
    }
}

testLogin().catch(console.error);