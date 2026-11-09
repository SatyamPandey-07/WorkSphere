"use client";

import React from "react";
import { VenueDetailDialog, VenueDetailDialogProps } from "../chat/VenueDetailDialog";
import { HourlyCrowdForecast, HourlyCrowdForecastProps } from "./HourlyCrowdForecast";

export interface VenueDetailModalProps extends VenueDetailDialogProps {
  hourlyForecastProps?: Partial<HourlyCrowdForecastProps>;
}

/**
 * VenueDetailModal
 *
 * Wrapper component providing modal compatibility for venue details with
 * integrated HourlyCrowdForecast support.
 */
export function VenueDetailModal(props: VenueDetailModalProps) {
  return <VenueDetailDialog {...props} />;
}

export { HourlyCrowdForecast };
export default VenueDetailModal;
