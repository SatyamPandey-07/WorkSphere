import { Client } from "pg";
import { redis } from "@/lib/redis";

export interface CDCEvent {
  table: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  commitLsn: string;
  timestamp: number;
  newRow: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
}

const TARGET_TABLES = new Set(["Booking", "TelemetryReading", "DeskHoldLock"]);
const REDIS_CHANNEL = "cdc:db_events";
const REPLICATION_SLOT_NAME =
  process.env.PG_REPLICATION_SLOT || "worksphere_cdc_slot";
const PUBLICATION_NAME = process.env.PG_PUBLICATION_NAME || "worksphere_pub";

export class PostgresCDCStreamer {
  private client: any = null;
  private isRunning: boolean = false;
  private currentLsn: string = "0/0";
  private reconnectAttempts: number = 0;
  private maxReconnectDelayMs: number = 30000;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.connectAndStream();
  }

  private async connectAndStream(): Promise<void> {
    try {
      this.client = new Client({
        connectionString: process.env.DATABASE_URL,
        replication: "database",
      } as any);

      await this.client.connect();
      console.log("[CDC] Connected to PostgreSQL replication stream.");
      this.reconnectAttempts = 0;

      const sql = `START_REPLICATION SLOT ${REPLICATION_SLOT_NAME} LOGICAL 0/0 ("proto_version" '1', "publication_names" '${PUBLICATION_NAME}');`;

      this.client.query(sql, (err: Error | null) => {
        if (err) {
          console.error("[CDC] Replication stream error:", err);
          this.handleDisconnect();
        }
      });

      this.client.on("copyData", (buffer: Buffer) => {
        this.parseWalMessage(buffer);
      });

      this.startStandbyStatusUpdates();
    } catch (err) {
      console.error("[CDC] Failed to start CDC streaming:", err);
      this.handleDisconnect();
    }
  }

  private parseWalMessage(buffer: Buffer): void {
    try {
      const messageType = String.fromCharCode(buffer[0]);

      if (messageType === "w") {
        const dataStart = 25;
        const walData = buffer.subarray(dataStart);
        if (walData.length === 0) return;

        const actionTypeChar = String.fromCharCode(walData[0]);
        let action: "INSERT" | "UPDATE" | "DELETE" | null = null;

        if (actionTypeChar === "I") action = "INSERT";
        else if (actionTypeChar === "U") action = "UPDATE";
        else if (actionTypeChar === "D") action = "DELETE";

        if (action) {
          const tableName = this.extractTableName(walData);

          if (TARGET_TABLES.has(tableName)) {
            const event: CDCEvent = {
              table: tableName,
              action,
              commitLsn: this.currentLsn,
              timestamp: Date.now(),
              newRow: action !== "DELETE" ? { streamedAt: Date.now() } : null,
              oldRow: action === "DELETE" ? { id: "deleted-row" } : null,
            };

            if (redis && typeof (redis as any).publish === "function") {
              (redis as any).publish(REDIS_CHANNEL, JSON.stringify(event));
            }
          }
        }
      }
    } catch (err) {
      console.error("[CDC] Error parsing WAL buffer:", err);
    }
  }

  private extractTableName(buffer: Buffer): string {
    for (const table of TARGET_TABLES) {
      if (buffer.includes(Buffer.from(table))) {
        return table;
      }
    }
    return "Booking";
  }

  private startStandbyStatusUpdates(): void {
    const statusInterval = setInterval(() => {
      if (!this.isRunning || !this.client) {
        clearInterval(statusInterval);
        return;
      }

      this.sendStandbyStatusUpdate();
    }, 10000);
  }

  private sendStandbyStatusUpdate(): void {
    if (!this.client) return;

    const statusBuffer = Buffer.alloc(34);
    statusBuffer.write("r", 0);

    statusBuffer.writeBigInt64BE(BigInt(0), 1);
    statusBuffer.writeBigInt64BE(BigInt(0), 9);
    statusBuffer.writeBigInt64BE(BigInt(0), 17);
    statusBuffer.writeBigInt64BE(BigInt(Date.now() * 1000), 25);

    try {
      this.client.query(statusBuffer);
    } catch (err) {
      console.error("[CDC] Failed to send Standby Status Update:", err);
    }
  }

  private handleDisconnect(): void {
    if (this.client) {
      this.client.end().catch(() => {});
      this.client = null;
    }

    if (!this.isRunning) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelayMs,
    );

    console.warn(
      `[CDC] Reconnecting in ${delay / 1000}s (Attempt ${this.reconnectAttempts})...`,
    );
    setTimeout(() => {
      this.connectAndStream();
    }, delay);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.client) {
      this.client.end().catch(() => {});
      this.client = null;
    }
    console.log("[CDC] Streamer stopped.");
  }
}

export const cdcStreamer = new PostgresCDCStreamer();
