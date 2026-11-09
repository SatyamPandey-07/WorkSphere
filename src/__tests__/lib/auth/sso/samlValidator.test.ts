import { validateSamlAssertion, validateRelayState } from "@/lib/auth/sso/samlValidator";
import { SignedXml } from "xml-crypto";

jest.mock("xml-crypto", () => {
  return {
    SignedXml: jest.fn().mockImplementation(() => {
      return {
        publicCert: null as any,
        loadSignature: jest.fn(),
        checkSignature: jest.fn(),
      };
    }),
  };
});

describe("SAML Certificate Validation (#1714)", () => {
  const mockXml = `
    <Response>
      <Assertion>
        <Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2099-01-01T00:00:00Z">
          <AudienceRestriction>
            <Audience>http://sp.example.com</Audience>
          </AudienceRestriction>
        </Conditions>
        <Subject>
          <NameID>user@example.com</NameID>
        </Subject>
        <AttributeStatement>
          <Attribute Name="email">
            <AttributeValue>user@example.com</AttributeValue>
          </Attribute>
        </AttributeStatement>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignatureValue>dummy</SignatureValue>
        </Signature>
      </Assertion>
    </Response>
  `;

  const singleLineCert = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r";
  const multiLineCert = `
-----BEGIN CERTIFICATE-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r
-----END CERTIFICATE-----
  `;
  const whitespaceCert = `
    -----BEGIN CERTIFICATE-----
    MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
    MIIBCgKCAQEA0Y3r
    -----END CERTIFICATE-----
  `;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should normalize and validate multi-line PEM certificates successfully", () => {
    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(
      mockSignedXmlInstance,
    );

    const result = validateSamlAssertion(
      mockXml,
      multiLineCert,
      "http://sp.example.com",
    );

    expect(result.nameId).toBe("user@example.com");
    expect(result.attributes.email).toBe("user@example.com");

    const keyString = mockSignedXmlInstance.publicCert.toString();
    expect(keyString).toContain("-----BEGIN CERTIFICATE-----");
    expect(keyString).toContain(
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r",
    );
    expect(keyString).toContain("-----END CERTIFICATE-----");
  });

  it("should normalize whitespace-heavy certs and reformat them correctly", () => {
    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(
      mockSignedXmlInstance,
    );

    const result = validateSamlAssertion(
      mockXml,
      whitespaceCert,
      "http://sp.example.com",
    );

    expect(result.nameId).toBe("user@example.com");

    const keyString = mockSignedXmlInstance.publicCert.toString();
    expect(keyString).toContain(
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r",
    );
    expect(keyString).not.toContain(
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n    MIIBCgKCAQEA0Y3r",
    );
  });

  it("should maintain compatibility with single-line certificates", () => {
    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(
      mockSignedXmlInstance,
    );

    const result = validateSamlAssertion(
      mockXml,
      singleLineCert,
      "http://sp.example.com",
    );

    expect(result.nameId).toBe("user@example.com");

    const keyString = mockSignedXmlInstance.publicCert.toString();
    expect(keyString).toContain(singleLineCert);
  });

  it("should reject invalid/unmatching signatures", () => {
    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(false),
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(
      mockSignedXmlInstance,
    );

    expect(() => {
      validateSamlAssertion(mockXml, singleLineCert, "http://sp.example.com");
    }).toThrow("SAML Signature validation failed");
  });

  it("should surface an error thrown during signature verification", () => {
    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockImplementation(() => {
        throw new Error(
          "invalid signature: the signature value dummy is incorrect",
        );
      }),
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(
      mockSignedXmlInstance,
    );

    expect(() => {
      validateSamlAssertion(mockXml, singleLineCert, "http://sp.example.com");
    }).toThrow(
      "SAML Signature validation failed: invalid signature: the signature value dummy is incorrect",
    );
  });
});

describe("validateRelayState (#4383)", () => {
  test("throws error when RelayState token is missing, null, or empty string", () => {
    expect(() => validateRelayState(null)).toThrow("Missing or invalid RelayState token");
    expect(() => validateRelayState(undefined)).toThrow("Missing or invalid RelayState token");
    expect(() => validateRelayState("   ")).toThrow("Missing or invalid RelayState token");
  });

  test("throws error when RelayState token is malformed or forged JSON", () => {
    expect(() => validateRelayState("invalid-non-json-token")).toThrow(
      "Invalid or forged RelayState parameter format"
    );
    const forgedBase64 = Buffer.from("not-a-json-payload").toString("base64");
    expect(() => validateRelayState(forgedBase64)).toThrow(
      "Invalid or forged RelayState parameter format"
    );
  });

  test("validates non-expired JSON RelayState token within TTL window", () => {
    const validToken = JSON.stringify({
      issuedAt: Date.now() - 5000,
      redirectUrl: "/dashboard",
      nonce: "random-nonce-123",
    });

    const parsed = validateRelayState(validToken);
    expect(parsed.redirectUrl).toBe("/dashboard");
    expect(parsed.nonce).toBe("random-nonce-123");
  });

  test("validates non-expired Base64 encoded RelayState token", () => {
    const payload = JSON.stringify({
      issuedAt: Date.now() - 10000,
      expiresAt: Date.now() + 300000,
      redirectUrl: "/profile",
    });
    const base64Token = Buffer.from(payload).toString("base64");

    const parsed = validateRelayState(base64Token);
    expect(parsed.redirectUrl).toBe("/profile");
  });

  test("rejects expired RelayState token exceeding TTL window", () => {
    const expiredToken = JSON.stringify({
      issuedAt: Date.now() - 20 * 60 * 1000, // 20 minutes ago
    });

    expect(() => validateRelayState(expiredToken)).toThrow(
      "RelayState token has expired (sso_session_expired)"
    );
  });

  test("rejects expired RelayState token with explicit past expiresAt", () => {
    const expiredToken = JSON.stringify({
      issuedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
    });

    expect(() => validateRelayState(expiredToken)).toThrow(
      "RelayState token has expired (sso_session_expired)"
    );
  });

  test("rejects RelayState token issued in future beyond clock-skew tolerance", () => {
    const futureToken = JSON.stringify({
      issuedAt: Date.now() + 120000, // 2 minutes in future
    });

    expect(() => validateRelayState(futureToken)).toThrow(
      "Invalid RelayState token issued in future"
    );
  });
});

describe("SAML Audience Restriction Validation (#4572)", () => {
  const validXml = `
    <Response>
      <Assertion>
        <Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2099-01-01T00:00:00Z">
          <AudienceRestriction>
            <Audience>http://sp.example.com</Audience>
          </AudienceRestriction>
        </Conditions>
        <Subject>
          <NameID>user@example.com</NameID>
        </Subject>
        <AttributeStatement>
          <Attribute Name="email">
            <AttributeValue>user@example.com</AttributeValue>
          </Attribute>
        </AttributeStatement>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignatureValue>dummy</SignatureValue>
        </Signature>
      </Assertion>
    </Response>
  `;

  const missingAudienceRestrictionXml = `
    <Response>
      <Assertion>
        <Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2099-01-01T00:00:00Z">
        </Conditions>
        <Subject>
          <NameID>user@example.com</NameID>
        </Subject>
        <AttributeStatement>
          <Attribute Name="email">
            <AttributeValue>user@example.com</AttributeValue>
          </Attribute>
        </AttributeStatement>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignatureValue>dummy</SignatureValue>
        </Signature>
      </Assertion>
    </Response>
  `;

  const missingConditionsXml = `
    <Response>
      <Assertion>
        <Subject>
          <NameID>user@example.com</NameID>
        </Subject>
        <AttributeStatement>
          <Attribute Name="email">
            <AttributeValue>user@example.com</AttributeValue>
          </Attribute>
        </AttributeStatement>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignatureValue>dummy</SignatureValue>
        </Signature>
      </Assertion>
    </Response>
  `;

  const emptyAudienceXml = `
    <Response>
      <Assertion>
        <Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2099-01-01T00:00:00Z">
          <AudienceRestriction>
          </AudienceRestriction>
        </Conditions>
        <Subject>
          <NameID>user@example.com</NameID>
        </Subject>
        <AttributeStatement>
          <Attribute Name="email">
            <AttributeValue>user@example.com</AttributeValue>
          </Attribute>
        </AttributeStatement>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignatureValue>dummy</SignatureValue>
        </Signature>
      </Assertion>
    </Response>
  `;

  const multipleAudiencesXml = `
    <Response>
      <Assertion>
        <Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2099-01-01T00:00:00Z">
          <AudienceRestriction>
            <Audience>http://other-sp.com</Audience>
            <Audience>http://sp.example.com</Audience>
          </AudienceRestriction>
        </Conditions>
        <Subject>
          <NameID>user@example.com</NameID>
        </Subject>
        <AttributeStatement>
          <Attribute Name="email">
            <AttributeValue>user@example.com</AttributeValue>
          </Attribute>
        </AttributeStatement>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignatureValue>dummy</SignatureValue>
        </Signature>
      </Assertion>
    </Response>
  `;

  const testCert = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r";
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SAML_ENTITY_ID;
    delete process.env.SAML_SP_ENTITY_ID;

    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
    };
    (SignedXml as unknown as jest.Mock).mockReturnValue(mockSignedXmlInstance);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should validate assertion when audience strictly matches expectedAudience parameter", () => {
    const result = validateSamlAssertion(
      validXml,
      testCert,
      "http://sp.example.com",
    );
    expect(result.nameId).toBe("user@example.com");
    expect(result.attributes.email).toBe("user@example.com");
  });

  it("should validate assertion when expected audience is resolved from process.env.SAML_ENTITY_ID", () => {
    process.env.SAML_ENTITY_ID = "http://sp.example.com";
    const result = validateSamlAssertion(validXml, testCert);
    expect(result.nameId).toBe("user@example.com");
  });

  it("should validate assertion when expected audience is resolved from process.env.SAML_SP_ENTITY_ID", () => {
    process.env.SAML_SP_ENTITY_ID = "http://sp.example.com";
    const result = validateSamlAssertion(validXml, testCert);
    expect(result.nameId).toBe("user@example.com");
  });

  it("should accept assertion containing multiple Audience elements when one matches", () => {
    const result = validateSamlAssertion(
      multipleAudiencesXml,
      testCert,
      "http://sp.example.com",
    );
    expect(result.nameId).toBe("user@example.com");
  });

  it("should reject assertion with mismatched audience value", () => {
    expect(() => {
      validateSamlAssertion(
        validXml,
        testCert,
        "http://mismatched-sp.com",
      );
    }).toThrow("SAML Assertion Audience restriction mismatch");
  });

  it("should reject assertion when AudienceRestriction element is missing", () => {
    expect(() => {
      validateSamlAssertion(
        missingAudienceRestrictionXml,
        testCert,
        "http://sp.example.com",
      );
    }).toThrow("Invalid SAML: Missing AudienceRestriction");
  });

  it("should reject assertion when Conditions element is missing entirely", () => {
    expect(() => {
      validateSamlAssertion(
        missingConditionsXml,
        testCert,
        "http://sp.example.com",
      );
    }).toThrow("Invalid SAML: Missing Conditions");
  });

  it("should reject assertion when Audience element is missing inside AudienceRestriction", () => {
    expect(() => {
      validateSamlAssertion(
        emptyAudienceXml,
        testCert,
        "http://sp.example.com",
      );
    }).toThrow("Invalid SAML: Missing Audience in AudienceRestriction");
  });

  it("should reject assertion when expected audience is not configured and not passed", () => {
    expect(() => {
      validateSamlAssertion(validXml, testCert);
    }).toThrow("Invalid SAML: Expected audience is not configured");
  });
});

describe("SAML Clock Skew Leeway Window Validation (#4798)", () => {
  const testCert = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r";

  function buildAssertionXml(notBefore: string, notOnOrAfter: string, confirmationNotOnOrAfter?: string) {
    const confTime = confirmationNotOnOrAfter ?? notOnOrAfter;
    return `
      <Response>
        <Assertion>
          <Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
            <AudienceRestriction>
              <Audience>http://sp.example.com</Audience>
            </AudienceRestriction>
          </Conditions>
          <Subject>
            <NameID>user@example.com</NameID>
            <SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
              <SubjectConfirmationData NotOnOrAfter="${confTime}" />
            </SubjectConfirmation>
          </Subject>
          <AttributeStatement>
            <Attribute Name="email">
              <AttributeValue>user@example.com</AttributeValue>
            </Attribute>
          </AttributeStatement>
          <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
            <SignatureValue>dummy</SignatureValue>
          </Signature>
        </Assertion>
      </Response>
    `;
  }

  beforeEach(() => {
    const mockSignedXmlInstance = {
      publicCert: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
      getSignedReferences: jest.fn().mockReturnValue([
        // returns full assertion
      ]),
    };
    (SignedXml as unknown as jest.Mock).mockImplementation(() => {
      return {
        publicCert: null as any,
        loadSignature: jest.fn(),
        checkSignature: jest.fn().mockReturnValue(true),
        getSignedReferences: jest.fn().mockImplementation(function (this: any) {
          return [this._xmlString];
        }),
        _xmlString: "",
      };
    });
  });

  it("accepts assertion when IdP server clock is drifted 30 seconds ahead (NotBefore is 30s in future)", () => {
    const now = Date.now();
    // IdP clock is ahead: NotBefore is set to 30 seconds in the future
    const notBefore = new Date(now + 30 * 1000).toISOString();
    const notOnOrAfter = new Date(now + 10 * 60 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter);
    const result = validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    expect(result.nameId).toBe("user@example.com");
  });

  it("accepts assertion when IdP server clock is drifted 30 seconds behind (NotOnOrAfter expired 30s ago)", () => {
    const now = Date.now();
    // IdP clock is behind: NotOnOrAfter was 30 seconds ago
    const notBefore = new Date(now - 10 * 60 * 1000).toISOString();
    const notOnOrAfter = new Date(now - 30 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter);
    const result = validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    expect(result.nameId).toBe("user@example.com");
  });

  it("rejects assertion when IdP server clock drift exceeds 60s skew window in the future (NotBefore)", () => {
    const now = Date.now();
    // IdP clock is 70 seconds ahead -> outside 60s window
    const notBefore = new Date(now + 70 * 1000).toISOString();
    const notOnOrAfter = new Date(now + 10 * 60 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter);
    expect(() => {
      validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    }).toThrow("SAML Assertion is not yet valid (NotBefore)");
  });

  it("rejects assertion when IdP server clock drift exceeds 60s skew window in the past (NotOnOrAfter)", () => {
    const now = Date.now();
    // IdP clock is 70 seconds expired -> outside 60s window
    const notBefore = new Date(now - 10 * 60 * 1000).toISOString();
    const notOnOrAfter = new Date(now - 70 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter);
    expect(() => {
      validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    }).toThrow("SAML Assertion has expired (NotOnOrAfter)");
  });

  it("supports configurable clockSkewSec argument (e.g. 10s strict window)", () => {
    const now = Date.now();
    // 20 seconds ahead: should fail with 10s skew, succeed with default 60s skew
    const notBefore = new Date(now + 20 * 1000).toISOString();
    const notOnOrAfter = new Date(now + 5 * 60 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter);

    expect(() => {
      validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 10);
    }).toThrow("SAML Assertion is not yet valid (NotBefore)");

    const result = validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    expect(result.nameId).toBe("user@example.com");
  });

  it("accepts SubjectConfirmationData NotOnOrAfter within clock skew window", () => {
    const now = Date.now();
    const notBefore = new Date(now - 60 * 1000).toISOString();
    const notOnOrAfter = new Date(now + 5 * 60 * 1000).toISOString();
    // Subject confirmation expired 25 seconds ago (within 60s leeway)
    const confTime = new Date(now - 25 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter, confTime);
    const result = validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    expect(result.nameId).toBe("user@example.com");
  });

  it("rejects SubjectConfirmationData NotOnOrAfter when expired beyond clock skew window", () => {
    const now = Date.now();
    const notBefore = new Date(now - 60 * 1000).toISOString();
    const notOnOrAfter = new Date(now + 5 * 60 * 1000).toISOString();
    // Subject confirmation expired 80 seconds ago (outside 60s leeway)
    const confTime = new Date(now - 80 * 1000).toISOString();

    const xml = buildAssertionXml(notBefore, notOnOrAfter, confTime);
    expect(() => {
      validateSamlAssertion(xml, testCert, "http://sp.example.com", undefined, 60);
    }).toThrow("SAML SubjectConfirmation has expired");
  });
});


