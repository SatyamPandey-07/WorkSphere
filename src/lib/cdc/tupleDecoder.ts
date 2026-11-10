export const POSTGRES_OIDS = {
  BOOL: 16,
  BYTEA: 17,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  TEXT: 25,
  JSON: 114,
  FLOAT4: 700,
  FLOAT8: 701,
  VARCHAR: 1043,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  UUID: 2950,
  JSONB: 3802,
} as const;

// Dynamic custom enum / extended OID registry
const customOidRegistry = new Map<number, string>();

export function registerCustomOid(oid: number, typeName: string) {
  customOidRegistry.set(oid, typeName);
}

export function decodeTupleValue(oid: number, buffer: Buffer | null): any {
  if (!buffer) return null;

  switch (oid) {
    case POSTGRES_OIDS.BOOL:
      return buffer.readInt8(0) !== 0;
    case POSTGRES_OIDS.INT2:
      return buffer.readInt16BE(0);
    case POSTGRES_OIDS.INT4:
      return buffer.readInt32BE(0);
    case POSTGRES_OIDS.INT8:
      return Number(buffer.readBigInt64BE(0));
    case POSTGRES_OIDS.FLOAT4:
      return buffer.readFloatBE(0);
    case POSTGRES_OIDS.FLOAT8:
      return buffer.readDoubleBE(0);
    case POSTGRES_OIDS.TEXT:
    case POSTGRES_OIDS.VARCHAR:
      return buffer.toString('utf8');
    case POSTGRES_OIDS.JSON:
    case POSTGRES_OIDS.JSONB: {
      try {
        // JSONB has a version prefix byte (usually 1)
        const jsonStr = buffer.length > 0 && oid === POSTGRES_OIDS.JSONB 
          ? buffer.subarray(1).toString('utf8') 
          : buffer.toString('utf8');
        return JSON.parse(jsonStr);
      } catch (e) {
        return buffer.toString('utf8');
      }
    }
    case POSTGRES_OIDS.UUID:
      return buffer.toString('hex');
    case POSTGRES_OIDS.TIMESTAMP:
    case POSTGRES_OIDS.TIMESTAMPTZ:
    case POSTGRES_OIDS.DATE:
      return buffer.toString('utf8');
    case POSTGRES_OIDS.BYTEA:
      return buffer;
    default: {
      if (customOidRegistry.has(oid)) {
        // Custom enum or registered type decoded as string
        return buffer.toString('utf8');
      }

      // Graceful fallback coercion for unknown OIDs to prevent worker crashes
      console.warn(`⚠️ Warning: Unrecognized PostgreSQL OID [${oid}] encountered. Coercing to UTF-8 string/Buffer fallback.`);
      registerCustomOid(oid, `unknown_oid_${oid}`);

      try {
        return buffer.toString('utf8');
      } catch {
        return buffer;
      }
    }
  }
}