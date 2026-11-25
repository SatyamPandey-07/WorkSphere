import {
  buildCsvFilename,
  buildFootTrafficCsv,
  exportFootTrafficToCsv,
  sanitizeCsvCell,
} from '@/lib/analytics/exportCsv';

describe('foot traffic CSV export utility', () => {
  it('formats columns in exact specification order', () => {
    const csv = buildFootTrafficCsv([
      {
        date: '2026-11-23',
        hour: '10:00',
        occupancyCount: 42,
        capacityPercentage: 84,
        deskTurnoverRate: 1.5,
      },
    ]);

    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Date,Hour,OccupancyCount,CapacityPercentage,DeskTurnoverRate'
    );
    expect(lines[1]).toBe('2026-11-23,10:00,42,84,1.5');
  });

  it('neutralizes CSV formula injection characters (=, +, -, @) and quotes commas', () => {
    expect(sanitizeCsvCell('=CMD|"/C calc"!A0')).toBe('"\'=CMD|""/C calc""!A0"');
    expect(sanitizeCsvCell('+SUM(A1:A5)')).toBe("'+SUM(A1:A5)");
    expect(sanitizeCsvCell('-10+20')).toBe("'-10+20");
    expect(sanitizeCsvCell('@malicious')).toBe("'@malicious");
  });

  it('generates a date-stamped filename and returns CSV payload', () => {
    const fixedDate = new Date('2026-11-23T12:00:00.000Z');
    expect(buildCsvFilename('WorkSphere Bandra Hub', fixedDate)).toBe(
      'worksphere-bandra-hub-foot-traffic-2026-11-23.csv'
    );

    const createObjectURLMock = jest.fn(() => 'blob:mock-csv');
    const revokeObjectURLMock = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURLMock,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURLMock,
      writable: true,
    });

    const result = exportFootTrafficToCsv(
      [
        {
          date: '=2026-11-23',
          hour: '14:00',
          occupancyCount: 30,
          capacityPercentage: 60,
          deskTurnoverRate: 1.2,
        },
      ],
      'WorkSphere Bandra Hub',
      fixedDate
    );

    expect(result.filename).toBe('worksphere-bandra-hub-foot-traffic-2026-11-23.csv');
    expect(result.csv).toContain("'=2026-11-23,14:00,30,60,1.2");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-csv');
  });
});
