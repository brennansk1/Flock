import fs from "fs";
import path from "path";

const SRC_DIR = process.env.QA_SRC_DIR || "./qa_shots";
const BASE_DEST_DIR = process.env.QA_DEST_DIR || "./QA gallery";

// Generate timestamp string (e.g. 2026-07-02_21-13-24)
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

const RUN_DEST_DIR = path.join(BASE_DEST_DIR, timestamp);

// Ensure run destination exists
fs.mkdirSync(RUN_DEST_DIR, { recursive: true });

// Copy all images
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".png"));
for (const file of files) {
  fs.copyFileSync(path.join(SRC_DIR, file), path.join(RUN_DEST_DIR, file));
}

console.log(`Copied ${files.length} screenshots to ${RUN_DEST_DIR}`);
