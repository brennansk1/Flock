import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const htmlPath = resolve("reports/qa_report.html");
const pdfPath = resolve("QA gallery/qa_report.pdf");

console.log("Generating PDF from:", htmlPath);
console.log("Target PDF:", pdfPath);

try {
  execFileSync(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--virtual-time-budget=10000",
    "--run-all-compositor-stages-before-draw",
    "--print-to-pdf=" + pdfPath,
    htmlPath,
  ], { timeout: 45000, stdio: "inherit" });
} catch (err) {
  console.warn("Chrome finished with code/signal:", err.message);
}

if (existsSync(pdfPath)) {
  const stats = statSync(pdfPath);
  console.log("SUCCESS! PDF generated cleanly at:", pdfPath);
  console.log("Size:", stats.size, "bytes");
} else {
  console.error("FAILED to generate PDF!");
  process.exit(1);
}
