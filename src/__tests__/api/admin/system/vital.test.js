import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/vitals/route';
import { getAdminUser } from '@/lib/auth/adminAuth';

jest.mock('@/lib/auth/adminAuth', () => ({
    getAdminUser: jest.fn(),
}));

const mockedGetAdminUser = getAdminUser as jest.MockedFunction<typeof getAdminUser>;

describe('GET /api/admin/vitals authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 403 Forbidden for unauthenticated JSON requests', async () => {
        mockedGetAdminUser.mockResolvedValueOnce(null);

        const req = new NextRequest('http://localhost:3000/api/admin/vitals');
        const res = await GET(req);
        const body = await res.json();

        expect(mockedGetAdminUser).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(403);
        expect(body).toEqual({ error: 'Admin access required' });
    });

    test('returns 403 Forbidden for unauthenticated Prometheus scrape requests', async () => {
        mockedGetAdminUser.mockResolvedValueOnce(null);

        const req = new NextRequest(
            'http://localhost:3000/api/admin/vitals?format=prometheus',
            {
                headers: { Accept: 'text/plain; version=0.0.4' },
            }
        );
        const res = await GET(req);
        const body = await res.json();

        expect(mockedGetAdminUser).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(403);
        expect(body).toEqual({ error: 'Admin access required' });
    });

    test('returns 200 OK with system vitals JSON when called by an authenticated admin', async () => {
        mockedGetAdminUser.mockResolvedValueOnce({
            id: 'user_admin_01',
            role: 'ADMIN',
            email: 'admin@worksphere.app',
        } as never);

        const req = new NextRequest('http://localhost:3000/api/admin/vitals');
        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toHaveProperty('generatedAt');
        expect(body).toHaveProperty('memoryBytes');
        expect(body).toHaveProperty('latency.overall');
    });

    test('returns 200 OK with Prometheus text metrics when called by an authenticated admin', async () => {
        mockedGetAdminUser.mockResolvedValueOnce({
            id: 'user_admin_01',
            role: 'ADMIN',
            email: 'admin@worksphere.app',
        } as never);

        const req = new NextRequest(
            'http://localhost:3000/api/admin/vitals?format=prometheus'
        );
        const res = await GET(req);
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/plain');
        expect(text).toContain('worksphere_http_request_duration_ms');
    });
});