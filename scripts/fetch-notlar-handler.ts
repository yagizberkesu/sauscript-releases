import { createServer } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync, spawn, ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { isSea } from "node:sea";
import { join } from "node:path";
import { parsePastedTranscript, parseSelectedCourses, transcriptLooksValid } from "../src/parser";
import { SAU_GRADE_POINTS } from "../src/types";

const OBS_ORIGIN = "https://obs.sabis.sakarya.edu.tr";
const TRANSCRIPT_URL = `${OBS_ORIGIN}/Transkript`;
const SELECTED_COURSES_URL = `${OBS_ORIGIN}/Ders`;
const PORT = 53412;
const HELPER_VERSION = 4;
const HOME_DIR = join(homedir(), ".sauscript");
const PROFILE_DIR = join(HOME_DIR, "browser-profile");
const LOGIN_TIMEOUT = 15 * 60 * 1000;
const PICKUP_TIMEOUT = 5 * 60 * 1000;
const SECONDARY_TIMEOUT = 45 * 1000;

type Phase = "starting" | "login" | "reading" | "ready" | "error";

const status: { phase: Phase; message: string; mode: string } = {
  phase: "starting",
  message: "Yardımcı program başlatılıyor…",
  mode: ""
};
let payload: string | null = null;

/**
 * GUI alt sistemiyle derlendiği için görünür bir konsol yok; ne olup bittiği
 * ~/.sauscript/helper.log dosyasına yazılır.
 */
function log(line: string) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  console.log(line);
  try {
    mkdirSync(HOME_DIR, { recursive: true });
    appendFileSync(join(HOME_DIR, "helper.log"), stamped, "utf-8");
  } catch {
    // log yazılamıyorsa akışı bozma
  }
}

function setPhase(phase: Phase, message: string) {
  status.phase = phase;
  status.message = message;
  log(`[${phase}] ${message}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Veri yalnızca SAÜScript'in kendi sitesine verilir: "*.github.io" herkesin açabildiği
// bir alan adı olduğu için oradaki başka bir sayfa da transkripti okuyabilirdi.
const SITE_ORIGIN = "https://yagizberkesu.github.io";

function isAllowedOrigin(origin: string) {
  if (origin === SITE_ORIGIN) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

/** DNS rebinding'e karşı: istek gerçekten 127.0.0.1/localhost adına gelmiş olmalı. */
function isLocalHost(host: string | undefined) {
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}

/** Sunucuyu hemen aç: site "yardımcı program kurulu mu?" sorusunu ilk saniyede yanıtlayabilsin. */
function startServer() {
  return new Promise<() => void>((resolve, reject) => {
    let closed = false;

    const server = createServer((req, res) => {
      const origin = req.headers.origin ?? "";
      if (!isLocalHost(req.headers.host) || (origin && !isAllowedOrigin(origin))) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin || "null");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Cache-Control", "no-store");
      // Chrome'un Private Network Access kontrolü: https sayfadan 127.0.0.1'e istek bu başlık olmadan engellenir.
      if (req.headers["access-control-request-private-network"]) {
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = (req.url ?? "").split("?")[0];
      if (url === "/status" || url === "/ping") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...status, version: HELPER_VERSION, hasData: payload !== null }));
        return;
      }
      if (url === "/data") {
        if (!payload) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...status, version: HELPER_VERSION }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
        // Site veriyi aldı; olası tekrar denemeye yer bırakıp kapan.
        setTimeout(close, 3000);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const close = () => {
      if (closed) return;
      closed = true;
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    };

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${PORT} kullanımda — yardımcı programın başka bir penceresi zaten açık olabilir.`));
      } else {
        reject(error);
      }
    });

    server.listen(PORT, "127.0.0.1", () => {
      log(`Yerel sunucu hazır: http://127.0.0.1:${PORT}`);
      resolve(close);
    });
  });
}

// --- Tarayıcı bulma -------------------------------------------------------

/** Chrome DevTools Protocol ile sürülebilen tarayıcı çalıştırılabilirleri. */
const CHROMIUM_EXE = /\\(chrome|msedge|brave|vivaldi|opera|opera_gx|launcher|yandex|browser|whale|chromium|thorium|arc)\.exe$/i;

/** Windows'ta https bağlantılarını açan varsayılan tarayıcı. */
function defaultBrowserPath(): string | null {
  if (process.platform !== "win32") return null;
  const read = (args: string[]) => {
    try {
      return execFileSync("reg", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };

  const progId = read([
    "query",
    "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
    "/v", "ProgId"
  ]).match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1];
  if (!progId) return null;

  const command = read(["query", `HKCR\\${progId}\\shell\\open\\command`, "/ve"]).match(/REG_SZ\s+(.+)/)?.[1]?.trim();
  if (!command) return null;

  // Örn: "C:\Program Files\Opera\opera.exe" -noautoupdate -- "%1"
  const exe = command.startsWith("\"") ? command.slice(1, command.indexOf("\"", 1)) : command.split(" ")[0];
  return CHROMIUM_EXE.test(exe) && existsSync(exe) ? exe : null;
}

/** Kullanılabilecek tarayıcılar, tercih sırasıyla: önce kullanıcının varsayılanı. */
function installedChromiumPaths() {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const candidates = [
    [programFiles, "Google\\Chrome\\Application\\chrome.exe"],
    [programFilesX86, "Google\\Chrome\\Application\\chrome.exe"],
    [localAppData, "Google\\Chrome\\Application\\chrome.exe"],
    [programFilesX86, "Microsoft\\Edge\\Application\\msedge.exe"],
    [programFiles, "Microsoft\\Edge\\Application\\msedge.exe"],
    [programFiles, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
    [localAppData, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
    [localAppData, "Vivaldi\\Application\\vivaldi.exe"],
    [programFiles, "Vivaldi\\Application\\vivaldi.exe"],
    [programFiles, "Opera\\opera.exe"],
    [localAppData, "Programs\\Opera\\opera.exe"],
    [localAppData, "Programs\\Opera GX\\opera.exe"],
    [localAppData, "Yandex\\YandexBrowser\\Application\\browser.exe"],
    [localAppData, "Naver\\Naver Whale\\Application\\whale.exe"],
    [programFiles, "Chromium\\Application\\chrome.exe"]
  ].map(([base, rest]) => join(base, rest));

  const ordered = [defaultBrowserPath(), ...candidates].filter((path): path is string => Boolean(path));
  return [...new Set(ordered)].filter((path) => existsSync(path));
}

// --- Chrome DevTools Protocol --------------------------------------------

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/**
 * Tek bir sekmeye bağlı CDP oturumu. Playwright yerine bunu kullanıyoruz:
 * tek dosyalık .exe'ye paketlenebilmesi için harici bağımlılık kalmamalı.
 */
class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket, readonly targetId: string) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String((event as MessageEvent).data));
      const waiter = message.id ? this.pending.get(message.id) : undefined;
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "CDP hatası"));
      else waiter.resolve(message.result);
    });
    const fail = () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("Tarayıcı bağlantısı kapandı."));
      this.pending.clear();
    };
    socket.addEventListener("close", fail);
    socket.addEventListener("error", fail);
  }

  static open(target: CdpTarget) {
    return new Promise<CdpSession>((resolve, reject) => {
      if (!target.webSocketDebuggerUrl) {
        reject(new Error("Sekmeye bağlanılamadı."));
        return;
      }
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      socket.addEventListener("open", () => resolve(new CdpSession(socket, target.id)), { once: true });
      socket.addEventListener("error", () => reject(new Error("Sekmeye bağlanılamadı.")), { once: true });
    });
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} zaman aşımına uğradı.`));
      }, 30000).unref();
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // zaten kapalı
    }
  }
}

/** Sayfanın ve aynı kökenli çerçevelerinin görünen metni. */
const SCRAPE_SNIPPET = `(() => {
  const parts = [document.body ? document.body.innerText : ""];
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const body = frame.contentDocument && frame.contentDocument.body;
      if (body) parts.push(body.innerText);
    } catch (error) { /* farklı köken */ }
  }
  return parts.filter(Boolean).join("\\n");
})()`;

async function listPages(debugPort: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { cache: "no-store" });
  const targets = (await response.json()) as CdpTarget[];
  return targets.filter((target) => target.type === "page");
}

function launchBrowser(exe: string, url: string) {
  // Eski oturumdan kalan port dosyası yeni portla karışmasın.
  rmSync(join(PROFILE_DIR, "DevToolsActivePort"), { force: true });
  return spawn(exe, [
    `--user-data-dir=${PROFILE_DIR}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    url
  ], { stdio: "ignore" });
}

/** Tarayıcı hata ayıklama portunu profil klasörüne yazana kadar bekle. */
/** Tarayıcı penceresini CDP ile kapatır (süreç bize ait olmasa da çalışır). */
async function closeBrowser(debugPort: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    const info = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (!info.webSocketDebuggerUrl) return;
    const session = await CdpSession.open({
      id: "browser", type: "browser", url: "", webSocketDebuggerUrl: info.webSocketDebuggerUrl
    });
    await session.send("Browser.close").catch(() => {});
    session.close();
  } catch {
    // tarayıcı zaten kapanmış olabilir
  }
}

/**
 * Önceki oturumdan kalan eski sekmeleri kapatır. Kalıcı profil yüzünden tarayıcı
 * tekrar açıldığında eski SABİS sayfaları (giriş ekranı, transkript vb.) veya
 * boş sekmeler durduğu gibi kalıyor — kullanıcı için kafa karıştırıcı.
 * Yalnızca keepUrl ile eşleşen (veya en son açılan) sekmeyi tutar.
 */
async function closeStalePages(debugPort: number, keepUrl: string) {
  try {
    const pages = await listPages(debugPort);
    if (pages.length <= 1) return;

    // Hedef URL ile başlayan sekmeyi veya (yoksa) listedeki son sekmeyi koru.
    const keeper = pages.find((p) => p.url.startsWith(keepUrl)) ?? pages[pages.length - 1];
    const stale = pages.filter((p) => p.id !== keeper.id);
    if (!stale.length) return;

    // Target.closeTarget browser seviyesinde bir komut; /json/version üzerinden bağlanıyoruz.
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    const info = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (!info.webSocketDebuggerUrl) return;

    const session = await CdpSession.open({
      id: "browser", type: "browser", url: "", webSocketDebuggerUrl: info.webSocketDebuggerUrl
    });
    for (const page of stale) {
      await session.send("Target.closeTarget", { targetId: page.id }).catch(() => {});
    }
    session.close();
    log(`${stale.length} eski sekme kapatıldı.`);
  } catch {
    // Kritik değil; başarısız olursa akış devam etsin.
  }
}

async function waitForDebugPort() {
  const portFile = join(PROFILE_DIR, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const port = Number(readFileSync(portFile, "utf-8").split("\n")[0]?.trim());
      // Port dosyası eski bir oturumdan kalmış olabilir; gerçekten yanıt versin.
      if (port > 0) {
        await listPages(port);
        return port;
      }
    } catch {
      // dosya henüz yazılmadı veya bağlantı hazır değil
    }
    await sleep(300);
  }
  throw new Error("Tarayıcının hata ayıklama bağlantısı açılmadı.");
}

// --- Hedef sayfalar -------------------------------------------------------

interface Target {
  key: "transkript" | "secilen" | "sinav" | "program";
  url: string;
  label: string;
  debugFile: string;
  /** Metin kontrolü gevşekse önceki sayfa yanlışlıkla "hazır" sayılmasın diye adres de eşleşmeli. */
  requireUrl?: boolean;
  /** Sayfa metni işlenebilir hale geldi mi? */
  isReady(text: string): boolean;
  build(text: string): string;
}

const transcriptTarget: Target = {
  key: "transkript",
  url: TRANSCRIPT_URL,
  label: "Transkript",
  debugFile: "notlar-debug.txt",
  isReady: (text) => transcriptLooksValid(parsePastedTranscript(text)),
  build(text) {
    const courses = parsePastedTranscript(text);
    const backup = {
      format: "sauscript-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      state: { courses, scenarios: [], gradePoints: SAU_GRADE_POINTS, mode: "sau" as const },
      termPlan: { season: "fall", selections: {}, scores: {}, goals: {}, started: false, startedAt: "" },
      theme: "light"
    };
    setPhase("ready", `${courses.length} ders bulundu, siteye aktarılıyor…`);
    return JSON.stringify({ mode: this.key, backup });
  }
};

const selectedCoursesTarget: Target = {
  key: "secilen",
  url: SELECTED_COURSES_URL,
  label: "Seçilen Dersler",
  debugFile: "secilen-dersler-debug.txt",
  isReady: (text) => parseSelectedCourses(text).length > 0,
  build(text) {
    setPhase("ready", `${parseSelectedCourses(text).length} ders bulundu, siteye aktarılıyor…`);
    return JSON.stringify({ mode: this.key, text });
  }
};

const examsTarget: Target = {
  key: "sinav",
  url: `${OBS_ORIGIN}/Ogrenci/SinavTakvimi`,
  label: "Sınav Takvimi",
  debugFile: "sinav-takvimi-debug.txt",
  requireUrl: true,
  isReady: (text) => text.includes("Sınav") || text.includes("Tarih"),
  build(text) { return JSON.stringify({ mode: this.key, text }); }
};

const scheduleTarget: Target = {
  key: "program",
  url: `${OBS_ORIGIN}/Ogrenci/DersProgrami`,
  label: "Ders Programı",
  debugFile: "ders-programi-debug.txt",
  requireUrl: true,
  isReady: (text) => text.includes("Pazartesi") || text.includes("Ders"),
  build(text) { return JSON.stringify({ mode: this.key, text }); }
};

/**
 * Kullanıcı SABİS girişini açılan pencerede kendisi yapar; burada sadece adres
 * çubuğunu ve sayfa metnini izleriz — konsolda Enter beklemek yok.
 */
async function waitForPageText(debugPort: number, target: Target, timeout = LOGIN_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let session: CdpSession | null = null;
  let lastNavigation = 0;
  // OBS'e gidilip login'e yönlendirilirken adres bir an OBS'te görünüyor; "giriş
  // yapıldı" demeden önce birkaç tur üst üste OBS'te kalmasını bekliyoruz.
  let obsStreak = 0;

  const loginMessage = `Tarayıcı açıldı. SABİS'e giriş yap — ${target.label} sayfası kendiliğinden açılacak.`;
  const readingMessage = `Giriş yapıldı. ${target.label} sayfası okunuyor…`;
  const announce = (phase: Phase, message: string) => {
    if (status.phase !== phase || status.message !== message) setPhase(phase, message);
  };

  setPhase("login", loginMessage);

  // Tarayıcının açık olup olmadığına süreç kimliğine değil, hata ayıklama
  // bağlantısına bakarak karar veriyoruz: aynı profille bir pencere zaten
  // açıksa başlattığımız süreç ona devredip hemen kapanabiliyor.
  let cdpMisses = 0;

  try {
    while (Date.now() < deadline) {
      let pages: CdpTarget[] = [];
      try {
        pages = await listPages(debugPort);
        cdpMisses = 0;
      } catch {
        cdpMisses += 1;
        if (cdpMisses > 5) throw new Error("Tarayıcı penceresi kapatıldı.");
        await sleep(1500);
        continue;
      }

      const page = pages.find((candidate) => candidate.url.startsWith(OBS_ORIGIN)) ?? pages[0];
      if (!page || !page.url.startsWith(OBS_ORIGIN)) {
        obsStreak = 0;
        announce("login", loginMessage);
        await sleep(1500);
        continue;
      }

      obsStreak += 1;
      if (obsStreak >= 2) announce("reading", readingMessage);

      if (session && session.targetId !== page.id) {
        session.close();
        session = null;
      }

      try {
        session ??= await CdpSession.open(page);
        const result = await session.send("Runtime.evaluate", { expression: SCRAPE_SNIPPET, returnByValue: true });
        const text = String(result?.result?.value ?? "");
        const onTargetPage = !target.requireUrl || page.url.toLowerCase().startsWith(target.url.toLowerCase());
        if (onTargetPage && target.isReady(text)) return text;

        // Doğru alan adındayız ama hedef sayfada değiliz: oraya götür.
        if (Date.now() - lastNavigation > 6000) {
          lastNavigation = Date.now();
          await session.send("Page.navigate", { url: target.url });
        }
      } catch {
        session?.close();
        session = null;
      }

      await sleep(1500);
    }
  } finally {
    session?.close();
  }

  throw new Error("Süre doldu — giriş tamamlanmadı.");
}

// --- Protokol kaydı -------------------------------------------------------

const INSTALL_DIR = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "SAUScript");
const INSTALL_PATH = join(INSTALL_DIR, "SAUScript-Yardimci.exe");

/**
 * Kendini kalıcı bir klasöre kopyalar. Aksi halde kayıt, indirilenler klasöründeki
 * dosyayı gösterir ve kullanıcı onu silince protokol bozulur.
 */
function installSelf() {
  if (process.execPath.toLowerCase() === INSTALL_PATH.toLowerCase()) return INSTALL_PATH;
  // Kaynaktan (node/tsx ile) çalışıyorsak kopyalanacak bir exe yok. Dosya adına
  // bakmıyoruz: tarayıcı ikinci indirmeyi "SAUScript-Yardimci (1).exe" diye kaydediyor.
  if (!isSea()) return process.execPath;
  mkdirSync(INSTALL_DIR, { recursive: true });
  copyFileSync(process.execPath, INSTALL_PATH);
  return INSTALL_PATH;
}

/** Tek dosyalık .exe kendini `sauscript://` işleyicisi olarak kaydeder. */
function registerProtocol(exePath: string) {
  // Kaynaktan (tsx ile) çalışırken yalnızca node.exe'yi kaydetmek protokolü bozar:
  // tsx yükleyicisi ve script yolu da komuta girmeli.
  const launcher = isSea() ? [exePath] : [process.execPath, ...process.execArgv, process.argv[1]];
  const command = [...launcher, "%1"].map((part) => `"${part}"`).join(" ");
  const run = (args: string[]) => execFileSync("reg", args, { stdio: ["ignore", "ignore", "pipe"] });
  run(["add", "HKCU\\Software\\Classes\\sauscript", "/ve", "/d", "URL:Sauscript Protocol", "/f"]);
  run(["add", "HKCU\\Software\\Classes\\sauscript", "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"]);
  run(["add", "HKCU\\Software\\Classes\\sauscript\\shell\\open\\command", "/ve", "/d", command, "/f"]);
  return command;
}

const DISPLAY_VERSION = "1.3.0";
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SAUScript";
const PROTOCOL_KEY = "HKCU\\Software\\Classes\\sauscript";

/** Windows "Yüklü uygulamalar" listesinde görünür; oradan Kaldır denince --uninstall çalışır. */
function registerUninstallEntry(exePath: string) {
  const sizeKb = Math.round(statSync(exePath).size / 1024);
  const values: [string, "REG_SZ" | "REG_DWORD", string][] = [
    ["DisplayName", "REG_SZ", "SAÜScript+ Yardımcı"],
    ["DisplayVersion", "REG_SZ", DISPLAY_VERSION],
    ["Publisher", "REG_SZ", "Yağız Berke Su"],
    ["DisplayIcon", "REG_SZ", exePath],
    ["InstallLocation", "REG_SZ", INSTALL_DIR],
    ["URLInfoAbout", "REG_SZ", "https://yagizberkesu.github.io/sauscript/"],
    ["UninstallString", "REG_SZ", `"${exePath}" --uninstall`],
    ["QuietUninstallString", "REG_SZ", `"${exePath}" --uninstall --quiet`],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
    ["EstimatedSize", "REG_DWORD", String(sizeKb)]
  ];
  for (const [name, type, data] of values) {
    execFileSync("reg", ["add", UNINSTALL_KEY, "/v", name, "/t", type, "/d", data, "/f"], { stdio: ["ignore", "ignore", "pipe"] });
  }
}

function runUninstaller(quiet: boolean) {
  if (!quiet && !askYesNo(
    "SAÜScript+ Yardımcı bu bilgisayardan kaldırılsın mı?\n\n" +
    "Program, SABİS için açılan tarayıcı profili ve sauscript:// bağlantısı silinir.\n" +
    "Sitedeki derslerin ve notların etkilenmez.",
    "SAÜScript+ Yardımcı'yı kaldır"
  )) return 0;

  for (const key of [PROTOCOL_KEY, UNINSTALL_KEY]) {
    try {
      execFileSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
    } catch {
      // anahtar zaten yok
    }
  }
  // log() bu klasörü yeniden oluşturacağı için buradan sonra log yazılmaz.
  try {
    rmSync(HOME_DIR, { recursive: true, force: true });
  } catch {
    // tarayıcı profili açıksa bazı dosyalar kalabilir
  }

  if (process.execPath.toLowerCase().startsWith(INSTALL_DIR.toLowerCase())) {
    // Çalışan exe kendini silemez: kapandıktan sonra klasörü silecek ayrı bir komut bırak.
    spawn("cmd.exe", ["/d", "/s", "/c", `"ping -n 3 127.0.0.1 >nul & rmdir /s /q "${INSTALL_DIR}""`], {
      detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true
    }).unref();
  } else {
    rmSync(INSTALL_DIR, { recursive: true, force: true });
  }

  if (!quiet) showMessage("SAÜScript+ Yardımcı kaldırıldı.", "SAÜScript+ Yardımcı");
  return 0;
}

/** PowerShell'de basit tırnak, iki basit tırnakla kaçırılır. */
const psQuote = (value: string) => value.replace(/'/g, "''");

/**
 * Exe, konsol penceresi açmasın diye GUI alt sistemiyle derleniyor; bu yüzden
 * kullanıcıya görünecek mesajlar Windows iletişim kutusuyla gösterilir.
 */
function showMessage(text: string, title = "SAÜScript") {
  if (process.platform !== "win32") {
    console.log(text);
    return;
  }
  try {
    execFileSync("powershell", [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
      `Add-Type -AssemblyName System.Windows.Forms;` +
      `[System.Windows.Forms.MessageBox]::Show('${psQuote(text)}','${psQuote(title)}') | Out-Null`
    ], { stdio: "ignore", windowsHide: true });
  } catch {
    console.log(text);
  }
}

function askYesNo(text: string, title: string) {
  if (process.platform !== "win32") return true;
  try {
    const answer = execFileSync("powershell", [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
      `Add-Type -AssemblyName System.Windows.Forms;` +
      `[System.Windows.Forms.MessageBox]::Show('${psQuote(text)}','${psQuote(title)}','YesNo','Question')`
    ], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return answer.trim() === "Yes";
  } catch {
    return false;
  }
}

function runInstaller() {
  log("Kurulum başlatıldı.");

  const browsers = installedChromiumPaths();
  if (!browsers.length) {
    showMessage(
      "Chromium tabanlı bir tarayıcı bulunamadı.\n\n" +
      "Chrome, Edge, Opera, Brave veya Vivaldi'den birini kurup bu dosyayı tekrar çalıştır.",
      "SAÜScript — kurulum yapılamadı"
    );
    return 1;
  }

  try {
    const exePath = installSelf();
    registerProtocol(exePath);
    if (isSea()) registerUninstallEntry(exePath);
    log(`Kuruldu: ${exePath} · tarayıcı: ${browsers[0]}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Kurulum hatası: ${message}`);
    showMessage(`Kurulum tamamlanamadı.\n\n${message}`, "SAÜScript — kurulum yapılamadı");
    return 1;
  }

  showMessage(
    "Kurulum tamamlandı.\n\n" +
    `Kullanılacak tarayıcı: ${browsers[0]}\n\n` +
    "Şimdi SAÜScript sitesine dön ve \"SABİS'ten otomatik çek\" düğmesine bas.\n" +
    "İndirdiğin bu dosyayı artık silebilirsin.",
    "SAÜScript — kurulum tamam"
  );
  return 0;
}

// --- Giriş noktası --------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const arg = args.join(" ");

  // --check-browser: kurulum betiği, indirmeye gerek olup olmadığını buradan öğreniyor.
  if (arg.includes("--check-browser")) {
    const [found] = installedChromiumPaths();
    if (found) console.log(found);
    process.exit(found ? 0 : 1);
  }

  if (arg.includes("--uninstall")) process.exit(runUninstaller(arg.includes("--quiet")));

  // 1.3.0'dan önce kurananlar da "Yüklü uygulamalar" listesine girsin.
  if (args.length && isSea() && process.execPath.toLowerCase() === INSTALL_PATH.toLowerCase()) {
    try {
      registerUninstallEntry(INSTALL_PATH);
    } catch {
      // kayıt yazılamazsa asıl işi engelleme
    }
  }

  // Argümansız çalıştırma (exe'ye çift tıklama) kurulum demektir.
  if (!args.length || arg.includes("--register")) {
    const code = runInstaller();
    await waitForKeypress();
    process.exit(code);
  }

  const isCombined = arg.includes("fetch-all");
  const target = arg.includes("fetch-selected") ? selectedCoursesTarget : transcriptTarget;
  // --file: protokol kurulu değilken elle çalıştırmak için; veriyi sunmak yerine dosyaya yazar.
  const fileMode = arg.includes("--file");
  status.mode = isCombined ? "combined" : target.key;

  log(`SAÜScript yardımcı programı — ${isCombined ? "Tüm SABİS verileri" : target.label}`);
  const closeServer = fileMode ? () => process.exit(0) : await startServer();

  let child: ChildProcess | null = null;
  let debugPort = 0;
  try {
    const [exe] = installedChromiumPaths();
    if (!exe) throw new Error("Chromium tabanlı bir tarayıcı bulunamadı (Chrome, Edge, Opera, Brave, Vivaldi…).");
    log(`Tarayıcı: ${exe}`);

    await mkdir(PROFILE_DIR, { recursive: true });
    child = launchBrowser(exe, target.url);
    debugPort = await waitForDebugPort();

    // Önceki oturumdan kalan eski SABİS sekmelerini temizle.
    await closeStalePages(debugPort, target.url);

    const text = await waitForPageText(debugPort, target);
    await writeFile(join(HOME_DIR, target.debugFile), text, "utf-8").catch(() => {});

    if (isCombined) {
      // Transkript okundu; şimdi seçilen dersleri de çekmeye çalış.
      const courses = parsePastedTranscript(text);
      log(`Transkript okundu: ${courses.length} ders. Seçilen dersler sayfasına geçiliyor…`);
      setPhase("reading", `${courses.length} ders bulundu. Seçilen Dersler sayfası okunuyor…`);

      // Kullanıcı zaten giriş yaptı; ek sayfalar açılmazsa uzun süre bekletmeden geç.
      const readOptional = async (extra: Target) => {
        try {
          const extraText = await waitForPageText(debugPort, extra, SECONDARY_TIMEOUT);
          await writeFile(join(HOME_DIR, extra.debugFile), extraText, "utf-8").catch(() => {});
          log(`${extra.label} okundu.`);
          return extraText;
        } catch {
          log(`${extra.label} okunamadı, olan verilerle devam edilecek.`);
          return null;
        }
      };

      const selectedText = await readOptional(selectedCoursesTarget);
      setPhase("reading", "Sınav Takvimi okunuyor…");
      const examsText = await readOptional(examsTarget);
      setPhase("reading", "Ders Programı okunuyor…");
      const scheduleText = await readOptional(scheduleTarget);

      const backup = {
        format: "sauscript-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        state: { courses, scenarios: [], gradePoints: SAU_GRADE_POINTS, mode: "sau" as const },
        termPlan: { season: "fall", selections: {}, scores: {}, goals: {}, started: false, startedAt: "" },
        theme: "light"
      };
      const result: Record<string, unknown> = { mode: "combined", backup };
      if (selectedText && parseSelectedCourses(selectedText).length > 0) result.selectedText = selectedText;
      if (examsText) result.examsText = examsText;
      if (scheduleText) result.scheduleText = scheduleText;

      setPhase("ready", `${courses.length} ders bulundu, tüm bilgiler aktarılıyor…`);
      payload = JSON.stringify(result);
    } else {
      payload = target.build(text);
    }
  } catch (error) {
    setPhase("error", error instanceof Error ? error.message : String(error));
  } finally {
    // Süreci öldürmek yetmiyor: başlattığımız süreç işi devredip kapanmış
    // olabilir. Pencereyi tarayıcının kendi kapatma komutuyla kapatıyoruz.
    if (debugPort) await closeBrowser(debugPort);
    child?.kill();
  }

  if (!payload) {
    if (fileMode) process.exit(1);
    // Site hatayı /status üzerinden okuyabilsin diye kısa süre daha ayakta kal.
    await sleep(20000);
    closeServer();
    return;
  }

  if (fileMode) {
    const parsed = JSON.parse(payload);
    const stamp = new Date().toISOString().slice(0, 10);
    if (parsed.backup) {
      const filename = `sauscript-transkript-${stamp}.json`;
      await writeFile(filename, JSON.stringify(parsed.backup, null, 2), "utf-8");
      console.log(`\nKaydedildi: ${filename}`);
      console.log("SAÜScript'te 'Veri yedeği' > 'JSON yedeğini yükle' ile bu dosyayı seçebilirsin.");
      if (parsed.selectedText) {
        const selFilename = `sauscript-secilen-dersler-${stamp}.txt`;
        await writeFile(selFilename, parsed.selectedText, "utf-8");
        console.log(`Kaydedildi: ${selFilename}`);
      }
    } else {
      const filename = `sauscript-secilen-dersler-${stamp}.txt`;
      await writeFile(filename, parsed.text, "utf-8");
      console.log(`\nKaydedildi: ${filename}`);
      console.log("Dosyanın içeriğini 'Seçilen Dersler' metin kutusuna yapıştırabilirsin.");
    }
    process.exit(0);
  }

  log("Siteye dön — veri otomatik aktarılıyor.");
  await sleep(PICKUP_TIMEOUT);
  closeServer();
}

function waitForKeypress() {
  if (!process.stdin.isTTY) return Promise.resolve();
  console.log("\nKapatmak için bir tuşa bas...");
  return new Promise<void>((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve();
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
