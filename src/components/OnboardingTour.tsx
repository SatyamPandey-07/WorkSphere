"use client";

import { useEffect, useState } from "react";
import { Joyride, STATUS, EVENTS } from "react-joyride";
import type { Step, EventData } from "react-joyride";

export function OnboardingTour() {
  const [run, setRun] = useState(false);

  useEffect(() => {
    // Only run on the client side
    const hasCompleted = localStorage.getItem(
      "worksphere-onboarding-completed",
    );
    if (!hasCompleted) {
      // Delay slightly to ensure UI elements are rendered
      const timer = setTimeout(() => {
        setRun(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const steps: Step[] = [
    {
      target: ".joyride-map",
      content:
        "Explore venues on the interactive map. You can see real-time availability and click on markers to view details.",
      title: "Interactive Map",
      placement: "center",
      skipBeacon: true,
    },
    {
      target: ".joyride-chat",
      content:
        "Talk to our AI assistant to find the perfect workspace for you. Ask for 'a quiet cafe with good WiFi'.",
      title: "AI Chat Assistant",
      placement: "center",
      skipBeacon: true,
    },
    {
      target: ".joyride-booking",
      content:
        "Once you find a spot you like, you can book it or reserve your seat directly from the chat or venue details.",
      title: "Book Your Spot",
      placement: "center",
      skipBeacon: true,
    },
  ];

  const handleEvent = (data: EventData) => {
    const { status, type } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (type === EVENTS.TOUR_END && finishedStatuses.includes(status)) {
      setRun(false);
      localStorage.setItem("worksphere-onboarding-completed", "true");
    }
  };

  return (
    <Joyride
      onEvent={handleEvent}
      continuous
      run={run}
      scrollToFirstStep
      steps={steps}
      locale={{
        skip: "Skip Tour",
      }}
      options={{
        showProgress: true,
        buttons: ["back", "skip", "primary"],
        primaryColor: "#2563eb",
        zIndex: 10000,
        skipBeacon: true,
      }}
      styles={{
        options: {
          arrowColor: "#fff",
          backgroundColor: "#fff",
          overlayColor: "rgba(0, 0, 0, 0.4)",
          primaryColor: "#2563eb",
          textColor: "#1f2937",
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        },
        buttonClose: {
          display: "none",
        },
        buttonNext: {
          backgroundColor: "#2563eb",
          borderRadius: "0.75rem",
          fontFamily: "system-ui, sans-serif",
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: "11px",
          letterSpacing: "0.05em",
        },
        buttonBack: {
          color: "#4b5563",
          fontFamily: "system-ui, sans-serif",
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: "11px",
          letterSpacing: "0.05em",
          marginRight: "0.5rem",
        },
        buttonSkip: {
          color: "#9ca3af",
          fontFamily: "system-ui, sans-serif",
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: "11px",
          letterSpacing: "0.05em",
        },
      }}
    />
  );
}
