import {
  resolveIdpMetadata,
  UnsafeMetadataUrlError,
} from "@/lib/auth/sso/metadataResolver";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";

jest.mock("@/lib/ssrfValidation", () => ({
  isSafeWebhookUrl: jest.fn(),
}));

const mockedIsSafe = isSafeWebhookUrl as jest.MockedFunction<
  typeof isSafeWebhookUrl
>;

const METADATA_XML = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com">
  <IDPSSODescriptor>
    <KeyDescriptor use="signing">
      <KeyInfo>
        <X509Data>
          <X509Certificate>CERT</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso" />
  </IDPSSODescriptor>
</EntityDescriptor>`;

describe("resolveIdpMetadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects URLs that fail SSRF validation without fetching", async () => {
    mockedIsSafe.mockResolvedValue({
      isSafe: false,
      reason: "Resolved IP (127.0.0.1) falls into a forbidden private network range.",
    });
    const fetchSpy = jest.spyOn(global, "fetch");

    await expect(
      resolveIdpMetadata("http://127.0.0.1/secret"),
    ).rejects.toBeInstanceOf(UnsafeMetadataUrlError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches with redirects disabled and parses valid metadata when safe", async () => {
    mockedIsSafe.mockResolvedValue({ isSafe: true });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => METADATA_XML,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const metadata = await resolveIdpMetadata(
      "https://idp.example.com/metadata",
    );

    expect(metadata.entityId).toBe("https://idp.example.com");
    expect(metadata.ssoUrl).toBe("https://idp.example.com/sso");
    expect(metadata.x509Certificates).toEqual(["CERT"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://idp.example.com/metadata",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("surfaces a generic error when the metadata endpoint fails", async () => {
    mockedIsSafe.mockResolvedValue({ isSafe: true });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "",
    }) as unknown as typeof fetch;

    await expect(
      resolveIdpMetadata("https://idp.example.com/metadata"),
    ).rejects.toThrow("Could not resolve IDP Metadata");
  });
});
