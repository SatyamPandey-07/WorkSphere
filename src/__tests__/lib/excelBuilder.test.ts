import {
  ExcelXmlBuilder,
  escapeXml,
  sanitizeExcelFormula,
} from "@/lib/export/excelBuilder";
import {
  generateBookingsExcel,
  exportBookingsToExcel,
  downloadBookingsExcel,
  type BookingHistoryExportItem,
} from "@/lib/export/domain/bookingHistoryExporter";

describe("Excel XML / XLSX Generator Utility (#4598)", () => {
  describe("escapeXml", () => {
    it("escapes XML special characters", () => {
      expect(escapeXml('<item name="test" flag=\'1\' & value="5">')).toBe(
        "&lt;item name=&quot;test&quot; flag=&apos;1&apos; &amp; value=&quot;5&quot;&gt;",
      );
    });

    it("handles null, undefined and numbers", () => {
      expect(escapeXml(null)).toBe("");
      expect(escapeXml(undefined)).toBe("");
      expect(escapeXml("")).toBe("");
      expect(escapeXml(123.45)).toBe("123.45");
      expect(escapeXml(true)).toBe("true");
    });

    it("strips illegal XML 1.0 control characters to prevent parser failures", () => {
      expect(escapeXml("Hello\x00World\x08Test\x1bEnd")).toBe("HelloWorldTestEnd");
      expect(escapeXml("Safe\tTab\nNewline\rReturn")).toBe("Safe\tTab\nNewline\rReturn");
    });
  });

  describe("sanitizeExcelFormula", () => {
    it("prepends single quote to formula triggers (=, +, -, @, \\t, \\r)", () => {
      expect(sanitizeExcelFormula("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(sanitizeExcelFormula("+12345")).toBe("'+12345");
      expect(sanitizeExcelFormula("-500")).toBe("'-500");
      expect(sanitizeExcelFormula("@mention")).toBe("'@mention");
      expect(sanitizeExcelFormula("\tcmd")).toBe("'\tcmd");
      expect(sanitizeExcelFormula("\rcmd")).toBe("'\rcmd");
    });

    it("sanitizes formula triggers with leading whitespace", () => {
      expect(sanitizeExcelFormula("   =1+1")).toBe("'   =1+1");
    });

    it("sanitizes DDE command execution triggers using pipe (|)", () => {
      expect(sanitizeExcelFormula("|'cmd'!' /C calc'")).toBe("'|'cmd'!' /C calc'");
      expect(sanitizeExcelFormula("   |cmd")).toBe("'   |cmd");
    });

    it("leaves safe text unchanged", () => {
      expect(sanitizeExcelFormula("WorkSphere Workspace")).toBe(
        "WorkSphere Workspace",
      );
      expect(sanitizeExcelFormula("Desk #12")).toBe("Desk #12");
    });
  });

  describe("ExcelXmlBuilder", () => {
    interface TestItem {
      id: string;
      title: string;
      amount: number;
      date: string;
    }

    it("generates valid SpreadsheetML 2003 XML structure with namespaces and metadata", () => {
      const builder = new ExcelXmlBuilder<TestItem>({
        worksheetName: "CustomSheet",
        author: "WorkSphere Test",
      });

      builder.setColumns([
        { header: "ID", accessor: "id", type: "String" },
        { header: "Title", accessor: "title", type: "String" },
        { header: "Amount", accessor: "amount", type: "Currency" },
        { header: "Date", accessor: "date", type: "Date" },
      ]);

      builder.addRow({
        id: "REC-01",
        title: "Test Meeting",
        amount: 45.5,
        date: "2026-10-12",
      });

      const xml = builder.build();

      // Root element and namespaces
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
      expect(xml).toContain(
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      );
      expect(xml).toContain('xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"');

      // Metadata
      expect(xml).toContain("<Author>WorkSphere Test</Author>");
      expect(xml).toContain('<Worksheet ss:Name="CustomSheet">');

      // Styles
      expect(xml).toContain('<Style ss:ID="Header">');
      expect(xml).toContain('ss:Bold="1"');
      expect(xml).toContain('<Style ss:ID="Currency">');
      expect(xml).toContain('&quot;$&quot;#,##0.00');
      expect(xml).toContain('<Style ss:ID="Date">');
      expect(xml).toContain('ss:Format="yyyy-mm-dd"');

      // Columns auto-width
      expect(xml).toContain("<Column ss:Width=");

      // Bold Header row
      expect(xml).toContain(
        '<Cell ss:StyleID="Header"><Data ss:Type="String">Title</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Header"><Data ss:Type="String">Amount</Data></Cell>',
      );

      // Data row
      expect(xml).toContain(
        '<Cell ss:StyleID="Text"><Data ss:Type="String">REC-01</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Text"><Data ss:Type="String">Test Meeting</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">45.50</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Date"><Data ss:Type="String">2026-10-12</Data></Cell>',
      );
    });

    it("sanitizes formulas inside cells by default", () => {
      const builder = new ExcelXmlBuilder<{ note: string }>();
      builder.addColumn({ header: "Note", accessor: "note" });
      builder.addRow({ note: "=HYPERLINK(\"http://evil.com\")" });

      const xml = builder.build();
      expect(xml).toContain("&apos;=HYPERLINK");
    });

    it("sanitizes formula injection in Currency and Number column fallback strings", () => {
      const builder = new ExcelXmlBuilder<{ price: string; count: string; date: string }>();
      builder.addColumn({ header: "Price", accessor: "price", type: "Currency" });
      builder.addColumn({ header: "Count", accessor: "count", type: "Number" });
      builder.addColumn({ header: "Date", accessor: "date", type: "Date" });

      builder.addRow({
        price: "=SUM(A1:A10)",
        count: "|'cmd'!' /C calc'",
        date: "=HYPERLINK(\"http://evil.com\")",
      });

      const xml = builder.build();
      expect(xml).toContain("&apos;=SUM(A1:A10)");
      expect(xml).toContain("&apos;|&apos;cmd&apos;!&apos; /C calc&apos;");
      expect(xml).toContain("&apos;=HYPERLINK");
    });

    it("handles toBlob generation with spreadsheet MIME type", () => {
      const builder = new ExcelXmlBuilder<{ id: string }>();
      builder.addColumn({ header: "ID", accessor: "id" });
      builder.addRow({ id: "1" });

      const blob = builder.toBlob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    });

    it("triggers browser download with proper .xlsx file extension", () => {
      const builder = new ExcelXmlBuilder<{ id: string }>();
      builder.addColumn({ header: "ID", accessor: "id" });
      builder.addRow({ id: "1" });

      const createObjectUrlMock = jest.fn(() => "blob:mock-url");
      const revokeObjectUrlMock = jest.fn();
      global.URL.createObjectURL = createObjectUrlMock;
      global.URL.revokeObjectURL = revokeObjectUrlMock;

      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const blob = builder.download("my-export");
      expect(blob).toBeInstanceOf(Blob);
      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();

      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe("generateBookingsExcel & exportBookingsToExcel", () => {
    const mockBookings: BookingHistoryExportItem[] = [
      {
        id: "bk-101",
        confirmationId: "WS-CONF-101",
        date: "2026-10-15",
        time: "10:00 - 12:00",
        duration: 120,
        seatNumber: "Desk 4A",
        status: "CONFIRMED",
        createdAt: "2026-10-01T08:00:00.000Z",
        projectBillingCode: "PROJ-DEV",
        venue: {
          name: "WeWork Financial District",
          category: "Private Office",
          address: "100 Pine St, San Francisco, CA",
        },
      },
      {
        id: "bk-102",
        confirmationId: null,
        date: "2026-10-18",
        time: "14:00 - 15:00",
        duration: 60,
        seatNumber: null,
        status: "PENDING",
        createdAt: null,
        projectBillingCode: null,
        venue: null,
      },
    ];

    it("formats all booking history headers and clean currency/date columns", () => {
      const xml = generateBookingsExcel(mockBookings, {
        venueName: "Default Venue",
        sheetName: "Booking History",
      });

      // Worksheet Name
      expect(xml).toContain('<Worksheet ss:Name="Booking History">');

      // Bold Headers
      expect(xml).toContain(">Confirmation ID</Data></Cell>");
      expect(xml).toContain(">Venue Name</Data></Cell>");
      expect(xml).toContain(">Category</Data></Cell>");
      expect(xml).toContain(">Address</Data></Cell>");
      expect(xml).toContain(">Date</Data></Cell>");
      expect(xml).toContain(">Time</Data></Cell>");
      expect(xml).toContain(">Seat Number</Data></Cell>");
      expect(xml).toContain(">Duration (mins)</Data></Cell>");
      expect(xml).toContain(">Status</Data></Cell>");
      expect(xml).toContain(">Estimated Price ($)</Data></Cell>");
      expect(xml).toContain(">Tax ($)</Data></Cell>");
      expect(xml).toContain(">Total ($)</Data></Cell>");
      expect(xml).toContain(">Billing Code</Data></Cell>");
      expect(xml).toContain(">Booked At</Data></Cell>");

      // Booking 1 values
      expect(xml).toContain(">WS-CONF-101</Data></Cell>");
      expect(xml).toContain(">WeWork Financial District</Data></Cell>");
      expect(xml).toContain(">Private Office</Data></Cell>");
      expect(xml).toContain(">100 Pine St, San Francisco, CA</Data></Cell>");
      expect(xml).toContain(
        '<Cell ss:StyleID="Date"><Data ss:Type="String">2026-10-15</Data></Cell>',
      );
      expect(xml).toContain(">10:00 - 12:00</Data></Cell>");
      expect(xml).toContain(">Desk 4A</Data></Cell>");
      expect(xml).toContain(">120</Data></Cell>");
      expect(xml).toContain(">Confirmed</Data></Cell>");

      // Monetary calculations for 120 mins (2 hrs @ $15/hr = $30.00, tax 8% = $2.40, total = $32.40)
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">30.00</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">2.40</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">32.40</Data></Cell>',
      );
      expect(xml).toContain(">PROJ-DEV</Data></Cell>");

      // Booking 2 values (fallback confirmation ID, default venue, general seat, pending status)
      expect(xml).toContain(">WS-#bk-102</Data></Cell>");
      expect(xml).toContain(">Default Venue</Data></Cell>");
      expect(xml).toContain(">General</Data></Cell>");
      expect(xml).toContain(">Pending</Data></Cell>");

      // Monetary calculations for 60 mins (1 hr @ $15/hr = $15.00, tax 8% = $1.20, total = $16.20)
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">15.00</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">1.20</Data></Cell>',
      );
      expect(xml).toContain(
        '<Cell ss:StyleID="Currency"><Data ss:Type="Number">16.20</Data></Cell>',
      );

      // Alias exportBookingsToExcel is identical
      expect(exportBookingsToExcel(mockBookings)).toBe(
        generateBookingsExcel(mockBookings),
      );
    });

    it("handles empty bookings list without crashing", () => {
      const xml = generateBookingsExcel([]);
      expect(xml).toContain('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
      expect(xml).toContain(">Confirmation ID</Data></Cell>");
      expect(xml).toContain("</Table>");
    });

    it("safely clamps duration 0 and negative durations to 0 hours ($0.00)", () => {
      const zeroBooking: BookingHistoryExportItem = {
        id: "bk-zero",
        date: "2026-10-25",
        time: "10:00",
        duration: 0,
      };
      const negBooking: BookingHistoryExportItem = {
        id: "bk-neg",
        date: "2026-10-25",
        time: "11:00",
        duration: -60,
      };

      const xml = generateBookingsExcel([zeroBooking, negBooking]);
      expect(xml).toContain('<Cell ss:StyleID="Currency"><Data ss:Type="Number">0.00</Data></Cell>');
      expect(xml).toContain('<Cell ss:StyleID="Integer"><Data ss:Type="Number">0</Data></Cell>');
    });

    it("triggers downloadBookingsExcel with formatted workbook blob", () => {
      const createObjectUrlMock = jest.fn(() => "blob:mock-url");
      const revokeObjectUrlMock = jest.fn();
      global.URL.createObjectURL = createObjectUrlMock;
      global.URL.revokeObjectURL = revokeObjectUrlMock;

      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const blob = downloadBookingsExcel(mockBookings, {
        venueName: "Silicon Hub",
      });

      expect(blob).toBeInstanceOf(Blob);
      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();

      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
