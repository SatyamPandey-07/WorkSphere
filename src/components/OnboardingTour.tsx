"use client";

import { useEffect, useState } from "react";
import { Joyride, CallBackProps, STATUS, Step } from "react-joyride";

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
      disableBeacon: true,
      title: "Interactive Map",
    },
    {
      target: ".joyride-chat",
      content:
        "Talk to our AI assistant to find the perfect workspace for you. Ask for 'a quiet cafe with good WiFi'.",
      title: "AI Chat Assistant",
    },
    {
      target: ".joyride-booking",
      content:
        "Once you find a spot you like, you can book it or reserve your seat directly from the chat or venue details.",
      title: "Book Your Spot",
    },
  ];

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRun(false);
      localStorage.setItem("worksphere-onboarding-completed", "true");
    }
  };

  return (
    <Joyride
      callback={handleJoyrideCallback}
      continuous
      hideCloseButton
      run={run}
      scrollToFirstStep
      showProgress
      showSkipButton
      steps={steps}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: "#2563eb", // blue-600
        },
      }}
    />
  );
}
