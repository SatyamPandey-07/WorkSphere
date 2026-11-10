import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

interface AuditLogEntry {
  id?: string;
  timestamp?: string;
  action?: string;
  userId?: string;
  details?: string;
  [key: string]: any;
}

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function serializeEntry(entry: AuditLogEntry): string {
  const sortedKeys = Object.keys(entry).sort();
  const sortedObj: Record<string, any> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = entry[key];
  }
  return JSON.stringify(sortedObj);
}

export function computeMerkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) {
    return sha256('');
  }

  let currentLevel = [...leafHashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = currentLevel[i] + currentLevel[i + 1];
        nextLevel.push(sha256(combined));
      } else {
        const combined = currentLevel[i] + currentLevel[i];
        nextLevel.push(sha256(combined));
      }
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

function parseCsv(csvText: string): AuditLogEntry[] {
  const lines = csvText.trim().split('\n').filter(Boolean);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const entries: AuditLogEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const entry: AuditLogEntry = {};
    headers.forEach((header, index) => {
      entry[header] = values[index] ?? '';
    });
    entries.push(entry);
  }

  return entries;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let entries: AuditLogEntry[] = [];
    let expectedMerkleRoot: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      expectedMerkleRoot = (formData.get('expectedMerkleRoot') as string) || null;

      if (!file) {
        return NextResponse.json(
          { error: 'No audit log file provided.' },
          { status: 400 }
        );
      }

      const fileText = await file.text();
      if (file.name.endsWith('.csv') || contentType.includes('text/csv')) {
        entries = parseCsv(fileText);
      } else {
        entries = JSON.parse(fileText);
      }
    } else {
      const body = await req.json();
      entries = body.entries || [];
      expectedMerkleRoot = body.expectedMerkleRoot || null;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: 'Audit log is empty or invalid.' },
        { status: 400 }
      );
    }

    const leafHashes = entries
      .map(serializeEntry)
      .map(sha256)
      .sort();

    const merkleRootHex = computeMerkleRoot(leafHashes);

    const isVerified = expectedMerkleRoot
      ? merkleRootHex.toLowerCase() === expectedMerkleRoot.toLowerCase()
      : true;

    return NextResponse.json({
      success: true,
      verified: isVerified,
      merkleRoot: merkleRootHex,
      totalEntriesVerified: entries.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to verify audit log Merkle root.', details: error?.message },
      { status: 500 }
    );
  }
}