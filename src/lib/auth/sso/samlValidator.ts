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
export function validateSamlAssertion(xmlString: string, expectedCert: string, expectedAudience?: string) {
  // 1. Verify XML Signature using xml-crypto
  const doc = new DOMParser().parseFromString(xmlString, "text/xml");
  const signature = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];

  if (!signature) {
    throw new Error("Invalid SAML: No signature found");
  }

  const sig = new SignedXml();
  // Provide the certificate to the verifier
  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${expectedCert}</X509Certificate></X509Data>`,
    getKey: () => `-----BEGIN CERTIFICATE-----\n${expectedCert.replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`
  };

  sig.loadSignature(signature.toString());
  const isValid = sig.checkSignature(xmlString);

  if (!isValid) {
    throw new Error(`SAML Signature validation failed: ${sig.validationErrors.join(", ")}`);
  }

  // 2. Parse the validated XML to extract details
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });

  const parsed = parser.parse(xmlString);
  const response = parsed.Response;

  if (!response) {
    throw new Error("Invalid SAML: Not a SAML Response");
  }

  const assertion = response.Assertion;
  if (!assertion) {
    throw new Error("Invalid SAML: No Assertion found in Response");
  }

  // 3. Validate Conditions (Time and Audience)
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
      if (audienceRestriction) {
        const audiences = Array.isArray(audienceRestriction.Audience)
          ? audienceRestriction.Audience
          : [audienceRestriction.Audience];
        
        if (!audiences.includes(expectedAudience)) {
          throw new Error("SAML Assertion Audience restriction mismatch");
        }
      }
    }
  }

  // 4. Extract NameID and Attributes
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
