import type { ByteRange, PdfSignatureInfo } from "@/types/pdfSignature";

function findBytes(haystack: Uint8Array, needle: string, start = 0): number {
  const encoded = new TextEncoder().encode(needle);
  for (let i = start; i <= haystack.length - encoded.length; i++) {
    let match = true;
    for (let j = 0; j < encoded.length; j++) {
      if (haystack[i + j] !== encoded[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function findBytesReverse(
  haystack: Uint8Array,
  needle: string,
  start?: number,
): number {
  const encoded = new TextEncoder().encode(needle);
  const from = start ?? haystack.length - encoded.length;
  for (let i = from; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < encoded.length; j++) {
      if (haystack[i + j] !== encoded[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function parseByteRange(raw: string): ByteRange | null {
  const cleaned = raw.replace(/[\[\]]/g, "").trim();
  const parts = cleaned.split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some(isNaN)) return null;
  return {
    offset1: parts[0],
    length1: parts[1],
    offset2: parts[2],
    length2: parts[3],
  };
}

function parseHexString(raw: string): Uint8Array {
  const hex = raw.replace(/[<>\s]/g, "");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function extractSignatures(pdfBytes: Uint8Array): PdfSignatureInfo[] {
  const signatures: PdfSignatureInfo[] = [];
  const decoder = new TextDecoder();

  let searchPos = 0;
  while (true) {
    const sigDictPos = findBytes(pdfBytes, "/Type /Sig", searchPos);
    if (sigDictPos === -1) break;

    const dictStart = findBytesReverse(pdfBytes, "<<", sigDictPos);
    if (dictStart === -1) {
      searchPos = sigDictPos + 1;
      continue;
    }

    const dictEnd = findBytes(pdfBytes, ">>", sigDictPos);
    if (dictEnd === -1) {
      searchPos = sigDictPos + 1;
      continue;
    }

    const dictContent = decoder.decode(pdfBytes.slice(dictStart, dictEnd + 2));

    const subFilterMatch = dictContent.match(/\/SubFilter\s+\/(\S+)/);
    const subFilter = subFilterMatch
      ? subFilterMatch[1]
      : "adbe.pkcs7.detached";

    const byteRangeMatch = dictContent.match(/\/ByteRange\s*\[([^\]]+)\]/);
    if (!byteRangeMatch) {
      searchPos = dictEnd + 2;
      continue;
    }
    const byteRange = parseByteRange(byteRangeMatch[1]);
    if (!byteRange) {
      searchPos = dictEnd + 2;
      continue;
    }

    const contentsMatch = dictContent.match(/\/Contents\s*<([0-9A-Fa-f\s]+)>/);
    if (!contentsMatch) {
      searchPos = dictEnd + 2;
      continue;
    }
    const contents = parseHexString(contentsMatch[1]);

    const signingTimeMatch = dictContent.match(/\/M\s*\(([^)]+)\)/);
    const reasonMatch = dictContent.match(/\/Reason\s*(\/\S+|\([^)]+\))/);
    const locationMatch = dictContent.match(/\/Location\s*(\/\S+|\([^)]+\))/);
    const nameMatch = dictContent.match(/\/Name\s*(\/\S+|\([^)]+\))/);

    const signingTime = signingTimeMatch?.[1];

    const reason = reasonMatch
      ? reasonMatch[1].startsWith("(")
        ? reasonMatch[1].slice(1, -1)
        : reasonMatch[1].slice(1)
      : undefined;

    const location = locationMatch
      ? locationMatch[1].startsWith("(")
        ? locationMatch[1].slice(1, -1)
        : locationMatch[1].slice(1)
      : undefined;

    const signerName = nameMatch
      ? nameMatch[1].startsWith("(")
        ? nameMatch[1].slice(1, -1)
        : nameMatch[1].slice(1)
      : undefined;

    let fieldName = `Signature_${signatures.length + 1}`;
    const fieldSearchStart = Math.max(0, dictStart - 500);
    const fieldT = findBytes(pdfBytes, "/T ", fieldSearchStart);
    if (fieldT > fieldSearchStart && fieldT < dictStart) {
      const nameStart = fieldT + 3;
      if (pdfBytes[nameStart] === 0x28) {
        const nameEnd = pdfBytes.indexOf(0x29, nameStart + 1);
        if (nameEnd > nameStart) {
          fieldName = decoder.decode(pdfBytes.slice(nameStart + 1, nameEnd));
        }
      }
    }

    signatures.push({
      fieldName,
      subFilter,
      byteRange,
      contents,
      signingTime,
      reason,
      location,
      signerName,
    });

    searchPos = dictEnd + 2;
  }

  return signatures;
}

export function getSignedBytes(
  pdfBytes: Uint8Array,
  byteRange: ByteRange,
): Uint8Array {
  const totalLength = byteRange.length1 + byteRange.length2;
  const result = new Uint8Array(totalLength);
  result.set(
    pdfBytes.slice(byteRange.offset1, byteRange.offset1 + byteRange.length1),
    0,
  );
  result.set(
    pdfBytes.slice(byteRange.offset2, byteRange.offset2 + byteRange.length2),
    byteRange.length1,
  );
  return result;
}
