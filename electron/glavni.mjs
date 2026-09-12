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
import elektronskiNadograditelj from "electron-updater";
import { pokreniPosluzitelj } from "./posluzitelj.mjs";

/* `electron-updater` je CommonJS, pa iz njega izlazi jedan predmet, a ne
   imenovani izvozi. Odatle ovaj rastav. */
const { autoUpdater } = elektronskiNadograditelj;

/**
 * Visina gornje trake, onakve kakvu crta stranica (`.gvrh` u `glazba.css`).
 *
 * Gumbe prozora crta Windows, a ne stranica, pa mu treba reći dokle traka
 * seže: niže bi ih spustilo preko sadržaja, više bi ih objesilo iznad trake.
 * Dvije mjere moraju ostati iste, pa se mijenjaju zajedno.
 */
const VISINA_TRAKE = 58;

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

/**
 * yt-dlp isto dolazi s programom, ali kroz mapu `alati/`, jer za nj npm paketa
 * nema. Vrijedi i ovdje ono što i za ffmpeg: iz `.asar` arhive se program ne
 * da pokrenuti, pa ga graditelj ostavi u `app.asar.unpacked`. Preuzimač ga
 * nađe kroz `YTDLP_PATH`, koji mu je prvi na popisu.
 *
 * Imena se ne računaju nego se redom isprobavaju: tako se ovaj popis i onaj u
 * `scripts/alati.mjs` ne mogu razići.
 *
 * @param {string} zbirka mapa zbirke, u kojoj stoji osvježeni yt-dlp
 */
function pripremiYtDlp(zbirka) {
  if (process.env.YTDLP_PATH) return;
  /* Mapa zbirke ide prva, a zapakirana druga. Redoslijed je ovdje sav posao:
     zapakirani yt-dlp stari zajedno s programom, a onaj uz zbirku je onaj koji
     je čovjek osvježio iz „Dodaj pjesmu”. Da je obrnuto, osvježeni bi vrijedio
     samo do prvoga zatvaranja prozora. */
  const mape = [
    path.join(zbirka, "alati"),
    path.join(korijenPrograma, "alati").replace("app.asar", "app.asar.unpacked"),
  ];
  for (const mapa of mape) {
    for (const ime of ["yt-dlp.exe", "yt-dlp_macos", "yt-dlp_linux", "yt-dlp"]) {
      const program = path.join(mapa, ime);
      if (existsSync(program)) {
        process.env.YTDLP_PATH = program;
        return;
      }
    }
  }
}

/*
 * Nadogradnja.
 *
 * Bez ovoga instalirani Lucify ostaje zauvijek na inačici s kojom je došao:
 * popravak u preuzimaču ili noviji yt-dlp ne bi stigli ni do koga tko ne gradi
 * sam iz izvora. Graditelj uz program ionako slaže `latest.yml`, pa je ostalo
 * samo reći odakle da se čita.
 *
 * Tri mjesta na kojima se **ne** provjerava, i sva tri s razlogom:
 *
 * - iz izvora (`npm run namjenska`), jer ondje nema ni inačice ni instalacije
 *   koju bi imalo smisla zamijeniti;
 * - u prijenosnom programu, koji se ne instalira nego se nosi na sebi, pa ga
 *   nadograditelj ne zna ni naći ni zamijeniti. Prepoznaje se po tome što mu
 *   graditelj upiše `PORTABLE_EXECUTABLE_DIR`;
 * - kad izdanja još nema, što nije greška nego samo tišina.
 */
function pripremiNadogradnju() {
  if (!app.isPackaged) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return;

  /* Greška pri provjeri ne smije ni srušiti program ni iskočiti čovjeku pred
     oči: Lucify radi i bez nadogradnje, a mreže na putu zna nestati. */
  autoUpdater.on("error", (greska) => {
    console.error("Nadogradnja: " + (greska && greska.message ? greska.message : String(greska)));
  });

  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* već je javljeno gore */
  });
}

/**
 * Ista provjera, ali na zahtjev, iz jelovnika. Ovdje šutnja nije u redu: tko
 * je sam pitao, mora dobiti odgovor i onda kad je odgovor „nema novoga”.
 */
async function provjeriNadogradnju() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
    await dialog.showMessageBox({
      type: "info",
      message: "Ovaj se Lucify ne nadograđuje sam.",
      detail: process.env.PORTABLE_EXECUTABLE_DIR
        ? "Prijenosni program nosi se na sebi, pa se ne da zamijeniti izvana. Noviji se uzima s GitHuba, kao i ovaj."
        : "Pokrenut je iz izvora. Ondje se nadograđuje gitom.",
    });
    return;
  }

  try {
    const ishod = await autoUpdater.checkForUpdates();
    const novija = ishod && ishod.updateInfo && ishod.updateInfo.version;
    if (!novija || novija === app.getVersion()) {
      await dialog.showMessageBox({
        type: "info",
        message: "Lucify je već posljednji.",
        detail: "Inačica " + app.getVersion() + ".",
      });
    }
    /* Ako novija postoji, `checkForUpdates` ju je već počeo preuzimati, a
       `checkForUpdatesAndNotify` javi kad bude gotova. */
  } catch (greska) {
    await dialog.showMessageBox({
      type: "warning",
      message: "Provjera nije uspjela.",
      detail: String((greska && /** @type {any} */ (greska).message) || greska),
    });
  }
}

/** @type {BrowserWindow | null} */
let prozor = null;
/** @type {{ adresa: string, zatvori: () => void } | null} */
let posluzitelj = null;
/** @type {Electron.Menu | null} */
let jelovnik = null;

async function otvori() {
  const zbirka = nadiZbirku();
  /* Prazna mapa nije greška: Lucify u tom slučaju kaže da je zbirka prazna i
     ponudi „Dodaj pjesmu”. Bez mape ne bi bilo ni kamo preuzeti. */
  mkdirSync(path.join(zbirka, "Glazba", "Zvuk"), { recursive: true });

  /* Tek ovdje, a ne uz `pripremiFfmpeg()`: yt-dlp se traži i uz zbirku, a gdje
     zbirka stoji zna se tek kad se pročitaju postavke. */
  pripremiYtDlp(zbirka);

  posluzitelj = await pokreniPosluzitelj({
    dist: path.join(korijenPrograma, "dist"),
    zbirka,
    jelovnik: otvoriJelovnik,
  });

  prozor = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: "#0a0a0b",
    title: "Lucify",
    icon: path.join(korijenPrograma, "build", "icon.png"),
    /* Gumbe prozora (—, ▢, ✕) i dalje crta Windows, ali preko same stranice i
       u njezinim bojama, pa gornja traka Lucifyja ide sve do vrha: iznad nje
       više nema ni sustavske naslovne trake ni retka s jelovnikom. Traka se
       zato u `glazba.css` proglašava povlačnom, jer se inače prozor ne bi imao
       za što uhvatiti. */
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0b",
      symbolColor: "#b3b3b3",
      height: VISINA_TRAKE,
    },
    /* Jelovnik ostaje i radi, ali se ne vidi dok se ne pritisne Alt. Da na
       tome ostane, mapa zbirke ne bi imala vrata, pa ih stranica dobiva u
       traci, tipkom koja otvara isti ovaj jelovnik. */
    autoHideMenuBar: true,
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
 * Sustavski jelovnik na zahtjev stranice.
 *
 * Otkad prozor nema sustavske naslovne trake, nema ni retka s jelovnikom nad
 * njom: ostao je na Altu, a to nitko ne pogodi. Zato ga stranica otvara tipkom
 * u gornjoj traci, a pita za nj isto kao i za sve ostalo — `fetch` na vlastiti
 * poslužitelj. Node joj ni zbog ovoga nije trebalo otvoriti.
 */
function otvoriJelovnik() {
  if (jelovnik && prozor) jelovnik.popup({ window: prozor });
}

/**
 * Jelovnik. Mapa zbirke mora se dati otvoriti i promijeniti, jer je inače
 * zakopana u korisnikovoj mapi i nema joj druge vrate.
 *
 * Pamti se, a ne samo postavlja, jer isti onaj koji stoji pod Altom mora moći
 * iskočiti i pod tipkom u traci.
 *
 * @param {string} zbirka
 */
function slozJelovnik(zbirka) {
  jelovnik = Menu.buildFromTemplate([
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
        {
          label: "Provjeri ima li novoga Lucifyja…",
          click: () => provjeriNadogradnju(),
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
  ]);
  Menu.setApplicationMenu(jelovnik);
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
  pripremiNadogradnju();

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
