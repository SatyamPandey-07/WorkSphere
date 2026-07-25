/**
 * Minimal event shape needed to decide whether a modal backdrop was clicked.
 * Keeping this independent from React makes the interaction easy to test.
 */
export interface ModalBackdropEvent {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}

/**
 * Returns true only when the backdrop element itself was clicked.
 *
 * Events from modal content bubble to the backdrop, but in that case
 * `event.target` points to the inner element while `event.currentTarget`
 * remains the backdrop. Comparing both values prevents clicks inside the
 * dialog from accidentally closing it.
 */
export function isModalBackdropClick(event: ModalBackdropEvent): boolean {
  return event.target === event.currentTarget;
}

/**
 * Runs the modal close callback only for a direct backdrop click.
 *
 * @returns `true` when the callback was called, otherwise `false`.
 */
export function handleModalBackdropClick(
  event: ModalBackdropEvent,
  onClose: () => void,
): boolean {
  if (!isModalBackdropClick(event)) {
    return false;
  }

  onClose();
  return true;
}

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
