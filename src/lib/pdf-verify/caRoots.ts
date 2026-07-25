const ROOT_CERTS: string[] = [
  "DigiCert Global Root G2",
  "DigiCert Global Root CA",
  "ISRG Root X1",
  "ISRG Root X2",
  "Baltimore CyberTrust Root",
  "GlobalSign Root CA",
  "GeoTrust Global CA 2",
  "Sectigo (AAA Certificate Services)",
  "USERTrust RSA Certification Authority",
  "COMODO RSA Certification Authority",
  "Certum Trusted Network CA",
  "Entrust Root Certification Authority",
  "Go Daddy Root Certificate Authority",
  "Starfield Services Root Certificate Authority",
  "Amazon Root CA 1",
  "Microsoft RSA Root Certificate Authority 2017",
  "IdenTrust Commercial Root CA 1",
  "QuoVadis Root CA 2 G3",
];

let cachedPem: string | null = null;

export function getTrustedCaRootNames(): string[] {
  return [...ROOT_CERTS];
}

export function getCaRootsPem(): string {
  if (cachedPem) return cachedPem;
  cachedPem = ROOT_CERTS.map((name) => `# ${name}`).join("\n");
  return cachedPem;
}

export async function fetchCaRootsPem(): Promise<string> {
  try {
    const response = await fetch("/ca-bundle.pem");
    if (!response.ok) return getCaRootsPem();
    const text = await response.text();
    if (text.trim().length > 0) return text;
    return getCaRootsPem();
  } catch {
    return getCaRootsPem();
  }
}
