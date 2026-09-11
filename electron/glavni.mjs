/*
 * Lucify kao namjenska aplikacija.
 *
 * Ono što na webu radi samo `npm run dev`, ovdje radi uvijek: zbirku i
 * preuzimač poslužuje vlastiti poslužitelj iz `posluzitelj.mjs`, istim
 * rukovateljima koje na razvoju veže `vite.config.js`. Zato je „Dodaj pjesmu”
 * ovdje prisutan, a na objavljenoj stranici nije.
 *
 * Zbirka **ne stoji uz program**, nego u mapi koju čovjek bira, jer program
 * ide u `Program Files`, kamo se ne piše, a zbirka naraste na stotine
 * megabajta i mora preživjeti nadogradnju.
 */

import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pokreniPosluzitelj } from "./posluzitelj.mjs";

const ovdje = path.dirname(fileURLToPath(import.meta.url));
const korijenPrograma = path.join(ovdje, "..");

/** Postavke: zasad samo mapa zbirke. Stoje uz podatke aplikacije, ne uz program. */
const postavkePut = () => path.join(app.getPath("userData"), "postavke.json");

/** @returns {{ zbirka?: string }} */
function procitajPostavke() {
  try {
    return JSON.parse(readFileSync(postavkePut(), "utf8"));
  } catch {
    return {};
  }
}

/** @param {{ zbirka?: string }} nove */
function zapisiPostavke(nove) {
  writeFileSync(postavkePut(), JSON.stringify(nove, null, 2) + "\n", "utf8");
}

/**
 * Gdje zbirka stoji. Redom: ono što je čovjek odabrao, pa `LUCIFY_ZBIRKA` iz
 * okoline, pa mapa projekta dok se radi na Lucifyju, pa `Glazba/Lucify` u
 * korisnikovoj mapi s glazbom.
 */
function nadiZbirku() {
  const spremljeno = procitajPostavke().zbirka;
  if (spremljeno && existsSync(spremljeno)) return spremljeno;
  if (process.env.LUCIFY_ZBIRKA) return process.env.LUCIFY_ZBIRKA;
  if (!app.isPackaged) return korijenPrograma;
  return path.join(app.getPath("music"), "Lucify");
}

/**
 * ffmpeg dolazi s programom, kroz `ffmpeg-static`. Unutar `.asar` arhive se ne
 * da pokrenuti, pa ga graditelj ostavi raspakiranoga u `app.asar.unpacked`, a
 * ovdje se putanja samo preusmjeri onamo. Preuzimač ga poslije nađe kroz
 * `FFMPEG_PATH`, jer tu varijablu ionako već gleda.
 */
function pripremiFfmpeg() {
  if (process.env.FFMPEG_PATH) return;
  try {
    const zatrazi = createRequire(import.meta.url);
    const program = String(zatrazi("ffmpeg-static")).replace("app.asar", "app.asar.unpacked");
    if (existsSync(program)) process.env.FFMPEG_PATH = program;
  } catch {
    /* paketa nema; preuzimač će sam reći da ffmpeg fali */
  }
}

/** @type {BrowserWindow | null} */
let prozor = null;
/** @type {{ adresa: string, zatvori: () => void } | null} */
let posluzitelj = null;

async function otvori() {
  const zbirka = nadiZbirku();
  /* Prazna mapa nije greška: Lucify u tom slučaju kaže da je zbirka prazna i
     ponudi „Dodaj pjesmu”. Bez mape ne bi bilo ni kamo preuzeti. */
  mkdirSync(path.join(zbirka, "Glazba", "Zvuk"), { recursive: true });

  posluzitelj = await pokreniPosluzitelj({
    dist: path.join(korijenPrograma, "dist"),
    zbirka,
  });

  prozor = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: "#0a0a0b",
    title: "Lucify",
    icon: path.join(korijenPrograma, "build", "icon.png"),
    /* Stranica ništa ne traži od Node.ja: sve ide kroz `fetch` na vlastiti
       poslužitelj, pa prozor ostaje zatvoren prema sustavu. */
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  prozor.once("ready-to-show", () => prozor && prozor.show());
  prozor.on("closed", () => {
    prozor = null;
  });

  /* Poveznice izvan Lucifyja (YouTube, izvor snimke) otvaraju se u pravom
     pregledniku, a ne u prozoru aplikacije, koji nema ni traku ni „natrag”. */
  prozor.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  await prozor.loadURL(posluzitelj.adresa);
  slozJelovnik(zbirka);
}

/**
 * Jelovnik. Mapa zbirke mora se dati otvoriti i promijeniti, jer je inače
 * zakopana u korisnikovoj mapi i nema joj druge vrate.
 *
 * @param {string} zbirka
 */
function slozJelovnik(zbirka) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Lucify",
        submenu: [
          {
            label: "Otvori mapu zbirke",
            click: () => shell.openPath(path.join(zbirka, "Glazba", "Zvuk")),
          },
          {
            label: "Promijeni mapu zbirke…",
            click: async () => {
              const izbor = await dialog.showOpenDialog({
                title: "Gdje stoji zbirka",
                defaultPath: zbirka,
                properties: ["openDirectory", "createDirectory"],
              });
              if (izbor.canceled || !izbor.filePaths[0]) return;
              zapisiPostavke({ ...procitajPostavke(), zbirka: izbor.filePaths[0] });
              /* Poslužitelj je mapu zapamtio pri pokretanju, pa se nova vidi
                 tek iz početka. Bolje to nego pola stanja na jednoj, pola na
                 drugoj mapi. */
              app.relaunch();
              app.exit(0);
            },
          },
          { type: "separator" },
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "quit", label: "Izlaz" },
        ],
      },
      {
        label: "Uredi",
        submenu: [
          { role: "undo", label: "Poništi" },
          { role: "redo", label: "Ponovi" },
          { type: "separator" },
          { role: "cut", label: "Izreži" },
          { role: "copy", label: "Kopiraj" },
          { role: "paste", label: "Zalijepi" },
          { role: "selectAll", label: "Odaberi sve" },
        ],
      },
    ]),
  );
}

/** @param {unknown} greska */
function pukni(greska) {
  const poruka = greska instanceof Error ? greska.stack || greska.message : String(greska);
  dialog.showErrorBox("Lucify se ne da otvoriti", poruka);
  app.exit(1);
}

/* Jedan Lucify po računalu. Drugo pokretanje samo digne prozor prvoga: dva bi
   preuzimača u istu mapu pisala jedan preko drugoga. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!prozor) return;
    if (prozor.isMinimized()) prozor.restore();
    prozor.focus();
  });

  pripremiFfmpeg();

  /* Greška pri pokretanju mora se vidjeti. Bez ovoga bi program samo stajao u
     popisu procesa, bez prozora i bez ijedne poruke: `console` na Windowsima
     nema kamo pisati, jer je Electron program s prozorom, a ne s retkom. */
  app.whenReady().then(otvori).catch(pukni);

  app.on("window-all-closed", () => {
    if (posluzitelj) posluzitelj.zatvori();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) otvori();
  });
}
