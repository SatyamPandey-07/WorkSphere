import request from 'supertest';
// Assuming your Next.js app or custom server instance can be imported, 
// or you can point supertest to your app/server entry point.
import app from '@/app'; // Adjust import based on your server setup (e.g., server.ts or Next.js handler)

describe('CSRF Protection Lifecycle Integration Tests', () => {
  let csrfToken: string;
  let csrfCookie: string;

  // 1. GET /api/auth/csrf-token returns a valid token and sets the __Host-csrf-token cookie
  test('GET /api/auth/csrf-token returns a valid token and sets the __Host-csrf-token cookie', async () => {
    const response = await request(app)
      .get('/api/auth/csrf-token')
      .expect(200);

    expect(response.body).toHaveProperty('csrfToken');
    csrfToken = response.body.csrfToken;
    expect(typeof csrfToken).toBe('string');
    expect(csrfToken.length).toBeGreaterThan(0);

    // Verify cookie is set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    
    const hostCookie = cookies.find((c: string) => c.startsWith('__Host-csrf-token='));
    expect(hostCookie).toBeDefined();
    
    // Extract cookie value for subsequent requests
    csrfCookie = hostCookie.split(';')[0];
  });

  // 2. POST requests to protected routes without x-csrf-token return 403 Forbidden
  test('POST requests to protected routes without x-csrf-token return 403 Forbidden', async () => {
    const response = await request(app)
      .post('/api/protected-route')
      .set('Cookie', [csrfCookie])
      .send({ data: 'test-payload' })
      .expect(403);

    expect(response.body).toHaveProperty('error', expect.stringContaining('CSRF'));
  });

  // 3. POST requests with mismatched token return 403 Forbidden
  test('POST requests with mismatched token return 403 Forbidden', async () => {
    const response = await request(app)
      .post('/api/protected-route')
      .set('Cookie', [csrfCookie])
      .set('x-csrf-token', 'invalid-mismatched-token-value')
      .send({ data: 'test-payload' })
      .expect(403);

    expect(response.body).toHaveProperty('error', expect.stringContaining('CSRF'));
  });

  // 4. POST requests with matching token succeed
  test('POST requests with matching token succeed', async () => {
    const response = await request(app)
      .post('/api/protected-route')
      .set('Cookie', [csrfCookie])
      .set('x-csrf-token', csrfToken)
      .send({ data: 'test-payload' })
      .expect(200);

    expect(response.body).toHaveProperty('success', true);
  });
});