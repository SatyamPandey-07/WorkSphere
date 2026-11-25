import {
  DeskAutoAllocator,
  type DeskResource,
  type PersonCandidate,
} from '@/core/ai/DeskAutoAllocator';

describe('DeskAutoAllocator Multi-Desk Preference Weights (#10438)', () => {
  it('scores and assigns desks based on per-person window, power, and quiet weights', () => {
    const allocator = new DeskAutoAllocator();

    const desks: DeskResource[] = [
      { id: 'desk-window', nearWindow: true, powerOutlet: false, quietZone: false },
      { id: 'desk-power', nearWindow: false, powerOutlet: true, quietZone: false },
      { id: 'desk-quiet', nearWindow: false, powerOutlet: false, quietZone: true },
    ];

    const persons: PersonCandidate[] = [
      {
        id: 'p-window',
        preferenceWeights: { window: 1.0, power: 0.1, quiet: 0.1 },
      },
      {
        id: 'p-power',
        preferenceWeights: { window: 0.1, power: 1.0, quiet: 0.1 },
      },
      {
        id: 'p-quiet',
        preferenceWeights: { window: 0.1, power: 0.1, quiet: 1.0 },
      },
    ];

    const result = allocator.allocateDesks(persons, desks);

    expect(result.feasible).toBe(true);
    expect(result.totalAllocated).toBe(3);

    const byPerson = new Map(result.assignments.map((a) => [a.personId, a.deskId]));
    expect(byPerson.get('p-window')).toBe('desk-window');
    expect(byPerson.get('p-power')).toBe('desk-power');
    expect(byPerson.get('p-quiet')).toBe('desk-quiet');
  });

  it('supports allocator-level default weights and per-person overrides', () => {
    const allocator = new DeskAutoAllocator({ window: 0.5, power: 2.0, quiet: 0.2 });

    const windowDesk: DeskResource = { id: 'd-win', nearWindow: true };
    const powerDesk: DeskResource = { id: 'd-pwr', outlets: 2 };
    const quietDesk: DeskResource = { id: 'd-qt', quietZone: true };

    const defaultPerson: PersonCandidate = { id: 'p-default' };
    expect(allocator.calculateMatchScore(defaultPerson, powerDesk)).toBeGreaterThan(
      allocator.calculateMatchScore(defaultPerson, windowDesk),
    );
    expect(allocator.calculateMatchScore(defaultPerson, windowDesk)).toBeGreaterThan(
      allocator.calculateMatchScore(defaultPerson, quietDesk),
    );

    const quietOverridePerson: PersonCandidate = {
      id: 'p-quiet-override',
      preferenceWeights: { quiet: 5.0 },
    };
    expect(allocator.calculateMatchScore(quietOverridePerson, quietDesk)).toBeGreaterThan(
      allocator.calculateMatchScore(quietOverridePerson, powerDesk),
    );
  });

  it('ignores non-positive or non-finite preference weights safely', () => {
    const allocator = new DeskAutoAllocator();
    const person: PersonCandidate = {
      id: 'p-invalid-weights',
      preferenceWeights: {
        window: -5,
        power: Number.NaN,
        quiet: Number.POSITIVE_INFINITY,
      },
    };
    const baselinePerson: PersonCandidate = { id: 'p-baseline' };
    const desk: DeskResource = {
      id: 'd-all',
      nearWindow: true,
      hasPowerOutlet: true,
      quietZone: true,
    };

    expect(allocator.calculateMatchScore(person, desk)).toBe(
      allocator.calculateMatchScore(baselinePerson, desk),
    );
  });

  it('applies preference weights during deterministic fallback allocation when oversubscribed', () => {
    const allocator = new DeskAutoAllocator();
    const desks: DeskResource[] = [
      { id: 'd-window-power', nearWindow: true, powerOutlet: true },
      { id: 'd-quiet', quietZone: true },
    ];
    const persons: PersonCandidate[] = [
      { id: 'p-high', priority: 10, preferenceWeights: { quiet: 3.0 } },
      { id: 'p-mid', priority: 5, preferenceWeights: { window: 1.5, power: 1.5 } },
      { id: 'p-low', priority: 1 },
    ];

    const result = allocator.allocateDesks(persons, desks);
    expect(result.feasible).toBe(false);
    expect(result.isFallback).toBe(true);
    expect(result.totalAllocated).toBe(2);
    expect(result.unassignedPersonIds).toEqual(['p-low']);

    const byPerson = new Map(result.assignments.map((a) => [a.personId, a.deskId]));
    expect(byPerson.get('p-high')).toBe('d-quiet');
    expect(byPerson.get('p-mid')).toBe('d-window-power');
  });
});
