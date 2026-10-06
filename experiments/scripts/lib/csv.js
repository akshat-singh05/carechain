const fs = require("fs");
const path = require("path");

const RESULTS_DIR = path.join(__dirname, "..", "..", "results");

// RFC 4180: a field containing a comma, quote or newline must be quoted.
function quote(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(filename, header, rows) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((col) => quote(row[col])).join(","));
  }
  const outPath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`Wrote ${rows.length} rows -> ${outPath}`);
  return outPath;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return NaN;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[idx];
}

module.exports = { writeCsv, percentile, RESULTS_DIR };
