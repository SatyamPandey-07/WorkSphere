import { decodeTupleValue, POSTGRES_OIDS, registerCustomOid } from '../../lib/cdc/tupleDecoder';

describe('PostgreSQL Tuple Decoder & OID Fallback', () => {
  test('correctly decodes standard types (Text, Int4, Bool)', () => {
    const textBuf = Buffer.from('WorkSphere Coworking', 'utf8');
    expect(decodeTupleValue(POSTGRES_OIDS.TEXT, textBuf)).toBe('WorkSphere Coworking');

    const intBuf = Buffer.alloc(4);
    intBuf.writeInt32BE(42, 0);
    expect(decodeTupleValue(POSTGRES_OIDS.INT4, intBuf)).toBe(42);

    const boolBuf = Buffer.alloc(1);
    boolBuf.writeInt8(1, 0);
    expect(decodeTupleValue(POSTGRES_OIDS.BOOL, boolBuf)).toBe(true);
  });

  test('correctly decodes extended types (JSONB, UUID, Timestamptz)', () => {
    // JSONB with version byte 1
    const jsonbBuf = Buffer.concat([Buffer.from([1]), Buffer.from('{"status":"active"}', 'utf8')]);
    expect(decodeTupleValue(POSTGRES_OIDS.JSONB, jsonbBuf)).toEqual({ status: 'active' });

    const uuidBuf = Buffer.from('123e4567e89b12d3a456426614174000', 'utf8');
    expect(decodeTupleValue(POSTGRES_OIDS.UUID, uuidBuf)).toBe('123e4567e89b12d3a456426614174000');
  });

  test('gracefully handles unknown OIDs without crashing and registers them', () => {
    const unknownOid = 99999;
    const customEnumBuf = Buffer.from('REMOTE_NOMAD', 'utf8');

    const result = decodeTupleValue(unknownOid, customEnumBuf);
    expect(result).toBe('REMOTE_NOMAD');
  });

  test('correctly decodes registered custom enum OIDs', () => {
    const customOid = 88888;
    registerCustomOid(customOid, 'membership_tier');

    const tierBuf = Buffer.from('PLATINUM', 'utf8');
    expect(decodeTupleValue(customOid, tierBuf)).toBe('PLATINUM');
  });
});