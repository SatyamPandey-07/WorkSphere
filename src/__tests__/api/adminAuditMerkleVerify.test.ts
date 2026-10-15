import { computeMerkleRoot } from '@/app/api/admin/audit/verify/route';
import crypto from 'crypto';

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('Admin Audit Log Merkle Verification Engine', () => {
  const sampleLogs = [
    { id: '1', action: 'LOGIN', userId: 'usr-101', timestamp: '2026-10-15T10:00:00Z' },
    { id: '2', action: 'BOOK_DESK', userId: 'usr-102', timestamp: '2026-10-15T10:05:00Z' },
    { id: '3', action: 'FLIGHT_CLEARANCE', userId: 'usr-101', timestamp: '2026-10-15T10:10:00Z' },
  ];

  it('should compute a valid SHA-256 Merkle Root for a set of audit logs', () => {
    const leafHashes = sampleLogs
      .map(log => sha256(JSON.stringify(log)))
      .sort();

    const rootHex = computeMerkleRoot(leafHashes);

    expect(rootHex).toBeDefined();
    expect(rootHex).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('should produce identical Merkle roots for identical audit log data', () => {
    const leafHashes1 = sampleLogs.map(log => sha256(JSON.stringify(log))).sort();
    const leafHashes2 = sampleLogs.map(log => sha256(JSON.stringify(log))).sort();

    const root1 = computeMerkleRoot(leafHashes1);
    const root2 = computeMerkleRoot(leafHashes2);

    expect(root1).toBe(root2);
  });

  it('should detect altered or tampered audit log entries', () => {
    const leafHashesOriginal = sampleLogs.map(log => sha256(JSON.stringify(log))).sort();
    const rootOriginal = computeMerkleRoot(leafHashesOriginal);

    const tamperedLogs = [...sampleLogs];
    tamperedLogs[1] = { ...tamperedLogs[1], action: 'UNAUTHORIZED_ACCESS' };

    const leafHashesTampered = tamperedLogs.map(log => sha256(JSON.stringify(log))).sort();
    const rootTampered = computeMerkleRoot(leafHashesTampered);

    expect(rootOriginal).not.toBe(rootTampered);
  });
});