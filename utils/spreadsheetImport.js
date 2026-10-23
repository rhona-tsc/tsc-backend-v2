import ExcelJS from "exceljs";

export function spreadsheetSerialDate(value) {
  if (!Number.isFinite(value) || value < 0 || value > 2958465) return undefined;
  // Excel's 1900 date system includes a fictitious leap day at serial 60.
  const epoch = Date.UTC(1899, 11, value < 60 ? 31 : 30);
  return new Date(epoch + Math.floor(value) * 86400000);
}

const cellValue = value => {
  if (value == null) return "";
  if (value instanceof Date || typeof value !== "object") return value;
  if (Object.hasOwn(value, "result")) return cellValue(value.result);
  if (value.richText) return value.richText.map(part => part.text).join("");
  if (Object.hasOwn(value, "text")) return value.text;
  return "";
};

// Use the workbook library already used for our exports, rather than the
// unmaintained npm xlsx parser. Imports do not evaluate spreadsheet formulas.
export async function readSpreadsheetRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The spreadsheet has no worksheets.");
  if (sheet.rowCount > 50000 || sheet.columnCount > 500) {
    throw new Error("Please split this spreadsheet into smaller imports (maximum 50,000 rows and 500 columns).");
  }
  const rows = [];
  for (let i = 1; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    rows.push(Array.from({ length: sheet.columnCount }, (_, index) => cellValue(row.getCell(index + 1).value)));
  }
  return rows;
}
