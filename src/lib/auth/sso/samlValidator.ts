import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { XMLParser } from "fast-xml-parser";

/**
 * Validates a SAML 2.0 XML Assertion.
 *
 * @param xmlString - The raw XML string of the SAML Response or Assertion
 * @param expectedCert - The expected X.509 certificate string from the IDP metadata
 * @param expectedAudience - (Optional) The expected audience (EntityID) of our SP
 * @returns An object containing the extracted NameID and attributes if valid
 */
export function validateSamlAssertion(
  xmlString: string,
  expectedCert: string,
  expectedAudience?: string,
  expectedRecipient?: string,
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

  if (new Date(confirmationNotOnOrAfter) <= new Date()) {
    throw new Error("SAML SubjectConfirmation has expired");
  }

  // 4. Validate Conditions (Time and Audience)
  const conditions = assertion.Conditions;
  if (conditions) {
    const notBefore = conditions["@_NotBefore"];
    const notOnOrAfter = conditions["@_NotOnOrAfter"];
    const now = new Date();

    if (notBefore && new Date(notBefore) > now) {
      throw new Error("SAML Assertion is not yet valid (NotBefore)");
    }

    if (notOnOrAfter && new Date(notOnOrAfter) <= now) {
      throw new Error("SAML Assertion has expired (NotOnOrAfter)");
    }

    if (expectedAudience) {
      const audienceRestriction = conditions.AudienceRestriction;

      if (!audienceRestriction) {
        throw new Error("Invalid SAML: Missing AudienceRestriction");
      }

      const audiences = Array.isArray(audienceRestriction.Audience)
        ? audienceRestriction.Audience
        : [audienceRestriction.Audience];

      if (!audiences.includes(expectedAudience)) {
        throw new Error("SAML Assertion Audience restriction mismatch");
      }
    }
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
