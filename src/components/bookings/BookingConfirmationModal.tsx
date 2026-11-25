"use client";

import { BookingModal, type BookingModalProps } from "./BookingModal";

export type BookingConfirmationModalProps = BookingModalProps;

export function BookingConfirmationModal(props: BookingConfirmationModalProps) {
  return <BookingModal {...props} />;
}

export default BookingConfirmationModal;
