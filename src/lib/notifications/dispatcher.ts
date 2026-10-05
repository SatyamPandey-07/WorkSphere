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
    return channel.send(message);
  }

  public async broadcast(
    message: NotificationMessage,
    channelNames?: string[],
  ): Promise<DeliveryResult[]> {
    const targets = channelNames
      ? channelNames.map((c) => this.getChannel(c)).filter((c): c is NotificationChannel => !!c)
      : Array.from(this.channels.values());

    return Promise.all(targets.map((channel) => channel.send(message)));
  }
}

export const notificationDispatcher = new NotificationDispatcher();
