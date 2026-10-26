/**
 * Tax Export re-export bridge.
 *
 * Canonical implementation lives in @/lib/export/domain/taxExporter.
 */

export {
  type ExportableBooking,
  type TaxExportBooking,
  type DateRange,
  type TaxTotals,
  resolveDateRange,
  filterBookingsByRange,
  computeTaxTotals,
  bookingsToCSV,
  taxBookingsToCSV,
  exportBookingsToJson,
  generateTaxExportPdf,
} from "./export/domain/taxExporter";
