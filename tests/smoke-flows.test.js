/* eslint-disable no-console */
const BASE_URL = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
const USERNAME = process.env.SMOKE_USERNAME || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

async function run() {
  console.log(`[smoke] Base URL: ${BASE_URL}`);

  // 1) Health check
  let health;
  try {
    health = await api('/api/health');
  } catch (error) {
    if (process.env.SMOKE_REQUIRE_SERVER === '1') {
      throw new Error(`Server is unavailable at ${BASE_URL}: ${error.message}`);
    }
    console.log(`[smoke] server is unavailable at ${BASE_URL}, smoke skipped`);
    console.log('[smoke] set SMOKE_REQUIRE_SERVER=1 to treat this as failure');
    return;
  }
  assert(health.ok, `Health check failed: ${health.status}`);
  assert(health.body?.ok === true, 'Health payload does not contain ok=true');
  console.log('[smoke] health: OK');

  if (!USERNAME || !PASSWORD) {
    console.log('[smoke] credentials are not set, authenticated checks skipped');
    console.log('[smoke] set SMOKE_USERNAME and SMOKE_PASSWORD to run full smoke flow');
    return;
  }

  // 2) Login
  const login = await api('/api/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  });
  assert(login.ok, `Login failed: ${login.status} ${JSON.stringify(login.body)}`);
  assert(typeof login.body?.token === 'string' && login.body.token.length > 10, 'Login response missing token');
  const token = login.body.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log('[smoke] login: OK');

  // 3) Inventory
  const inventory = await api('/api/inventory', { headers: authHeaders });
  assert(inventory.ok, `Inventory request failed: ${inventory.status}`);
  assert(Array.isArray(inventory.body), 'Inventory response is not an array');
  console.log(`[smoke] inventory: OK (${inventory.body.length} rows)`);

  // 4) Rentals + Events
  const [rentals, events] = await Promise.all([
    api('/api/rentals', { headers: authHeaders }),
    api('/api/events', { headers: authHeaders })
  ]);
  assert(rentals.ok, `Rentals request failed: ${rentals.status}`);
  assert(events.ok, `Events request failed: ${events.status}`);
  assert(Array.isArray(rentals.body), 'Rentals response is not an array');
  assert(Array.isArray(events.body), 'Events response is not an array');
  console.log(`[smoke] rentals/events: OK (${rentals.body.length}/${events.body.length})`);

  // 5) Purchase requests (single source endpoint)
  const purchaseRequests = await api('/api/inventory/purchase-requests', { headers: authHeaders });
  assert(purchaseRequests.ok, `Purchase requests failed: ${purchaseRequests.status}`);
  assert(Array.isArray(purchaseRequests.body), 'Purchase requests response is not an array');
  console.log(`[smoke] purchase-requests: OK (${purchaseRequests.body.length} rows)`);
}

run()
  .then(() => {
    console.log('[smoke] completed');
  })
  .catch((error) => {
    console.error('[smoke] failed:', error.message);
    process.exit(1);
  });
