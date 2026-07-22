import { extractSignatures, getSignedBytes } from "../pdfSignatureExtractor";

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

describe("extractSignatures", () => {
  it("returns empty array for PDF with no signatures", () => {
    const pdf = stringToBytes(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n",
    );
    const result = extractSignatures(pdf);
    expect(result).toEqual([]);
  });

  it("extracts a single adbe.pkcs7.detached signature", () => {
    const contents = "30820D0A06092A864886F70D010702";
    const pdfStr = [
      "%PDF-1.7",
      "1 0 obj\n<< /Type /Sig /SubFilter /adbe.pkcs7.detached",
      "/ByteRange [0 100 300 50]",
      `/Contents <${contents}>`,
      "/M (D:20260115120000+00'00')",
      "/Reason (Approval)",
      "/Location (New York)",
      "/Name (John Doe)",
      ">>\nendobj",
    ].join("\n");

    const pdf = stringToBytes(pdfStr);
    const result = extractSignatures(pdf);

    expect(result).toHaveLength(1);
    expect(result[0].subFilter).toBe("adbe.pkcs7.detached");
    expect(result[0].signingTime).toBe("D:20260115120000+00'00'");
    expect(result[0].reason).toBe("Approval");
    expect(result[0].location).toBe("New York");
    expect(result[0].signerName).toBe("John Doe");
    expect(result[0].byteRange).toEqual({
      offset1: 0,
      length1: 100,
      offset2: 300,
      length2: 50,
    });
    expect(result[0].contents.length).toBe(15);
  });

  it("extracts multiple signatures", () => {
    const contents = "30820D0A";
    const pdfStr = [
      "%PDF-1.7",
      "1 0 obj\n<< /Type /Sig /SubFilter /adbe.pkcs7.detached",
      "/ByteRange [0 100 300 50]",
      `/Contents <${contents}>`,
      ">>\nendobj",
      "2 0 obj\n<< /Type /Sig /SubFilter /adbe.pkcs7.sha1",
      "/ByteRange [0 200 400 100]",
      `/Contents <${contents}>`,
      "/Name (Jane Smith)",
      ">>\nendobj",
    ].join("\n");

    const pdf = stringToBytes(pdfStr);
    const result = extractSignatures(pdf);

    expect(result).toHaveLength(2);
    expect(result[0].subFilter).toBe("adbe.pkcs7.detached");
    expect(result[1].subFilter).toBe("adbe.pkcs7.sha1");
    expect(result[1].signerName).toBe("Jane Smith");
  });

  it("skips signatures without ByteRange", () => {
    const pdfStr = [
      "%PDF-1.7",
      "1 0 obj\n<< /Type /Sig /SubFilter /adbe.pkcs7.detached",
      "/Contents <30820D0A>",
      ">>\nendobj",
    ].join("\n");

    const pdf = stringToBytes(pdfStr);
    const result = extractSignatures(pdf);
    expect(result).toEqual([]);
  });

  it("skips signatures without Contents", () => {
    const pdfStr = [
      "%PDF-1.7",
      "1 0 obj\n<< /Type /Sig /SubFilter /adbe.pkcs7.detached",
      "/ByteRange [0 100 300 50]",
      ">>\nendobj",
    ].join("\n");

    const pdf = stringToBytes(pdfStr);
    const result = extractSignatures(pdf);
    expect(result).toEqual([]);
  });

  it("handles hex contents with spaces", () => {
    const contents = "30 82 0D 0A";
    const pdfStr = [
      "%PDF-1.7",
      "1 0 obj\n<< /Type /Sig /SubFilter /adbe.pkcs7.detached",
      "/ByteRange [0 100 300 50]",
      `/Contents <${contents}>`,
      ">>\nendobj",
    ].join("\n");

    const pdf = stringToBytes(pdfStr);
    const result = extractSignatures(pdf);
    expect(result).toHaveLength(1);
    expect(result[0].contents.length).toBe(4);
  });
});

describe("getSignedBytes", () => {
  it("concatenates two byte ranges correctly", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const byteRange = { offset1: 0, length1: 3, offset2: 7, length2: 3 };
    const result = getSignedBytes(data, byteRange);
    expect(Array.from(result)).toEqual([1, 2, 3, 8, 9, 10]);
  });

  it("handles contiguous ranges", () => {
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    const byteRange = { offset1: 0, length1: 2, offset2: 2, length2: 3 };
    const result = getSignedBytes(data, byteRange);
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50]);
  });

  it("returns empty array for zero-length ranges", () => {
    const data = new Uint8Array([1, 2, 3]);
    const byteRange = { offset1: 0, length1: 0, offset2: 0, length2: 0 };
    const result = getSignedBytes(data, byteRange);
    expect(result.length).toBe(0);
  });
});
