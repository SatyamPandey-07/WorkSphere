import {
  StreamingPaymentChannel,
  ChannelConfig,
  StateTicket,
} from '../../core/finance/StreamingPaymentChannel';

describe('StreamingPaymentChannel', () => {
  const payerSecret = 'secret-payer-key-12345';
  const payeeSecret = 'secret-payee-key-67890';
  let defaultConfig: ChannelConfig;

  beforeEach(() => {
    defaultConfig = {
      channelId: 'chan-001',
      payerId: 'alice',
      payeeId: 'bob',
      tokenSymbol: 'USDC',
      initialCapacity: 100.0,
      flowRatePerSec: 0.5,
      challengePeriodSec: 2,
      expirationTimestamp: Date.now() + 86400000,
    };
  });

  describe('Channel Initialization & Capacity', () => {
    it('initializes with correct escrow capacity and OPEN status', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      expect(channel.getStatus()).toBe('OPEN');
      expect(channel.getTotalEscrow()).toBe(100.0);
      expect(channel.getRemainingCapacity()).toBe(100.0);
      expect(channel.getLatestTicket()).toBeNull();
    });

    it('rejects non-positive capacity or past expiration timestamps', () => {
      expect(() => {
        new StreamingPaymentChannel({ ...defaultConfig, initialCapacity: 0 });
      }).toThrow('Initial channel capacity must be positive');

      expect(() => {
        new StreamingPaymentChannel({ ...defaultConfig, expirationTimestamp: Date.now() - 1000 });
      }).toThrow('Channel expiration must be in the future');
    });
  });

  describe('Off-Chain State Ticket Generation & Verification', () => {
    it('payer generates valid cryptographic state tickets', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      const ticket = channel.generateStateTicket(25.0);

      expect(ticket.channelId).toBe('chan-001');
      expect(ticket.nonce).toBe(1);
      expect(ticket.cumulativeAmountPaid).toBe(25.0);
      expect(ticket.signature).toBeDefined();
    });

    it('payee accepts valid monotonic ticket and updates STREAMING status', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      const ticket1 = channel.generateStateTicket(10.0);
      expect(channel.acceptTicket(ticket1)).toBe(true);
      expect(channel.getStatus()).toBe('STREAMING');
      expect(channel.getRemainingCapacity()).toBe(90.0);

      const ticket2 = channel.generateStateTicket(20.0);
      expect(channel.acceptTicket(ticket2)).toBe(true);
      expect(channel.getRemainingCapacity()).toBe(80.0);
    });

    it('rejects tickets with non-monotonic nonce or decreasing payment amount', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      const ticket1 = channel.generateStateTicket(30.0, 5);
      expect(channel.acceptTicket(ticket1)).toBe(true);

      // Attempt rewind: lower nonce
      const rewindTicket = channel.generateStateTicket(35.0, 4);
      expect(channel.acceptTicket(rewindTicket)).toBe(false);

      // Attempt rewind: lower cumulative amount
      const lowerAmountTicket = channel.generateStateTicket(25.0, 6);
      expect(channel.acceptTicket(lowerAmountTicket)).toBe(false);
    });

    it('rejects tickets with forged signatures or exceeding total escrow', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      const ticket = channel.generateStateTicket(15.0);
      const forgedTicket: StateTicket = {
        ...ticket,
        signature: 'deadbeef'.repeat(8),
      };
      expect(channel.acceptTicket(forgedTicket)).toBe(false);

      expect(() => {
        channel.generateStateTicket(150.0); // Exceeds capacity of 100.0
      }).toThrow('exceeds channel capacity');
    });
  });

  describe('Continuous Micro-Payment Streaming & Top-Up', () => {
    it('accumulates continuous streaming ticks based on flowRatePerSec', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      // flowRate = 0.5 units/sec, 10 seconds elapsed -> 5.0 units
      const ticket = channel.streamTicks(10);
      expect(ticket.cumulativeAmountPaid).toBe(5.0);
      expect(channel.getRemainingCapacity()).toBe(95.0);

      // Another 20 seconds -> 10.0 more units -> 15.0 total
      const ticket2 = channel.streamTicks(20);
      expect(ticket2.cumulativeAmountPaid).toBe(15.0);
      expect(channel.getRemainingCapacity()).toBe(85.0);
    });

    it('allows topping up channel capacity during active streaming', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      channel.streamTicks(50); // 25 units paid, 75 remaining
      expect(channel.getRemainingCapacity()).toBe(75.0);

      channel.topUp(50.0); // Now total escrow is 150.0
      expect(channel.getTotalEscrow()).toBe(150.0);
      expect(channel.getRemainingCapacity()).toBe(125.0);
    });
  });

  describe('Cooperative vs Unilateral Settlement', () => {
    it('settles instantly on cooperative mutual closure with payee co-signature', () => {
      const channel = new StreamingPaymentChannel(defaultConfig, payerSecret, payeeSecret);
      const finalTicket = channel.generateStateTicket(40.0);
      channel.acceptTicket(finalTicket);

      // Payee co-signs the final ticket
      const payeeMutualSig = channel.computeTicketSignature(
        finalTicket.channelId,
        finalTicket.nonce,
        finalTicket.cumulativeAmountPaid,
        finalTicket.timestamp,
        payeeSecret
      );

      const settlement = channel.cooperativeClose(finalTicket, payeeMutualSig);
      expect(settlement.status).toBe('SETTLED');
      expect(settlement.payeePayout).toBe(40.0);
      expect(settlement.payerPayout).toBe(60.0);
      expect(channel.getStatus()).toBe('SETTLED');
    });

    it('manages unilateral closure dispute challenge window and counter-ticket submission', () => {
      const channel = new StreamingPaymentChannel(
        { ...defaultConfig, challengePeriodSec: 0.1 },
        payerSecret,
        payeeSecret
      );

      const ticket1 = channel.generateStateTicket(10.0, 1);
      const ticket2 = channel.generateStateTicket(25.0, 2);

      // Claimant initiates dispute with outdated ticket1
      const dispute = channel.initiateUnilateralClose(ticket1, 'bob');
      expect(channel.getStatus()).toBe('CHALLENGING');
      expect(dispute.disputeTicket.nonce).toBe(1);

      // Other party submits higher counter ticket2
      const counterSuccess = channel.submitCounterTicket(ticket2);
      expect(counterSuccess).toBe(true);

      // Attempting to submit a lower ticket as counter fails
      expect(channel.submitCounterTicket(ticket1)).toBe(false);
    });
  });
});
