import { validateSamlAssertion } from "@/lib/auth/sso/samlValidator";
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
