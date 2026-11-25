import {
  generateEscrowDiagnosticReport,
  copyEscrowDiagnosticReport,
  redactSensitiveData,
  EscrowPreflightDiagnosticContext,
} from '@/lib/solana/escrowClient';

describe('Escrow Preflight Diagnostic Report', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    // Restore navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    jest.restoreAllMocks();
  });

  describe('generateEscrowDiagnosticReport', () => {
    it('generates a full structured diagnostic report when all fields are provided', () => {
      const context: EscrowPreflightDiagnosticContext = {
        stage: 'preflight_simulation',
        error: new Error('Simulation failed: InstructionError [0, Custom(1)]'),
        signature: '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj780OT8bU5iM8Jrk3T9Ge18e8pXyk34V89DacxNV2pnqE73Y69z',
        cluster: 'devnet',
        endpoint: 'https://api.devnet.solana.com',
        timestamp: '2026-11-25T15:00:00.000Z',
        computeUnitsConsumed: 15420,
        instructionError: 'Custom(1)',
        simulationLogs: [
          'Program 11111111111111111111111111111111 invoke [1]',
          'Program log: Escrow initialization preflight check',
          'Program 11111111111111111111111111111111 failed: custom program error: 0x1',
        ],
        accountKeys: ['Sender1111111111111111111111111111111111111', 'Escrow1111111111111111111111111111111111111'],
        metadata: {
          escrowId: 'escrow-456',
          amount: 500000000,
        },
      };

      const report = generateEscrowDiagnosticReport(context);

      expect(report.stage).toBe('preflight_simulation');
      expect(report.errorMessage).toContain('Simulation failed');
      expect(report.signature).toBe('5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj780OT8bU5iM8Jrk3T9Ge18e8pXyk34V89DacxNV2pnqE73Y69z');
      expect(report.cluster).toBe('devnet');
      expect(report.endpoint).toBe('https://api.devnet.solana.com');
      expect(report.timestamp).toBe('2026-11-25T15:00:00.000Z');
      expect(report.computeUnitsConsumed).toBe(15420);
      expect(report.instructionError).toBe('Custom(1)');
      expect(report.simulationLogs).toHaveLength(3);
      expect(report.accountKeys).toEqual([
        'Sender1111111111111111111111111111111111111',
        'Escrow1111111111111111111111111111111111111',
      ]);

      // Verify formatted string
      expect(report.formattedReport).toContain('=== ESCROW PREFLIGHT DIAGNOSTIC REPORT ===');
      expect(report.formattedReport).toContain('Stage: preflight_simulation');
      expect(report.formattedReport).toContain('Cluster: devnet');
      expect(report.formattedReport).toContain('Endpoint: https://api.devnet.solana.com');
      expect(report.formattedReport).toContain('Signature: 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj780OT8bU5iM8Jrk3T9Ge18e8pXyk34V89DacxNV2pnqE73Y69z');
      expect(report.formattedReport).toContain('Compute Units Consumed: 15420');
      expect(report.formattedReport).toContain('Instruction Error: Custom(1)');
      expect(report.formattedReport).toContain('--- Simulation Logs (3) ---');
      expect(report.formattedReport).toContain('escrow-456');
    });

    it('clearly distinguishes unavailable/missing fields with N/A instead of inventing values', () => {
      const context: EscrowPreflightDiagnosticContext = {
        stage: 'prepare_transaction',
        error: 'Network request timed out before preflight',
      };

      const report = generateEscrowDiagnosticReport(context);

      expect(report.stage).toBe('prepare_transaction');
      expect(report.errorMessage).toBe('Network request timed out before preflight');
      expect(report.signature).toBe('N/A');
      expect(report.cluster).toBe('N/A');
      expect(report.endpoint).toBe('N/A');
      expect(report.computeUnitsConsumed).toBe('N/A');
      expect(report.instructionError).toBe('N/A');
      expect(report.simulationLogs).toEqual([]);
      expect(report.accountKeys).toEqual([]);
      expect(report.metadata).toBeUndefined();

      // Check formatted text output
      expect(report.formattedReport).toContain('Signature: N/A');
      expect(report.formattedReport).toContain('Cluster: N/A');
      expect(report.formattedReport).toContain('Endpoint: N/A');
      expect(report.formattedReport).toContain('Compute Units Consumed: N/A');
      expect(report.formattedReport).toContain('Instruction Error: N/A');
      expect(report.formattedReport).toContain('Simulation Logs: None available');
    });

    it('redacts sensitive information in error messages, logs, endpoints, and metadata', () => {
      const context: EscrowPreflightDiagnosticContext = {
        stage: 'send_transaction',
        error: new Error(
          'Failed authorization with secretKey [12,34,56,78,90,123,200,250] and privateKey: 4f3b2a1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a',
        ),
        endpoint: 'https://admin:superSecretP@ssword@rpc.example.com/api?apiKey=secret-token-xyz',
        simulationLogs: [
          'Authorization Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ae7bG_2xe',
          'Seed phrase: twelve words mnemonic phrase seed apple banana cherry dog elephant fox grape horse',
          'Normal log entry without secrets',
        ],
        metadata: {
          authHeader: 'Bearer secret-access-token-12345',
          secret: 'sensitiveSecret123',
        },
      };

      const report = generateEscrowDiagnosticReport(context);

      // Verify redaction in report fields
      expect(report.errorMessage).not.toContain('[12,34,56,78,90,123,200,250]');
      expect(report.errorMessage).not.toContain('4f3b2a1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a');
      expect(report.errorMessage).toContain('[REDACTED_CREDENTIAL]');

      expect(report.endpoint).not.toContain('superSecretP@ssword');
      expect(report.endpoint).toContain('https://[REDACTED_AUTH]@rpc.example.com/api?apiKey=secret-token-xyz');

      expect(report.simulationLogs[0]).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(report.simulationLogs[0]).toContain('[REDACTED_TOKEN]');

      expect(report.simulationLogs[1]).not.toContain('twelve words mnemonic phrase seed apple banana cherry dog elephant fox grape horse');
      expect(report.simulationLogs[1]).toContain('[REDACTED_SEED_PHRASE]');
      expect(report.simulationLogs[2]).toBe('Normal log entry without secrets');

      // Verify formatted text has sensitive data redacted
      expect(report.formattedReport).not.toContain('4f3b2a1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a');
      expect(report.formattedReport).not.toContain('superSecretP@ssword');
      expect(report.formattedReport).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });
  });

  describe('redactSensitiveData', () => {
    it('returns empty string when given non-string or empty input', () => {
      expect(redactSensitiveData('')).toBe('');
      // @ts-expect-error test non-string input
      expect(redactSensitiveData(null)).toBe('');
      // @ts-expect-error test non-string input
      expect(redactSensitiveData(undefined)).toBe('');
    });

    it('redacts URL basic authentication credentials', () => {
      const input = 'Error contacting https://user:p%40ssw0rd@solana-rpc.internal.net/v1';
      const output = redactSensitiveData(input);
      expect(output).toBe('Error contacting https://[REDACTED_AUTH]@solana-rpc.internal.net/v1');
    });

    it('redacts Bearer authorization tokens', () => {
      const input = 'Header: Bearer ya29.a0ARrdaM-sensitiveTokenValue123';
      const output = redactSensitiveData(input);
      expect(output).toBe('Header: Bearer [REDACTED_TOKEN]');
    });

    it('redacts secretKey and privateKey assignments', () => {
      const input = 'config: privateKey: 5Mii9P1234567890abcdef and secret_key="supersecret"';
      const output = redactSensitiveData(input);
      expect(output).toContain('privateKey: [REDACTED_CREDENTIAL]');
      expect(output).toContain('secret_key=[REDACTED_CREDENTIAL]');
    });
  });

  describe('copyEscrowDiagnosticReport', () => {
    it('successfully copies using navigator.clipboard when available', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(global, 'navigator', {
        value: {
          clipboard: {
            writeText: writeTextMock,
          },
        },
        writable: true,
        configurable: true,
      });

      const report = generateEscrowDiagnosticReport({
        stage: 'signature_confirmation',
        error: 'Confirmation timeout',
      });

      const result = await copyEscrowDiagnosticReport(report);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith(report.formattedReport);
    });

    it('accepts raw string report to copy', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(global, 'navigator', {
        value: {
          clipboard: {
            writeText: writeTextMock,
          },
        },
        writable: true,
        configurable: true,
      });

      const rawReport = '=== ESCROW PREFLIGHT DIAGNOSTIC REPORT ===\nStage: preflight';
      const result = await copyEscrowDiagnosticReport(rawReport);

      expect(result.success).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith(rawReport);
    });

    it('gracefully handles clipboard permission denied or writeText rejection', async () => {
      const writeTextMock = jest.fn().mockRejectedValue(new Error('Clipboard permission denied'));
      Object.defineProperty(global, 'navigator', {
        value: {
          clipboard: {
            writeText: writeTextMock,
          },
        },
        writable: true,
        configurable: true,
      });

      const result = await copyEscrowDiagnosticReport('Test report');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Clipboard permission denied');
    });

    it('gracefully handles environment where navigator.clipboard is undefined', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const result = await copyEscrowDiagnosticReport('Test report');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Clipboard API is not supported in this environment');
    });

    it('gracefully handles environment where global navigator is undefined', async () => {
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = await copyEscrowDiagnosticReport('Test report');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Clipboard API is not supported in this environment');
    });
  });
});
