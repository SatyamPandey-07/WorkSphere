/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface CalendarEvent {
    id: string;
    title: string;
    start: number;
    end: number;
    provider: 'google' | 'outlook';
}

interface SyncConfig {
    provider: 'google' | 'outlook';
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}

let syncInterval: number | null = null;
const SYNC_FREQUENCY = 300000;

async function fetchGoogleEvents(token: string): Promise<CalendarEvent[]> {
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Google API error');
    const data = await response.json();
    return data.items.map((item: any) => ({
        id: item.id,
        title: item.summary,
        start: new Date(item.start.dateTime || item.start.date).getTime(),
        end: new Date(item.end.dateTime || item.end.date).getTime(),
        provider: 'google',
    }));
}

async function fetchOutlookEvents(token: string): Promise<CalendarEvent[]> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Outlook API error');
    const data = await response.json();
    return data.value.map((item: any) => ({
        id: item.id,
        title: item.subject,
        start: new Date(item.start.dateTime).getTime(),
        end: new Date(item.end.dateTime).getTime(),
        provider: 'outlook',
    }));
}

async function refreshTokens(config: SyncConfig): Promise<SyncConfig> {
    if (Date.now() < config.expiresAt - 60000) return config;

    const endpoint = config.provider === 'google'
        ? 'https://oauth2.googleapis.com/token'
        : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: config.refreshToken,
            client_id: 'WORKSPHERE_CLIENT_ID',
        }),
    });

    if (!response.ok) throw new Error('Token refresh failed');
    const data = await response.json();

    return {
        ...config,
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
}

async function performSync(config: SyncConfig): Promise<void> {
    try {
        const freshConfig = await refreshTokens(config);
        const events = freshConfig.provider === 'google'
            ? await fetchGoogleEvents(freshConfig.accessToken)
            : await fetchOutlookEvents(freshConfig.accessToken);

        self.postMessage({ type: 'SYNC_SUCCESS', payload: { events, config: freshConfig } });
    } catch (error) {
        self.postMessage({ type: 'SYNC_ERROR', payload: { error: String(error) } });
    }
}

self.onmessage = (event) => {
    const { type, payload } = event.data;

    if (type === 'START_SYNC') {
        const config = payload as SyncConfig;
        performSync(config);

        if (syncInterval) self.clearInterval(syncInterval);
        syncInterval = self.setInterval(() => performSync(config), SYNC_FREQUENCY);
    } else if (type === 'STOP_SYNC') {
        if (syncInterval) {
            self.clearInterval(syncInterval);
            syncInterval = null;
        }
    } else if (type === 'FORCE_SYNC') {
        performSync(payload as SyncConfig);
    }
};

export {};
