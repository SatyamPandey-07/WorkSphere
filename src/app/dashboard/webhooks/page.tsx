import { getWebhookEndpoints, getDiscordWebhookUrl, getTelegramWebhookUrl } from './actions';
import { WebhookForm } from '@/components/webhooks/WebhookForm';
import { WebhookList } from '@/components/webhooks/WebhookList';
import { DeliveryLogs } from '@/components/webhooks/DeliveryLogs';
import { DiscordSettings } from './DiscordSettings';
import { TelegramSettings } from './TelegramSettings';
import { Suspense } from 'react';

export const metadata = {
  title: 'Webhooks | WorkSphere',
};

export default async function WebhooksPage() {
  const endpoints = await getWebhookEndpoints();
  const discordUrl = await getDiscordWebhookUrl();
  const telegramUrl = await getTelegramWebhookUrl();

  return (
    <div className="max-w-5xl mx-auto py-12 px-4 sm:px-6 lg:px-8 space-y-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Webhooks</h1>
        <p className="mt-2 text-zinc-400">
          Configure external endpoints to receive real-time events from your workspace.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <WebhookForm />
          <DiscordSettings initialUrl={discordUrl} />
          <TelegramSettings initialUrl={telegramUrl} />
        </div>
        
        <div className="lg:col-span-2 space-y-8">
          <Suspense fallback={<div className="h-32 bg-zinc-900/50 rounded-lg animate-pulse" />}>
            <WebhookList endpoints={endpoints} />
          </Suspense>

          <hr className="border-zinc-800" />
          
          <Suspense fallback={<div className="h-64 bg-zinc-900/50 rounded-lg animate-pulse" />}>
            <DeliveryLogs endpoints={endpoints} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}