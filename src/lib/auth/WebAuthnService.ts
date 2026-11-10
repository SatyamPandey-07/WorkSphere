/**
 * WebAuthnService.ts
 * Handles the WebAuthn passkey registration ceremony, including fetching creation options,
 * invoking navigator.credentials.create(), and sending the attestation response to the server.
 */

export interface PasskeyRegistrationOptions {
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { type: "public-key"; alg: number }[];
    timeout: number;
    attestation: AttestationConveyancePreference;
    authenticatorSelection: {
        residentKey: ResidentKeyRequirement;
        userVerification: UserVerificationRequirement;
    };
}

export interface PasskeyRegistrationResponse {
    id: string;
    rawId: string;
    response: {
        clientDataJSON: string;
        attestationObject: string;
    };
    type: string;
}

export class WebAuthnService {
    private baseUrl: string;

    constructor(baseUrl: string = '/api/auth/passkey') {
        this.baseUrl = baseUrl;
    }

    public async getRegistrationOptions(): Promise<PasskeyRegistrationOptions> {
        const response = await fetch(`${this.baseUrl}/register/options`, {
            method: 'GET',
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error('Failed to fetch passkey registration options');
        }

        return response.json();
    }

    public async createPasskey(options: PasskeyRegistrationOptions): Promise<PasskeyRegistrationResponse> {
        const publicKey: PublicKeyCredentialCreationOptions = {
            ...options,
            challenge: this.base64UrlToArrayBuffer(options.challenge),
            user: {
                ...options.user,
                id: this.base64UrlToArrayBuffer(options.user.id),
            },
        };

        try {
            const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;

            const response = credential.response as AuthenticatorAttestationResponse;

            return {
                id: credential.id,
                rawId: this.arrayBufferToBase64Url(credential.rawId),
                response: {
                    clientDataJSON: this.arrayBufferToBase64Url(response.clientDataJSON),
                    attestationObject: this.arrayBufferToBase64Url(response.attestationObject),
                },
                type: credential.type,
            };
        } catch (error: any) {
            if (error.name === 'NotAllowedError') {
                throw new Error('Passkey registration was cancelled or denied by the user.');
            }
            throw new Error(`WebAuthn creation failed: ${error.message}`);
        }
    }

    public async verifyRegistration(payload: PasskeyRegistrationResponse): Promise<boolean> {
        const response = await fetch(`${this.baseUrl}/register/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error('Failed to verify passkey registration on server');
        }

        const result = await response.json();
        return result.success;
    }

    private base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
        const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64);
        const buffer = new ArrayBuffer(binary.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) {
            view[i] = binary.charCodeAt(i);
        }
        return buffer;
    }

    private arrayBufferToBase64Url(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
}
