const fs = require("fs");
const path = require("path");

const serverPath = path.join(process.cwd(), "server.ts");
const replacementPath = path.join(process.cwd(), "replacement.txt");

const content = fs.readFileSync(serverPath, "utf-8");
const replacement = fs.readFileSync(replacementPath, "utf-8");

const startAnchor = "// --- Parallel API Callers ---";
const endAnchor = "let lastError: any = null;";

const startIndex = content.indexOf(startAnchor);
const endIndex = content.indexOf(endAnchor);

if (startIndex === -1 || endIndex === -1) {
  console.error(`Could not find anchors! startIndex: ${startIndex}, endIndex: ${endIndex}`);
  process.exit(1);
}

const newContent = content.substring(0, startIndex) + replacement + "\n    " + content.substring(endIndex);
fs.writeFileSync(serverPath, newContent, "utf-8");
console.log("Successfully fixed server.ts using plain JS and text replacement!");
