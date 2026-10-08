const http = require('http');

async function testSuperAdmin() {
  const backend = 'http://localhost:4000';
  console.log('Testing Super Admin API endpoints against', backend);

  function makeRequest(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(backend + path);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. Unauthenticated request to /overview -> 401
    const unauth = await makeRequest('GET', '/api/super-admin/overview');
    console.log('1. Unauthenticated /overview check:', unauth.status === 401 ? 'PASS (401)' : `FAIL (${unauth.status})`);

    // 2. Non-admin login -> 403
    const nonAdmin = await makeRequest('POST', '/api/super-admin/login', { username: 'officer_thanjavur', password: 'kisan@123' });
    console.log('2. Non-admin user login rejection:', nonAdmin.status === 403 ? 'PASS (403 Forbidden)' : `FAIL (${nonAdmin.status})`);

    // 3. Super Admin login -> 200 + token
    const login = await makeRequest('POST', '/api/super-admin/login', { username: 'superadmin', password: 'kisan@123' });
    console.log('3. Super Admin login:', login.status === 200 ? 'PASS (200 OK)' : `FAIL (${login.status})`, login.body?.message);
    const token = login.body?.token;

    if (!token) {
      console.error('No token received!');
      return;
    }

    // 4. Overview metrics
    const overview = await makeRequest('GET', '/api/super-admin/overview', null, token);
    console.log('4. Overview metrics:', overview.status === 200 ? 'PASS' : 'FAIL', overview.body?.metrics ? {
      farmers: overview.body.metrics.totalFarmers,
      centres: overview.body.metrics.totalCentres,
      openCentres: overview.body.metrics.openCentres,
      bookings: overview.body.metrics.totalBookings
    } : 'No metrics');

    // 5. Farmers list
    const farmers = await makeRequest('GET', '/api/super-admin/farmers?limit=5', null, token);
    console.log('5. Farmers list:', farmers.status === 200 ? `PASS (${farmers.body.farmers.length} farmers, total: ${farmers.body.total})` : 'FAIL');

    // 6. Users list (ensure no password_hash)
    const users = await makeRequest('GET', '/api/super-admin/users?limit=5', null, token);
    const hasPasswordHash = users.body.users?.some(u => 'password_hash' in u);
    console.log('6. Users list (no password_hash exposed):', users.status === 200 && !hasPasswordHash ? `PASS (found ${users.body.users.length} users, passwords hidden)` : 'FAIL');

    // 7. Centres list
    const centres = await makeRequest('GET', '/api/super-admin/centres?limit=5', null, token);
    console.log('7. Centres list:', centres.status === 200 ? `PASS (${centres.body.centres.length} centres, total: ${centres.body.total})` : 'FAIL');

    // 8. Slots list
    const slots = await makeRequest('GET', '/api/super-admin/slots?limit=5', null, token);
    console.log('8. Slots list:', slots.status === 200 ? `PASS (${slots.body.slots.length} slots)` : 'FAIL');

    // 9. Bookings list
    const bookings = await makeRequest('GET', '/api/super-admin/bookings?limit=5', null, token);
    console.log('9. Bookings list:', bookings.status === 200 ? `PASS (${bookings.body.bookings.length} bookings, total: ${bookings.body.total})` : 'FAIL');

    // 10. Content & Settings
    const content = await makeRequest('GET', '/api/super-admin/content', null, token);
    const settings = await makeRequest('GET', '/api/super-admin/settings', null, token);
    console.log('10. Content & Settings:', content.status === 200 && settings.status === 200 ? `PASS (${content.body.content.length} content items, ${settings.body.settings.length} settings)` : 'FAIL');

    // 11. Audit logs
    const audits = await makeRequest('GET', '/api/super-admin/audit-logs?limit=5', null, token);
    console.log('11. Audit logs:', audits.status === 200 ? `PASS (${audits.body.logs.length} logs recorded)` : 'FAIL');

  } catch (err) {
    console.log('Note: Backend server might not be running on port 4000 right now. Error:', err.message);
  }
}

testSuperAdmin();
