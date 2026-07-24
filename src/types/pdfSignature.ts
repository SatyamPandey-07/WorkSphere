export interface ByteRange {
  offset1: number;
  length1: number;
  offset2: number;
  length2: number;
}

export type SubFilter =
  "adbe.pkcs7.detached" | "adbe.pkcs7.sha1" | "ETSI.CAdES.detached" | string;

export interface PdfSignatureInfo {
  fieldName: string;
  subFilter: SubFilter;
  byteRange: ByteRange;
  contents: Uint8Array;
  signingTime?: string;
  reason?: string;
  location?: string;
  signerName?: string;
}

export interface SignatureVerificationResult {
  valid: boolean;
  signerName: string;
  signingTime: string;
  algorithm: string;
  error: string;
}

export type VerificationStatus =
  | "idle"
  | "loading"
  | "verifying"
  | "verified"
  | "invalid"
  | "unsigned"
  | "error";

export interface WorkerRequest {
  action: "init" | "verify";
  id: string;
  payload?: {
    wasmUrl?: string;
    pdfBytes?: Uint8Array;
    cmsBlob?: Uint8Array;
    byteRange?: ByteRange;
    caRoots?: string;
  };
}

export interface WorkerResponse {
  action: "ready" | "result" | "error";
  id: string;
  result?: SignatureVerificationResult;
  error?: string;
}
