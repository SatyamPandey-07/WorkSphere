import type { NotificationChannel, NotificationMessage, DeliveryResult } from "./types";
import { webhookNotificationChannel } from "./channels/webhookChannel";
import { discordNotificationChannel } from "./channels/discordChannel";
import { telegramNotificationChannel } from "./channels/telegramChannel";
import { whatsAppNotificationChannel } from "./channels/whatsAppChannel";
import { webPushNotificationChannel } from "./channels/webPushChannel";

export class NotificationDispatcher {
  private channels = new Map<string, NotificationChannel>();

  constructor() {
    this.register(webhookNotificationChannel);
    this.register(discordNotificationChannel);
    this.register(telegramNotificationChannel);
    this.register(whatsAppNotificationChannel);
    this.register(webPushNotificationChannel);
  }

  public register(channel: NotificationChannel): this {
    this.channels.set(channel.name.toLowerCase(), channel);
    return this;
  }

  public getChannel(name: string): NotificationChannel | undefined {
    return this.channels.get(name.toLowerCase());
  }

  public async dispatch(
    channelName: string,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    const channel = this.getChannel(channelName);
    if (!channel) {
      return {
        channel: channelName,
        status: "FAILED",
        error: `Channel '${channelName}' is not registered`,
      };
    }
    try {
      return await channel.send(message);
    } catch (err) {
      return {
        channel: channel.name,
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async broadcast(
    message: NotificationMessage,
    channelNames?: string[],
  ): Promise<DeliveryResult[]> {
    const names = channelNames ?? Array.from(this.channels.keys());
    const settled = await Promise.allSettled(
      names.map((name) => this.dispatch(name, message)),
    );
    return settled.map((entry, index) =>
      entry.status === "fulfilled"
        ? entry.value
        : {
            channel: names[index],
            status: "FAILED" as const,
            error: String((entry as PromiseRejectedResult).reason),
          },
    );
  }
}

export const notificationDispatcher = new NotificationDispatcher();
