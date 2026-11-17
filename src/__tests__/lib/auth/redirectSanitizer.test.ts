import {
    sanitizeRedirectUrl,
    buildSignInRedirectUrl,
    isSafeRelativeRedirect,
    isAuthRoute,
} from '@/lib/auth/redirectSanitizer';

describe('redirectSanitizer & middleware loop prevention', () => {
    test('identifies auth routes accurately', () => {
        expect(isAuthRoute('/sign-in')).toBe(true);
        expect(isAuthRoute('/sign-in/factor-one')).toBe(true);
        expect(isAuthRoute('/sign-up')).toBe(true);
        expect(isAuthRoute('/workspace/settings')).toBe(false);
    });

    test('validates safe relative paths and rejects open redirects', () => {
        expect(isSafeRelativeRedirect('/workspace/settings')).toBe(true);
        expect(isSafeRelativeRedirect('/workspace/settings?tab=billing')).toBe(true);

        expect(isSafeRelativeRedirect('//evil.com/phish')).toBe(false);
        expect(isSafeRelativeRedirect('/\\evil.com')).toBe(false);
        expect(isSafeRelativeRedirect('https://evil.com/workspace')).toBe(false);
        expect(isSafeRelativeRedirect('javascript:alert(1)')).toBe(false);
    });

    test('unwraps recursively nested redirect_url chains caused by blocked cookies', () => {
        const nested =
            '/sign-in?redirect_url=%2Fsign-in%3Fredirect_url%3D%252Fsign-in%253Fredirect_url%253D%25252Fworkspace%25252Fsettings';

        expect(sanitizeRedirectUrl(nested)).toBe('/workspace/settings');
    });

    test('preserves legitimate destination query parameters while stripping nested redirect_url', () => {
        const nestedWithParams =
            '/sign-in?redirect_url=%2Fworkspace%2Fsettings%3Ftab%3Dapi-keys%26section%3Dwebhooks';

        expect(sanitizeRedirectUrl(nestedWithParams)).toBe(
            '/workspace/settings?tab=api-keys§ion=webhooks'
        );
    });

    test('falls back to /dashboard when redirect_url points only to /sign-in or an external domain', () => {
        expect(sanitizeRedirectUrl('/sign-in')).toBe('/dashboard');
        expect(sanitizeRedirectUrl('/sign-in?redirect_url=%2Fsign-in')).toBe('/dashboard');
        expect(sanitizeRedirectUrl('https://attacker.example/steal')).toBe('/dashboard');
        expect(sanitizeRedirectUrl('//attacker.example')).toBe('/dashboard');
    });

    test('builds exact single-level /sign-in?redirect_url=%2Fworkspace%2Fsettings redirect', () => {
        const reqUrl = new URL('http://localhost:3000/workspace/settings');
        const redirectUrl = buildSignInRedirectUrl(reqUrl);

        expect(redirectUrl.pathname).toBe('/sign-in');
        expect(redirectUrl.search).toBe('?redirect_url=%2Fworkspace%2Fsettings');
    });

    test('does not double-encode if buildSignInRedirectUrl is called on an already-redirected /sign-in URL', () => {
        const bouncedUrl = new URL(
            'http://localhost:3000/sign-in?redirect_url=%2Fsign-in%3Fredirect_url%3D%252Fworkspace%252Fsettings'
        );
        const normalizedUrl = buildSignInRedirectUrl(bouncedUrl);

        expect(normalizedUrl.pathname).toBe('/sign-in');
        expect(normalizedUrl.search).toBe('?redirect_url=%2Fworkspace%2Fsettings');
    });
});