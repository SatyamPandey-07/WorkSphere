export function calculatePartitionDates(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year, month, lastDay + 1));

  return {
    start: startDate,
    end: endDate,
  };
}

export function escapeCsv(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
