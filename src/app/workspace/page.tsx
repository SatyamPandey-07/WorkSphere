import React, { Suspense } from "react";
import { ARDeskNavigator } from "./ARDeskNavigator";

export default function WorkspaceARPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center bg-white min-h-screen">
          Loading AR Experience...
        </div>
      }
    >
      <ARDeskNavigator />
    </Suspense>
  );
}
