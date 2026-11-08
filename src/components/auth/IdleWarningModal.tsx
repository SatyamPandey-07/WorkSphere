"use client";

import React from "react";
import {
  IdleSessionDialog,
  type IdleSessionDialogProps,
} from "./IdleSessionDialog";

export type IdleWarningModalProps = IdleSessionDialogProps;

/**
 * IdleWarningModal
 *
 * Renders an interactive warning modal with a live countdown timer 60 seconds
 * before automatic idle session timeout.
 * Re-exports and aliases IdleSessionDialog for backwards-compatibility and spec conformance.
 */
export function IdleWarningModal(props: IdleWarningModalProps) {
  return <IdleSessionDialog {...props} />;
}

export default IdleWarningModal;
