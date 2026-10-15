/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { LocalEventScraper, RawEventPayload, StructuredEvent } from '../core/events/LocalEventScraper';

interface WorkerMessage {
  type: 'SCRAPE_URL' | 'PROCESS_BATCH';
  payload: any;
}

interface WorkerResponse {
  type: 'SCRAPING_COMPLETE' | 'BATCH_PROCESSED' | 'ERROR';
  payload: any;
}

const scraper = new LocalEventScraper();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  try {
    if (type === 'SCRAPE_URL') {
      await handleScrapeUrl(payload);
    } else if (type === 'PROCESS_BATCH') {
      await handleProcessBatch(payload);
    }
  } catch (error: any) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: error.message, stack: error.stack }
    } as WorkerResponse);
  }
};

async function handleScrapeUrl(payload: { url: string; source: 'meetup' | 'eventbrite' | 'rss' }): Promise<void> {
  // In a real environment, this would use a CORS proxy or server-side fetch
  // Simulating fetch for the worker context
  const mockHtml = `<div class="event-card"><a href="${payload.url}"><h2>Mock Tech Meetup</h2></a><time datetime="${new Date().toISOString()}"></time></div>`;
  
  const rawPayload: RawEventPayload = {
    source: payload.source,
    url: payload.url,
    htmlContent: payload.source !== 'rss' ? mockHtml : undefined,
    rssXml: payload.source === 'rss' ? '<item><title>Mock RSS</title><link>http://test</link></item>' : undefined
  };

  const events = await scraper.parsePayload(rawPayload);
  
  self.postMessage({
    type: 'SCRAPING_COMPLETE',
    payload: { url: payload.url, events }
  } as WorkerResponse);
}

async function handleProcessBatch(urls: { url: string; source: 'meetup' | 'eventbrite' | 'rss' }[]): Promise<void> {
  const allEvents: StructuredEvent[] = [];
  
  for (const item of urls) {
    try {
      const mockHtml = `<div class="event-card"><a href="${item.url}"><h2>Batch Event</h2></a><time datetime="${new Date().toISOString()}"></time></div>`;
      const rawPayload: RawEventPayload = {
        source: item.source,
        url: item.url,
        htmlContent: mockHtml
      };
      
      const events = await scraper.parsePayload(rawPayload);
      allEvents.push(...events);
      
      // Rate limiting delay to avoid IP bans
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`Failed to scrape ${item.url}`, err);
    }
  }

  self.postMessage({
    type: 'BATCH_PROCESSED',
    payload: { events: allEvents, count: allEvents.length }
  } as WorkerResponse);
}

self.addEventListener('activate', () => {
  console.log('Event Ingestion Worker activated');
});
