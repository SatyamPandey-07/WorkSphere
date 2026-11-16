/**
 * FilterDrawer.tsx
 *
 * Venue filter drawer component alias per issue #8021.
 * Provides backdrop click and pointer-down propagation containment to prevent
 * accidental clicks on underlying venue cards or interactive map pins.
 */

export {
  VenueSearchDrawer,
  VenueSearchDrawer as FilterDrawer,
  type VenueSearchDrawerProps,
  type VenueSearchDrawerProps as FilterDrawerProps,
} from "../venues/VenueSearchDrawer";

export { default } from "../venues/VenueSearchDrawer";
