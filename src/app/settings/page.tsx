"use client";

import React, { useState, useEffect } from "react";
import { UserPreferenceToggle } from "@/components/UserPreferenceToggle";

export default function SettingsPage() {
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("ai_personalization_enabled");
    if (stored !== null) {
      setPersonalizationEnabled(stored === "true");
    }
  }, []);

  const handleToggle = (enabled: boolean) => {
    setPersonalizationEnabled(enabled);
    localStorage.setItem("ai_personalization_enabled", String(enabled));
  };

  return (
    <div className="container max-w-4xl py-8 px-4 sm:px-6 lg:px-8 mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-4">AI Preferences</h2>
          <UserPreferenceToggle
            enabled={personalizationEnabled}
            onToggle={handleToggle}
          />
        </div>
      </div>
    </div>
  );
}
