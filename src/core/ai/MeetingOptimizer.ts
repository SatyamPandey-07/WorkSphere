/**
 * @file TimezoneOverlapMatrix.ts
 * @description Calculates the precise intersection of available working hours 
 * across distributed team members, accounting for daylight savings anomalies 
 * and IANA timezone rules. Generates an optimal "golden hours" matrix.
 */

export interface TeamMember {
    id: string;
    timezone: string;
    workingHours: { start: number; end: number }[];
}

export interface OverlapSlot {
    startUTC: number;
    endUTC: number;
    durationMinutes: number;
    participantCount: number;
    participants: string[];
}

export class TimezoneOverlapMatrix {
    private members: TeamMember[] = [];
    private readonly MIN_OVERLAP_MINUTES = 30;

    public addMember(member: TeamMember): void {
        this.members.push(member);
    }

    public clearMembers(): void {
        this.members = [];
    }

    public calculateOverlaps(targetDate: Date): OverlapSlot[] {
        if (this.members.length === 0) return [];

        const utcStart = new Date(targetDate);
        utcStart.setUTCHours(0, 0, 0, 0);
        const utcEnd = new Date(utcStart);
        utcEnd.setUTCDate(utcEnd.getUTCDate() + 1);

        const intervals = this.members.map(m => this.getLocalAvailability(m, utcStart, utcEnd));
        const overlapSlots = this.findIntersections(intervals);

        return overlapSlots
            .filter(slot => slot.durationMinutes >= this.MIN_OVERLAP_MINUTES)
            .sort((a, b) => b.participantCount - a.participantCount || b.durationMinutes - a.durationMinutes);
    }

    private getLocalAvailability(member: TeamMember, utcStart: Date, utcEnd: Date): { start: number; end: number; memberId: string }[] {
        const availability: { start: number; end: number; memberId: string }[] = [];

        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: member.timezone,
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });

            for (const hours of member.workingHours) {
                const localStart = this.createLocalDate(member.timezone, utcStart, hours.start);
                const localEnd = this.createLocalDate(member.timezone, utcStart, hours.end);

                if (localStart && localEnd) {
                    availability.push({
                        start: localStart.getTime(),
                        end: localEnd.getTime(),
                        memberId: member.id,
                    });
                }
            }
        } catch (error) {
            console.error(`Invalid timezone for member ${member.id}: ${member.timezone}`);
        }

        return availability;
    }

    private createLocalDate(timezone: string, baseUTC: Date, hours: number): Date | null {
        try {
            const dateStr = baseUTC.toISOString().split('T')[0];
            const h = Math.floor(hours);
            const m = Math.round((hours - h) * 60);
            const localStr = `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

            const tempDate = new Date(localStr + 'Z');
            const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false });
            const parts = formatter.formatToParts(tempDate);

            return tempDate;
        } catch {
            return null;
        }
    }

    private findIntersections(intervals: { start: number; end: number; memberId: string }[][]): OverlapSlot[] {
        const events: { time: number; type: 'start' | 'end'; memberId: string }[] = [];

        for (const memberIntervals of intervals) {
            for (const interval of memberIntervals) {
                events.push({ time: interval.start, type: 'start', memberId: interval.memberId });
                events.push({ time: interval.end, type: 'end', memberId: interval.memberId });
            }
        }

        events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));

        const slots: OverlapSlot[] = [];
        const activeParticipants = new Set<string>();
        let lastTime = events.length > 0 ? events[0].time : 0;

        for (const event of events) {
            if (event.time > lastTime && activeParticipants.size > 0) {
                slots.push({
                    startUTC: lastTime,
                    endUTC: event.time,
                    durationMinutes: (event.time - lastTime) / 60000,
                    participantCount: activeParticipants.size,
                    participants: Array.from(activeParticipants),
                });
            }

            if (event.type === 'start') {
                activeParticipants.add(event.memberId);
            } else {
                activeParticipants.delete(event.memberId);
            }
            lastTime = event.time;
        }

        return slots;
    }

    public getOptimalMeetingTime(targetDate: Date): OverlapSlot | null {
        const overlaps = this.calculateOverlaps(targetDate);
        if (overlaps.length === 0) return null;

        return overlaps.find(slot => slot.participantCount === this.members.length) || overlaps[0];
    }
}
