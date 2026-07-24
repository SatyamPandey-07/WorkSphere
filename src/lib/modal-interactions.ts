/**
 * Returns true only when a pointer interaction both starts and ends on the
 * modal backdrop. This prevents controls such as native date pickers from
 * being mistaken for intentional outside clicks when their browser popover
 * retargets the final click event.
 */
export function shouldCloseFromBackdrop(
  pointerDownStartedOnBackdrop: boolean,
  clickEndedOnBackdrop: boolean,
): boolean {
  return pointerDownStartedOnBackdrop && clickEndedOnBackdrop;
}
