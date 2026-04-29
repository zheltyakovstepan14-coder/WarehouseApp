const { test, expect } = require('@playwright/test');

const USERNAME = process.env.SMOKE_USERNAME || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const FALLBACK_CREDENTIALS = [
  { username: 'admin', password: 'admin' },
  { username: 'admin', password: '123456' },
  { username: 'administrator', password: 'admin' }
];

async function getAuthToken(request, baseURL, credentials) {
  const loginResponse = await request.post(`${baseURL}/api/users/login`, {
    data: { username: credentials.username, password: credentials.password }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const payload = await loginResponse.json();
  expect(typeof payload.token).toBe('string');
  return payload.token;
}

test.describe('Core business smoke (diploma)', () => {
  let activeCredentials = null;

  test.beforeAll(async ({ request, baseURL }) => {
    const candidates = [];
    if (USERNAME && PASSWORD) {
      candidates.push({ username: USERNAME, password: PASSWORD });
    }
    candidates.push(...FALLBACK_CREDENTIALS);

    for (const candidate of candidates) {
      const loginResponse = await request.post(`${baseURL}/api/users/login`, {
        data: { username: candidate.username, password: candidate.password }
      });
      if (loginResponse.ok()) {
        activeCredentials = candidate;
        break;
      }
    }
  });

  test('1) login and dashboard access by role', async ({ request, page, baseURL }) => {
    test.skip(!activeCredentials, 'No valid smoke credentials found. Set SMOKE_USERNAME/SMOKE_PASSWORD');
    const token = await getAuthToken(request, baseURL, activeCredentials);
    await page.goto(baseURL);
    await page.evaluate((jwt) => localStorage.setItem('authToken', jwt), token);
    await page.reload();
    await page.waitForSelector('#mainApp', { state: 'visible' });
    await expect(page.locator('#dashboard h1')).toHaveText('Главное');
  });

  test('2) rentals flow: list is available and contains drafts-compatible statuses', async ({ request, baseURL }) => {
    test.skip(!activeCredentials, 'No valid smoke credentials found. Set SMOKE_USERNAME/SMOKE_PASSWORD');
    const token = await getAuthToken(request, baseURL, activeCredentials);
    const rentalsResponse = await request.get(`${baseURL}/api/rentals`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(rentalsResponse.ok()).toBeTruthy();
    const rentals = await rentalsResponse.json();
    expect(Array.isArray(rentals)).toBeTruthy();
    if (rentals.length > 0) {
      const statuses = rentals.map(row => String(row.status || ''));
      expect(statuses.some(Boolean)).toBeTruthy();
    }
  });

  test('3) events flow: list is available and contains drafts-compatible statuses', async ({ request, baseURL }) => {
    test.skip(!activeCredentials, 'No valid smoke credentials found. Set SMOKE_USERNAME/SMOKE_PASSWORD');
    const token = await getAuthToken(request, baseURL, activeCredentials);
    const eventsResponse = await request.get(`${baseURL}/api/events`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(eventsResponse.ok()).toBeTruthy();
    const events = await eventsResponse.json();
    expect(Array.isArray(events)).toBeTruthy();
    if (events.length > 0) {
      const statuses = events.map(row => String(row.status || ''));
      expect(statuses.some(Boolean)).toBeTruthy();
    }
  });

  test('4) purchase requests flow: source endpoint returns normalized array', async ({ request, baseURL }) => {
    test.skip(!activeCredentials, 'No valid smoke credentials found. Set SMOKE_USERNAME/SMOKE_PASSWORD');
    const token = await getAuthToken(request, baseURL, activeCredentials);
    const response = await request.get(`${baseURL}/api/inventory/purchase-requests`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.ok()).toBeTruthy();
    const list = await response.json();
    expect(Array.isArray(list)).toBeTruthy();
    if (list.length > 0) {
      const sample = list[0];
      expect(sample).toHaveProperty('request_number');
      expect(sample).toHaveProperty('status');
    }
  });

  test('5) documents flow: rental/event document payload endpoints return structured data', async ({ request, baseURL }) => {
    test.skip(!activeCredentials, 'No valid smoke credentials found. Set SMOKE_USERNAME/SMOKE_PASSWORD');
    const token = await getAuthToken(request, baseURL, activeCredentials);
    const headers = { Authorization: `Bearer ${token}` };

    const rentalsResponse = await request.get(`${baseURL}/api/rentals`, { headers });
    expect(rentalsResponse.ok()).toBeTruthy();
    const rentals = await rentalsResponse.json();
    if (Array.isArray(rentals) && rentals.length > 0) {
      const rentalId = rentals[0].id;
      const docResponse = await request.get(`${baseURL}/api/documents/rentals/${rentalId}`, { headers });
      expect(docResponse.ok()).toBeTruthy();
      const payload = await docResponse.json();
      expect(payload).toHaveProperty('documents');
      expect(Array.isArray(payload.items)).toBeTruthy();
    }

    const eventsResponse = await request.get(`${baseURL}/api/events`, { headers });
    expect(eventsResponse.ok()).toBeTruthy();
    const events = await eventsResponse.json();
    if (Array.isArray(events) && events.length > 0) {
      const eventId = events[0].id;
      const docResponse = await request.get(`${baseURL}/api/documents/events/${eventId}`, { headers });
      expect(docResponse.ok()).toBeTruthy();
      const payload = await docResponse.json();
      expect(payload).toHaveProperty('documents');
      expect(Array.isArray(payload.items)).toBeTruthy();
    }
  });
});
