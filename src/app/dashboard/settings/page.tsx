import { getSlackSettings } from "./actions";
import { SlackIntegrationForm } from "@/components/settings/SlackIntegrationForm";

export const metadata = {
  title: "Settings | WorkSphere",
};

export default async function SettingsPage() {
  const settings = await getSlackSettings();

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8 space-y-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
          Settings
        </h1>
        <p className="mt-2 text-zinc-400">
          Manage your profile and integrations.
        </p>
      </div>

      <SlackIntegrationForm
        initialWebhookUrl={settings?.slackWebhookUrl ?? ""}
        initialEnabled={settings?.slackNotifyEnabled ?? true}
      />
    </div>
  );
}