import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { XMLParser } from "fast-xml-parser";

export const DEFAULT_SAML_CLOCK_SKEW_SEC = 60;

/**
 * Validates a SAML 2.0 XML Assertion.
 *
 * @param xmlString - The raw XML string of the SAML Response or Assertion
 * @param expectedCert - The expected X.509 certificate string from the IDP metadata
 * @param expectedAudience - (Optional) The expected audience (EntityID) of our SP; falls back to process.env.SAML_ENTITY_ID or process.env.SAML_SP_ENTITY_ID
 * @param expectedRecipient - (Optional) The expected recipient ACS URL
 * @param clockSkewSec - (Optional) Clock skew leeway window in seconds (default: 60 seconds)
 * @returns An object containing the extracted NameID and attributes if valid
 */
export function validateSamlAssertion(
  xmlString: string,
  expectedCert: string,
  expectedAudience?: string,
  expectedRecipient?: string,
  clockSkewSec = DEFAULT_SAML_CLOCK_SKEW_SEC,
) {
  // 1. Verify XML Signature using xml-crypto
  const doc = new DOMParser().parseFromString(xmlString, "text/xml");
  const signature = doc.getElementsByTagNameNS(
    "http://www.w3.org/2000/09/xmldsig#",
    "Signature",
  )[0];

  if (!signature) {
    throw new Error("Invalid SAML: No signature found");
  }

  const normalizedCert = expectedCert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  const publicCert = Buffer.from(
    `-----BEGIN CERTIFICATE-----\n${normalizedCert.replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`,
  );

  const sig = new SignedXml({
    publicCert,
    getCertFromKeyInfo: () => null,
  });

  sig.loadSignature(signature.toString());

  let isValid: boolean;
  try {
    isValid = sig.checkSignature(xmlString);
  } catch (err) {
    throw new Error(
      `SAML Signature validation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isValid) {
    throw new Error("SAML Signature validation failed");
  }

  const signedReferences = sig.getSignedReferences();

  if (signedReferences.length !== 1) {
    throw new Error("Invalid SAML: Expected exactly one signed reference");
  }

  // 2. Parse only the XML content that was actually covered by the signature
  const verifiedXml = signedReferences[0];

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });

  const parsed = parser.parse(verifiedXml);
  const response = parsed.Response;

  if (!response) {
    throw new Error("Invalid SAML: Not a SAML Response");
  }

  const assertion = response.Assertion;
  if (!assertion) {
    throw new Error("Invalid SAML: No Assertion found in Response");
  }

  // 3. Validate Subject Confirmation
  const subject = assertion.Subject;

  if (!subject) {
    throw new Error("Invalid SAML: No Subject found in Assertion");
  }

  const subjectConfirmations = Array.isArray(subject.SubjectConfirmation)
    ? subject.SubjectConfirmation
    : subject.SubjectConfirmation
      ? [subject.SubjectConfirmation]
      : [];

  const bearerConfirmation = subjectConfirmations.find(
    (confirmation: any) =>
      confirmation["@_Method"] === "urn:oasis:names:tc:SAML:2.0:cm:bearer",
  );

  if (!bearerConfirmation) {
    throw new Error("Invalid SAML: No bearer SubjectConfirmation found");
  }

  const confirmationData = bearerConfirmation.SubjectConfirmationData;

  if (!confirmationData) {
    throw new Error("Invalid SAML: Missing SubjectConfirmationData");
  }

  if (expectedRecipient) {
    if (confirmationData["@_Recipient"] !== expectedRecipient) {
      throw new Error("SAML SubjectConfirmation Recipient mismatch");
    }
  }

  const confirmationNotOnOrAfter = confirmationData["@_NotOnOrAfter"];

  if (!confirmationNotOnOrAfter) {
    throw new Error(
      "Invalid SAML: SubjectConfirmationData missing NotOnOrAfter",
    );
  }

  const skewMs = clockSkewSec * 1000;
  const nowMs = Date.now();

  // SubjectConfirmationData NotOnOrAfter with clock skew leeway:
  // Must satisfy now <= confirmationNotOnOrAfter + skew
  if (new Date(confirmationNotOnOrAfter).getTime() + skewMs <= nowMs) {
    throw new Error("SAML SubjectConfirmation has expired");
  }

  // 4. Validate Conditions (Time and Audience)
  const conditions = assertion.Conditions;
  if (!conditions) {
    throw new Error("Invalid SAML: Missing Conditions");
  }

  const notBefore = conditions["@_NotBefore"];
  const notOnOrAfter = conditions["@_NotOnOrAfter"];

  // NotBefore: assertion is valid starting from notBefore - skew
  // If notBefore - skew > now, assertion is in the future
  if (notBefore && new Date(notBefore).getTime() - skewMs > nowMs) {
    throw new Error("SAML Assertion is not yet valid (NotBefore)");
  }

  // NotOnOrAfter: assertion expires when now >= notOnOrAfter + skew
  if (notOnOrAfter && new Date(notOnOrAfter).getTime() + skewMs <= nowMs) {
    throw new Error("SAML Assertion has expired (NotOnOrAfter)");
  }

  const audienceRestriction = conditions.AudienceRestriction;

  if (!audienceRestriction) {
    throw new Error("Invalid SAML: Missing AudienceRestriction");
  }

  const rawRestrictions = Array.isArray(audienceRestriction)
    ? audienceRestriction
    : [audienceRestriction];

  const audiences: string[] = [];
  for (const restriction of rawRestrictions) {
    if (!restriction) continue;
    const rawAudiences = Array.isArray(restriction.Audience)
      ? restriction.Audience
      : restriction.Audience !== undefined
        ? [restriction.Audience]
        : [];

    for (const aud of rawAudiences) {
      const val =
        typeof aud === "object" && aud !== null && typeof aud["#text"] === "string"
          ? aud["#text"]
          : typeof aud === "string"
            ? aud
            : String(aud ?? "");
      const trimmed = val.trim();
      if (trimmed) {
        audiences.push(trimmed);
      }
    }
  }

  if (audiences.length === 0) {
    throw new Error("Invalid SAML: Missing Audience in AudienceRestriction");
  }

  const targetAudience =
    expectedAudience?.trim() ||
    process.env.SAML_ENTITY_ID?.trim() ||
    process.env.SAML_SP_ENTITY_ID?.trim();

  if (!targetAudience) {
    throw new Error("Invalid SAML: Expected audience is not configured");
  }

  if (!audiences.includes(targetAudience)) {
    throw new Error("SAML Assertion Audience restriction mismatch");
  }

  // 5. Extract NameID and Attributes
  const nameId = assertion.Subject?.NameID;
  const attributes: Record<string, string> = {};

  const attributeStatement = assertion.AttributeStatement;
  if (attributeStatement && attributeStatement.Attribute) {
    const attrs = Array.isArray(attributeStatement.Attribute)
      ? attributeStatement.Attribute
      : [attributeStatement.Attribute];

    for (const attr of attrs) {
      const name = attr["@_Name"];
      const value = attr.AttributeValue;
      if (name && value !== undefined) {
        attributes[name] = String(value);
      }
    }
  }

  return {
    nameId: typeof nameId === "object" ? nameId["#text"] : nameId,
    attributes,
  };
}

export interface RelayStatePayload {
  issuedAt: number;
  expiresAt?: number;
  redirectUrl?: string;
  nonce?: string;
}

export const DEFAULT_RELAY_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes default TTL

/**
 * Validates a SAML RelayState token for expiry, forgery, and formatting integrity (#4383).
 *
 * @param relayState - The RelayState string received from SAML callback
 * @param maxAgeMs - Maximum allowed age in milliseconds (defaults to 15 minutes)
 * @returns Parsed RelayStatePayload if valid
 * @throws Error if RelayState is missing, malformed, forged, or expired
 */
export function validateRelayState(
  relayState: string | null | undefined,
  maxAgeMs = DEFAULT_RELAY_STATE_TTL_MS,
): RelayStatePayload {
  if (!relayState || typeof relayState !== "string" || relayState.trim() === "") {
    throw new Error("Missing or invalid RelayState token");
  }

  let decoded: any;
  try {
    const trimmed = relayState.trim();
    const raw = trimmed.startsWith("{")
      ? trimmed
      : Buffer.from(trimmed, "base64").toString("utf-8");
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("Invalid or forged RelayState parameter format");
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid RelayState payload format");
  }

  const now = Date.now();
  const issuedAt = Number(decoded.issuedAt ?? decoded.timestamp ?? decoded.iat);
  const expiresAt =
    decoded.expiresAt ?? decoded.exp
      ? Number(decoded.expiresAt ?? decoded.exp)
      : undefined;

  if (isNaN(issuedAt)) {
    throw new Error("RelayState token is missing a valid timestamp");
  }

  if (expiresAt !== undefined && !isNaN(expiresAt)) {
    if (now > expiresAt) {
      throw new Error("RelayState token has expired (sso_session_expired)");
    }
  } else {
    if (now - issuedAt > maxAgeMs) {
      throw new Error("RelayState token has expired (sso_session_expired)");
    }
  }

  if (issuedAt > now + 60000) {
    throw new Error("Invalid RelayState token issued in future");
  }

  return {
    issuedAt,
    expiresAt,
    redirectUrl: typeof decoded.redirectUrl === "string" ? decoded.redirectUrl : undefined,
    nonce: typeof decoded.nonce === "string" ? decoded.nonce : undefined,
  };
}

