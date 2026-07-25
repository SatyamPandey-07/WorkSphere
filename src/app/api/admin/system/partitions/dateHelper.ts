export function calculatePartitionDates(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year, month, lastDay + 1));

  return {
    start: startDate,
    end: endDate,
  };
}
