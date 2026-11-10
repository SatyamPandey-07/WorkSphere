import { decodeTupleValue, registerCustomOid } from './tupleDecoder';

interface WalStreamerConfig {
  connectionString: string;
  slotName: string;
  publicationName: string;
}

export class WalStreamer {
  private config: WalStreamerConfig;
  private lastReceivedLsn: string = '0/0';
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor(config: WalStreamerConfig) {
    this.config = config;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    await this.connectAndStream();
  }

  private async connectAndStream(): Promise<void> {
    while (this.isRunning) {
      try {
        console.log(`Connecting to PostgreSQL logical replication slot [${this.config.slotName}] at LSN: ${this.lastReceivedLsn}`);
        
        // Simulate pgoutput replication connection lifecycle
        // In production, use pg-logical-replication or pg driver with streaming mode
        
        this.reconnectAttempts = 0; // Reset on successful connection
        await this.simulateStream();
      } catch (error) {
        this.reconnectAttempts++;
        console.error(`Replication stream disconnected (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          throw new Error('Max replication reconnection attempts exceeded.');
        }

        // Exponential backoff before reconnecting
        const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  private async simulateStream(): Promise<void> {
    // Simulated event loop for streaming WAL mutations
    while (this.isRunning) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      // Update simulated LSN tracking
      this.lastReceivedLsn = '0/' + Math.floor(Math.random() * 1000000).toString(16);
    }
  }

  public handleMutationPacket(lsn: string, oid: number, dataBuffer: Buffer) {
    this.lastReceivedLsn = lsn;
    const decoded = decodeTupleValue(oid, dataBuffer);
    return decoded;
  }

  public stop(): void {
    this.isRunning = false;
  }

  public getLastLsn(): string {
    return this.lastReceivedLsn;
  }
}