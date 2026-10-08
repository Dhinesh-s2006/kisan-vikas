const http = require('http');

async function testMutations() {
  const backend = 'http://localhost:4000';
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

  // Login
  const login = await makeRequest('POST', '/api/super-admin/login', { username: 'superadmin', password: 'kisan@123' });
  const token = login.body.token;

  console.log('Testing Super Admin mutation endpoints...');

  // 1. Content creation & update
  const testKey = 'test_notice_' + Date.now();
  const createContent = await makeRequest('POST', '/api/super-admin/content', {
    content_key: testKey,
    title: 'Automated Test Notice',
    category: 'NOTICE',
    content: 'This is an administrative test notice created during automated verification.',
    priority: 5,
    is_active: true
  }, token);
  console.log('1. Create website content:', createContent.status === 201 ? 'PASS' : 'FAIL', createContent.body?.message);

  const contentId = createContent.body?.item?.id;
  if (contentId) {
    const updateContent = await makeRequest('PUT', `/api/super-admin/content/${contentId}`, {
      title: 'Automated Test Notice (Updated)',
      category: 'NOTICE',
      content: 'Updated content body.',
      priority: 6,
      is_active: true
    }, token);
    console.log('2. Update website content:', updateContent.status === 200 ? 'PASS' : 'FAIL');

    const deleteContent = await makeRequest('DELETE', `/api/super-admin/content/${contentId}`, null, token);
    console.log('3. Delete website content:', deleteContent.status === 200 ? 'PASS' : 'FAIL');
  }

  // 4. Update system setting
  const updateSetting = await makeRequest('PUT', '/api/super-admin/settings/support_helpline', {
    setting_value: '1800-425-4444'
  }, token);
  console.log('4. Update system setting:', updateSetting.status === 200 ? 'PASS' : 'FAIL');

  // 5. Verify audit log entry was created for these mutations
  const audits = await makeRequest('GET', '/api/super-admin/audit-logs?limit=5', null, token);
  const actions = audits.body?.logs?.map(l => l.action) || [];
  console.log('5. Audit logs recorded actions:', actions);
  console.log('Mutations verification complete!');
}

testMutations();
