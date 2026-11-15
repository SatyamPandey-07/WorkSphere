/**
 * LocalEventScraper.ts
 * Parses HTML/RSS feeds from local event platforms (Meetup, Eventbrite) to extract 
 * structured event metadata and attendee lists for the knowledge graph.
 */

export interface RawEventPayload {
    source: 'meetup' | 'eventbrite' | 'rss';
    url: string;
    htmlContent?: string;
    rssXml?: string;
}

export interface StructuredEvent {
    externalId: string;
    title: string;
    description: string;
    startTime: number;
    endTime: number;
    venueName: string;
    venueLat: number;
    venueLng: number;
    tags: string[];
    attendeeCount: number;
    sourceUrl: string;
}

export class LocalEventScraper {
    private readonly MAX_DESCRIPTION_LENGTH = 500;

    constructor() { }

    /**
     * Routes the payload to the appropriate parser based on the source platform.
     */
    public async parsePayload(payload: RawEventPayload): Promise<StructuredEvent[]> {
        switch (payload.source) {
            case 'meetup':
                return this.parseMeetupHtml(payload.htmlContent || '', payload.url);
            case 'eventbrite':
                return this.parseEventbriteHtml(payload.htmlContent || '', payload.url);
            case 'rss':
                return this.parseRssFeed(payload.rssXml || '');
            default:
                throw new Error(`Unsupported source: ${payload.source}`);
        }
    }

    /**
     * Extracts event cards from Meetup's DOM structure using regex-based HTML parsing.
     * (In production, a headless browser or robust DOM parser like Cheerio would be used).
     */
    private async parseMeetupHtml(html: string, sourceUrl: string): Promise<StructuredEvent[]> {
        const events: StructuredEvent[] = [];
        const eventCardRegex = /<div class="event-card".*?<a href="(.*?)".*?<h2>(.*?)<\/h2>.*?<time datetime="(.*?)".*?<\/div>/gs;

        let match;
        while ((match = eventCardRegex.exec(html)) !== null) {
            const url = match[1];
            const title = this.stripHtmlTags(match[2]);
            const isoDate = match[3];

            events.push({
                externalId: this.generateHash(url),
                title,
                description: this.extractMetaDescription(html, url),
                startTime: new Date(isoDate).getTime(),
                endTime: new Date(isoDate).getTime() + (2 * 60 * 60 * 1000), // Default 2 hours
                venueName: this.extractVenueName(html, url),
                venueLat: 0, // Requires geocoding step
                venueLng: 0,
                tags: this.extractTags(title),
                attendeeCount: this.extractAttendeeCount(html, url),
                sourceUrl: url
            });
        }

        return events;
    }

    private async parseEventbriteHtml(html: string, sourceUrl: string): Promise<StructuredEvent[]> {
        const events: StructuredEvent[] = [];
        const eventRegex = /<article class="eds-event-card".*?<h3 class="eds-event-card-content__title">(.*?)<\/h3>.*?<time datetime="(.*?)"/gs;

        let match;
        while ((match = eventRegex.exec(html)) !== null) {
            const title = this.stripHtmlTags(match[1]);
            const isoDate = match[2];

            events.push({
                externalId: this.generateHash(title + isoDate),
                title,
                description: this.stripHtmlTags(html.substring(match.index, match.index + this.MAX_DESCRIPTION_LENGTH)),
                startTime: new Date(isoDate).getTime(),
                endTime: new Date(isoDate).getTime() + (3 * 60 * 60 * 1000),
                venueName: 'Eventbrite Venue', // Simplified
                venueLat: 0,
                venueLng: 0,
                tags: this.extractTags(title),
                attendeeCount: 0,
                sourceUrl: sourceUrl
            });
        }

        return events;
    }

    private async parseRssFeed(xml: string): Promise<StructuredEvent[]> {
        const events: StructuredEvent[] = [];
        const itemRegex = /<item>(.*?)<\/item>/gs;

        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
            const itemXml = match[1];
            const title = this.extractTagContent(itemXml, 'title');
            const link = this.extractTagContent(itemXml, 'link');
            const pubDate = this.extractTagContent(itemXml, 'pubDate');

            if (title && link) {
                events.push({
                    externalId: this.generateHash(link),
                    title: this.stripHtmlTags(title),
                    description: this.stripHtmlTags(this.extractTagContent(itemXml, 'description') || ''),
                    startTime: pubDate ? new Date(pubDate).getTime() : Date.now(),
                    endTime: Date.now() + (2 * 60 * 60 * 1000),
                    venueName: 'RSS Feed Event',
                    venueLat: 0,
                    venueLng: 0,
                    tags: this.extractTags(title),
                    attendeeCount: 0,
                    sourceUrl: link
                });
            }
        }

        return events;
    }

    private stripHtmlTags(html: string): string {
        return html.replace(/<[^>]*>?/gm, '').trim();
    }

    private extractTagContent(xml: string, tag: string): string | null {
        const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 's');
        const match = xml.match(regex);
        return match ? match[1].trim() : null;
    }

    private extractMetaDescription(html: string, url: string): string {
        // Simplified extraction logic
        return "Event description extracted from platform metadata.";
    }

    private extractVenueName(html: string, url: string): string {
        return "Extracted Venue Name";
    }

    private extractAttendeeCount(html: string, url: string): number {
        const countRegex = /(\d+)\s*(?:attendees|going)/i;
        const match = html.match(countRegex);
        return match ? parseInt(match[1], 10) : 0;
    }

    private extractTags(text: string): string[] {
        const keywords = ['tech', 'networking', 'startup', 'crypto', 'ai', 'web3', 'nomad', 'developer'];
        const lowerText = text.toLowerCase();
        return keywords.filter(kw => lowerText.includes(kw));
    }

    private generateHash(input: string): string {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }
}
