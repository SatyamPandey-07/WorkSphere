import { validateSamlAssertion } from "@/lib/auth/sso/samlValidator";
import { SignedXml } from "xml-crypto";

jest.mock("xml-crypto", () => {
  return {
    SignedXml: jest.fn().mockImplementation(() => {
      return {
        keyInfoProvider: null as any,
        loadSignature: jest.fn(),
        checkSignature: jest.fn(),
        validationErrors: ["Signature verification failed"],
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
      keyInfoProvider: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
      validationErrors: [],
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(mockSignedXmlInstance);

    const result = validateSamlAssertion(mockXml, multiLineCert, "http://sp.example.com");

    expect(result.nameId).toBe("user@example.com");
    expect(result.attributes.email).toBe("user@example.com");

    const keyInfo = mockSignedXmlInstance.keyInfoProvider.getKeyInfo();
    const key = mockSignedXmlInstance.keyInfoProvider.getKey();

    expect(keyInfo).toContain("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r");
    expect(keyInfo).not.toContain("-----BEGIN CERTIFICATE-----");
    expect(keyInfo).not.toContain("\n");

    const keyString = key.toString();
    expect(keyString).toContain("-----BEGIN CERTIFICATE-----");
    expect(keyString).toContain("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r");
    expect(keyString).toContain("-----END CERTIFICATE-----");
  });

  it("should normalize whitespace-heavy certs and reformat them correctly", () => {
    const mockSignedXmlInstance = {
      keyInfoProvider: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
      validationErrors: [],
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(mockSignedXmlInstance);

    const result = validateSamlAssertion(mockXml, whitespaceCert, "http://sp.example.com");

    expect(result.nameId).toBe("user@example.com");

    const keyInfo = mockSignedXmlInstance.keyInfoProvider.getKeyInfo();
    expect(keyInfo).toBe("<X509Data><X509Certificate>MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3r</X509Certificate></X509Data>");
  });

  it("should maintain compatibility with single-line certificates", () => {
    const mockSignedXmlInstance = {
      keyInfoProvider: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(true),
      validationErrors: [],
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(mockSignedXmlInstance);

    const result = validateSamlAssertion(mockXml, singleLineCert, "http://sp.example.com");

    expect(result.nameId).toBe("user@example.com");

    const keyInfo = mockSignedXmlInstance.keyInfoProvider.getKeyInfo();
    expect(keyInfo).toContain(singleLineCert);
  });

  it("should reject invalid/unmatching signatures", () => {
    const mockSignedXmlInstance = {
      keyInfoProvider: null as any,
      loadSignature: jest.fn(),
      checkSignature: jest.fn().mockReturnValue(false),
      validationErrors: ["Signature check returned false"],
    };
    (SignedXml as unknown as jest.Mock).mockReturnValueOnce(mockSignedXmlInstance);

    expect(() => {
      validateSamlAssertion(mockXml, singleLineCert, "http://sp.example.com");
    }).toThrow("SAML Signature validation failed: Signature check returned false");
  });
});
