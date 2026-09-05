import { describe, expect, it } from "vitest";
import { createCsvExport, createDocxExport, createPdfExport, createXlsxExport } from "./ArtifactOfficeExport.js";

describe("ArtifactOfficeExport", () => {
  it("creates UTF-8 CSV with Excel-friendly BOM", async () => {
    const result = createCsvExport("売上表", "商品,数量\nA,10");
    expect(result.fileName).toBe("origin-artifact.csv");
    expect(result.type).toContain("text/csv");
    expect(await result.blob.text()).toContain("商品");
  });

  it("creates a DOCX package without external dependencies", async () => {
    const result = createDocxExport("report", "見出し\n本文");
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(result.fileName).toBe("report.docx");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("creates an XLSX package with a worksheet", async () => {
    const result = createXlsxExport("table", "商品,数量\nA,10");
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(result.fileName).toBe("table.xlsx");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("creates a PDF with the PDF magic header", async () => {
    const result = createPdfExport("report", "Hello ORIGIN");
    expect(result.fileName).toBe("report.pdf");
    expect(await result.blob.text()).toMatch(/^%PDF-1\.4/);
  });
});
