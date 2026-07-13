/**
 * Builds Windows exes:
 *   dist/vvapp-frontend-win.exe  (port 8001)
 *   dist/vvapp-backend-win.exe   (port 8002)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function run(cmd, cwd = root) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

console.log("1) Building Next.js static export...");
run("npm run build");

const outDir = path.join(root, "out");
const siteDir = path.join(root, "frontend", "site");
if (!fs.existsSync(outDir)) {
  throw new Error("out/ missing — next build failed?");
}

console.log("2) Copying out/ → frontend/site/...");
copyDir(outDir, siteDir);

console.log("3) Building frontend Windows exe...");
run("npm install", path.join(root, "frontend"));
run("npm run build:exe", path.join(root, "frontend"));

console.log("4) Building backend Windows exe...");
run("npm install", path.join(root, "signaling"));
run("npm run build:exe", path.join(root, "signaling"));

console.log("\nDone. Windows binaries:");
console.log("  dist/vvapp-frontend-win.exe  → port 8001");
console.log("  dist/vvapp-backend-win.exe   → port 8002");
console.log("\nOn the VPS, run both, open firewall 8001 & 8002,");
console.log("then visit http://YOUR_IP:8001");
