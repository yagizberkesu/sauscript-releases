// Yardımcı programı tek dosyalık bir .exe'ye paketler (Node SEA).
// Kullanıcı hiçbir şey kurmadan indirip çift tıklayabilsin diye:
// Node.js, npm, git ve Playwright gerekmez.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "build");
const bundlePath = join(outDir, "helper.cjs");
const blobPath = join(outDir, "helper.blob");
const configPath = join(outDir, "sea-config.json");
const exeName = "SAUScript-Yardimci.exe";
const exePath = join(outDir, exeName);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log("[1/5] Kod tek dosyada toplanıyor...");
await build({
  entryPoints: [join(root, "scripts", "fetch-notlar-handler.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  legalComments: "none",
  minify: true
});

console.log("[2/5] SEA blob hazırlanıyor...");
writeFileSync(configPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true
}, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });

console.log("[3/5] Node çalıştırıcısı kopyalanıyor...");
copyFileSync(process.execPath, exePath);
// İmza enjeksiyondan sonra geçersiz kalır; kaldırılmazsa Windows exe'yi reddedebilir.
try {
  execFileSync("signtool", ["remove", "/s", exePath], { stdio: "ignore" });
} catch {
  // signtool yoksa sorun değil, imzasız node.exe de olabilir
}

console.log("[4/5] Blob exe'ye gömülüyor...");
execFileSync("npx", [
  "--yes", "postject", `"${exePath}"`, "NODE_SEA_BLOB", `"${blobPath}"`,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
], { stdio: "inherit", shell: process.platform === "win32" });

console.log("[5/5] Konsol penceresi kapatiliyor (PE alt sistemi -> GUI)...");
hideConsoleWindow(exePath);

const sizeMb = (statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`\nHazır: build/${exeName} (${sizeMb} MB)`);

/**
 * node.exe bir konsol uygulamasıdır: çalıştırıldığında Windows ona siyah bir
 * pencere açar. PE başlığındaki Subsystem alanını GUI'ye çevirerek bunu
 * engelliyoruz — kullanıcı protokolden tetiklediğinde hiçbir pencere görmüyor.
 */
function hideConsoleWindow(file) {
  const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
  const buffer = readFileSync(file);

  if (buffer.readUInt16LE(0) !== 0x5a4d) throw new Error("Gecerli bir PE dosyasi degil (MZ yok)");
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) throw new Error("PE imzasi bulunamadi");

  // PE imzasi (4) + COFF basligi (20) + Optional Header icinde Subsystem 68. baytta.
  const subsystemOffset = peOffset + 4 + 20 + 68;
  const current = buffer.readUInt16LE(subsystemOffset);
  if (current === IMAGE_SUBSYSTEM_WINDOWS_GUI) return;
  if (current !== 3) throw new Error(`Beklenmeyen alt sistem degeri: ${current}`);

  buffer.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, subsystemOffset);
  writeFileSync(file, buffer);
}
