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

import { app, BrowserWindow, Menu, Notification, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import elektronskiNadograditelj from "electron-updater";
import { pokreniPosluzitelj } from "./posluzitelj.mjs";
import { windowsBrani } from "./zapreka.mjs";
import { izvezi, izveziZip } from "../scripts/izvezi.mjs";

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

/**
 * Postavke: mapa zbirke i inačica za koju je već rečeno da je Windows ne pušta.
 * Stoje uz podatke aplikacije, ne uz program.
 */
const postavkePut = () => path.join(app.getPath("userData"), "postavke.json");

/** Stranica s izdanjima, kamo se ide kad nadogradnja ne ide sama. */
const IZDANJA = "https://github.com/Latinicus-Admin-Leo/Lucify/releases/latest";

/** @returns {{ zbirka?: string, javljenaZapreka?: string }} */
function procitajPostavke() {
  try {
    return JSON.parse(readFileSync(postavkePut(), "utf8"));
  } catch {
    return {};
  }
}

/** @param {{ zbirka?: string, javljenaZapreka?: string }} nove */
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
 *
 * Obavijest „instalirat će se kad zatvoriš” šalje se odavde, a ne iz
 * `checkForUpdatesAndNotify`, jer se prije nje mora pitati **pušta li je
 * Windows uopće** (`zapreka.mjs`). Kad je ne pušta, instalacija pri zatvaranju
 * se isključi, pa nema ni pitanja za administratora ni kruga u kojem se ista
 * nadogradnja nudi svaki put; umjesto toga to se kaže jednom, riječima.
 */
function pripremiNadogradnju() {
  if (!app.isPackaged) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return;

  /* Greška pri provjeri ne smije ni srušiti program ni iskočiti čovjeku pred
     oči: Lucify radi i bez nadogradnje, a mreže na putu zna nestati. */
  autoUpdater.on("error", (greska) => {
    console.error("Nadogradnja: " + (greska && greska.message ? greska.message : String(greska)));
  });

  /* Dok se ne zna pušta li Windows instalaciju, pri zatvaranju se ne pokreće
     ništa: zatvori li čovjek Lucify baš dok provjera traje, krug bi počeo. */
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-downloaded", (podatci) => {
    naPreuzeto(podatci).catch((greska) => console.error("Nadogradnja: " + String(greska)));
  });

  autoUpdater.checkForUpdates().catch(() => {
    /* već je javljeno gore */
  });
}

/** Je li provjeru pokrenuo čovjek iz jelovnika. Tada se zapreka kaže i drugi put. */
let rucnaProvjera = false;

/**
 * Nadogradnja je preuzeta. Ili će se instalirati pri zatvaranju, ili je
 * Windows ne pušta, pa se to kaže.
 *
 * @param {{ version: string, downloadedFile?: string }} podatci
 */
async function naPreuzeto(podatci) {
  const rucno = rucnaProvjera;
  rucnaProvjera = false;

  if (podatci.downloadedFile && (await windowsBrani(podatci.downloadedFile))) {
    autoUpdater.autoInstallOnAppQuit = false;
    const postavke = procitajPostavke();
    if (!rucno && postavke.javljenaZapreka === podatci.version) return;
    zapisiPostavke({ ...postavke, javljenaZapreka: podatci.version });

    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Otvori izdanja", "U redu"],
      defaultId: 1,
      cancelId: 1,
      message: "Lucify " + podatci.version + " je preuzet, ali ga Windows ne da instalirati.",
      detail:
        "Na ovom računalu uključena je Pametna kontrola aplikacija (Smart App Control), a ona ne " +
        "pušta programe bez digitalnog potpisa. Lucify ga nema, pa se ne nadograđuje sam.\n\n" +
        "Isključuje se u Sigurnosti sustava Windows → Kontrola aplikacija i preglednika → Postavke " +
        "pametne kontrole aplikacija. Poslije toga Lucify se nadogradi sam, pri idućem zatvaranju.",
    });
    if (response === 0) shell.openExternal(IZDANJA);
    return;
  }

  autoUpdater.autoInstallOnAppQuit = true;
  if (Notification.isSupported()) {
    new Notification({
      title: "Nova inačica Lucifyja",
      body: "Lucify " + podatci.version + " je preuzet i instalirat će se kad ga zatvoriš.",
    }).show();
  }
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
    rucnaProvjera = true;
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
       `naPreuzeto` javi kad bude gotova, i kaže ako je Windows ne pušta. */
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
    /* Na Windowsima `.ico`, jer u njemu svaka mjera stoji gotova: PNG od 1024
       točke sustav sam stisne za traku zadataka, i to nazubljeno. */
    icon: path.join(korijenPrograma, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
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
  /* Prozor se pokazuje na ono što stigne prvo: na prvi nacrtani kadar ili na
     učitanu stranicu. `ready-to-show` je brži, ali sam nije dovoljan, jer
     čeka kadar, a kompozitor za skriven prozor na nekim postavama grafike ne
     nacrta ni jedan. Program tada radi kako treba -- poslužitelj sluša,
     stranica se do kraja učita, jelovnik stoji -- samo se prozor ne pokaže
     nikad, pa se čini da se program nije ni otvorio. */
  const pokazi = () => {
    if (prozor && !prozor.isVisible()) prozor.show();
  };
  prozor.once("ready-to-show", pokazi);
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
  /* Druga polovica gornjega: `loadURL` čeka upravo kraj učitavanja, pa se
     prozor koji se pokaže ovdje ne vidi nedovršen. */
  pokazi();
  zbirkaSada = zbirka;
  slozJelovnik(zbirka);
  await osvjeziJelovnik();
  /* Jelovnik pod Altom ne ide kroz `otvoriJelovnik`, pa se osvježi ovdje. */
  prozor.on("focus", () => {
    osvjeziJelovnik().catch(() => {});
  });
}

/** Je li izvoz u tijeku: dva odjednom pisala bi u istu mapu. */
let izvozTece = false;

/**
 * Izvoz zbirke za mobitel, iz jelovnika.
 *
 * Dosad je to radila samo naredba `npm run izvezi`, a nje u gotovom programu
 * nema: tko je Lucify samo instalirao, nema ni mape projekta ni Nodea, pa
 * zbirku nije imao kako prenijeti na mobitel. Sada radi i ondje, jer `scripts/`
 * i ffmpeg ionako putuju s programom.
 *
 * @param {string} zbirka
 */
async function izvozZaMobitel(zbirka) {
  if (izvozTece || !prozor) return;

  const izbor = await dialog.showOpenDialog(prozor, {
    title: "Kamo izvesti zbirku",
    defaultPath: path.join(app.getPath("music"), "Lucify za mobitel"),
    buttonLabel: "Izvezi ovamo",
    properties: ["openDirectory", "createDirectory"],
  });
  if (izbor.canceled || !izbor.filePaths[0]) return;
  const kamo = izbor.filePaths[0];

  izvozTece = true;
  try {
    const r = await izvezi({
      korijen: zbirka,
      kamo,
      /* Napredak ide u traku sustava, pod ikonu programa: izvoz od sto pedeset
         pjesama traje desetak sekunda, a bez ijednoga znaka izgledao bi kao da
         se ništa ne događa. */
      naNapredak: (n) => {
        if (prozor) prozor.setProgressBar(n.gotovo / n.ukupno);
      },
    });
    if (prozor) prozor.setProgressBar(-1);

    const mb = Math.round(r.bajtova / (1024 * 1024));
    const odgovor = await dialog.showMessageBox(prozor, {
      type: r.greske.length ? "warning" : "info",
      message: "Izvezeno " + (r.napisano + r.preskoceno) + " od " + r.ukupno + ", " + mb + " MB.",
      detail:
        (r.preskoceno
          ? r.preskoceno + " je već stajalo ondje, pa se nije pisalo iznova.\n\n"
          : "") +
        "Prenesi ovu mapu na mobitel, pa ondje u Lucifyju: Zbirka \u2192 Odaberi mapu." +
        (r.greske.length ? "\n\nNije izašlo: " + r.greske.length + "." : ""),
      buttons: ["Otvori mapu", "U redu"],
      defaultId: 0,
      cancelId: 1,
    });
    if (odgovor.response === 0) shell.openPath(kamo);
  } catch (greska) {
    if (prozor) prozor.setProgressBar(-1);
    await dialog.showMessageBox(prozor, {
      type: "warning",
      message: "Izvoz nije uspio.",
      detail: String((greska && /** @type {any} */ (greska).message) || greska),
    });
  } finally {
    izvozTece = false;
  }
}

/**
 * Izvoz u jednu datoteku, za Lucify na mobitelu.
 *
 * Izvoz u mapu ostaje iznad ovoga, za tuđe svirače, gdje mapa i treba biti
 * mapa. Ovo je za Lucify, i miče ono što je u tom putu bilo najgore: mapu od
 * sto pedeset datoteka trebalo je prenijeti na uređaj i ondje je cijelu predati
 * Lucifyju, a na iPhoneu, koji za mape ne zna, označiti sto pedeset datoteka u
 * Datotekama i pripaziti da je `popis.json` među njima.
 *
 * Sada putuje jedna datoteka, i u njoj samo ono što uređaj još nema. Što je već
 * otišlo, zapisano je uz zbirku, pa drugi izvoz nosi dvije nove pjesme umjesto
 * cijele zbirke — a s manje toga na uređaj i manje ostane ležati pokraj
 * Lucifyjeve zbirke, koju uvoz svejedno puni.
 *
 * S datotekom putuju i vlastiti popisi, pa ih uvoz na mobitelu doda. Izvoz može
 * biti i samo iz popisa: iz svih ili iz jednoga, i tada nosi samo njihove
 * pjesme i samo njih.
 *
 * @param {string} zbirka
 * @param {boolean} [sve] ne gledaj zapis: cijela zbirka, ili cijeli odabrani popisi
 * @param {string | null} [popis] `null` za cijelu zbirku, `SVI_POPISI`, ili oznaka jednoga popisa
 */
async function izvozUDatoteku(zbirka, sve = false, popis = null) {
  if (izvozTece || !prozor) return;

  /* Popisi se čitaju tek sada, a ne pri slaganju jelovnika: od onda je koji
     mogao nestati ili narasti. */
  const liste = await procitajListe();
  const jedan = popis && popis !== SVI_POPISI ? liste.find((l) => l.id === popis) : null;
  if (popis && popis !== SVI_POPISI && !jedan) return;
  const odabrane = jedan ? [jedan] : liste;
  const samo = popis ? odabrane.flatMap((l) => l.pjesme) : undefined;

  const sto = jedan
    ? "popis „" + jedan.naslov + "”"
    : popis
      ? sve ? "sve pjesme iz popisa" : "nove pjesme iz popisa"
      : sve ? "cijelu zbirku" : "izvoz za mobitel";
  const danas = new Date().toISOString().slice(0, 10);
  const uImenu = jedan ? cistoIme(jedan.naslov) + " " : popis ? "popisi " : "";
  const izbor = await dialog.showSaveDialog(prozor, {
    title: "Kamo spremiti " + sto,
    defaultPath: path.join(app.getPath("music"), "Lucify za mobitel " + uImenu + danas + ".zip"),
    buttonLabel: "Izvezi",
    filters: [{ name: "Arhiva", extensions: ["zip"] }],
  });
  if (izbor.canceled || !izbor.filePath) return;
  const kamo = izbor.filePath;

  /* Ponavljanje ide izvan `try`: dok je `izvozTece` još podignut, drugi bi se
     poziv odmah vratio. */
  let ponovi = false;
  izvozTece = true;
  try {
    const r = await izveziZip({
      korijen: zbirka,
      kamo,
      sve,
      samo,
      liste: odabrane,
      naNapredak: (n) => {
        if (prozor) prozor.setProgressBar(n.ukupno ? n.gotovo / n.ukupno : 1);
      },
    });
    if (prozor) prozor.setProgressBar(-1);

    /* Bez ijedne nove pjesme datoteka nije uzalud — u njoj je osvježen popis,
       pa na uređaj odu nove police, ispravljeni naslovi i vlastiti popisi — ali
       čovjeku koji je htio prenijeti glazbu to treba reći, i ponuditi ono što
       je vjerojatno htio. Ako je htio baš sve, nema se što ponuditi. */
    const nista = !r.napisano;
    const ponudi = nista && !sve;
    const mb = Math.round(r.arhiva / (1024 * 1024));
    const gumbi = ponudi
      ? [jedan ? "Izvezi cijeli popis" : popis ? "Izvezi sve pjesme iz popisa" : "Izvezi cijelu zbirku", "Pokaži datoteku", "U redu"]
      : ["Pokaži datoteku", "U redu"];
    const odgovor = await dialog.showMessageBox(prozor, {
      type: r.greske.length ? "warning" : "info",
      message: nista
        ? "Novih pjesama nema."
        : "U datoteci: " + r.napisano + " od " + r.ukupno + ", " + mb + " MB.",
      detail:
        (nista
          ? "Datoteka je svejedno složena i u njoj je osvježen popis, pa na uređaj " +
            "odu nove police, ispravljeni naslovi i vlastiti popisi.\n\n"
          : r.preskoceno
            ? "Ostalo mobitel već ima, pa nije ni pisano.\n\n"
            : "") +
        (r.popisa ? "Vlastitih popisa u datoteci: " + r.popisa + ".\n\n" : "") +
        "Prenesi datoteku na mobitel, pa ondje u Lucifyju: Zbirka → Odaberi datoteku." +
        (r.greske.length ? "\n\nNije izašlo: " + r.greske.length + "." : ""),
      buttons: gumbi,
      defaultId: 0,
      cancelId: gumbi.length - 1,
    });
    if (ponudi && odgovor.response === 0) ponovi = true;
    else if (odgovor.response === (ponudi ? 1 : 0)) shell.showItemInFolder(kamo);
  } catch (greska) {
    if (prozor) prozor.setProgressBar(-1);
    await dialog.showMessageBox(prozor, {
      type: "warning",
      message: "Izvoz nije uspio.",
      detail: String((greska && /** @type {any} */ (greska).message) || greska),
    });
  } finally {
    izvozTece = false;
  }

  if (ponovi) await izvozUDatoteku(zbirka, true, popis);
}

/** Oznaka za „svi vlastiti popisi”. Popisi sami nose oznake `lista-…`, pa se ne sudaraju. */
const SVI_POPISI = "sve";

/** Ključ pod kojim stranica drži vlastite popise; isti kao u `src/Glazba.jsx`. */
const KLJUC_LISTE = "lucijanka.glazba.liste";

/**
 * Vlastiti popisi, onakvi kakve stranica sada ima.
 *
 * Stoje u `localStorage` stranice, a ne na disku uz zbirku, pa ih se pita
 * prozor. Popisi koje je Lucify nekad sam složio iz mapa (`lista-mapa-…`)
 * stranica pri otvaranju izbaci, pa se ne nude ni ovdje.
 *
 * @returns {Promise<{ id: string, naslov: string, pjesme: string[] }[]>}
 */
async function procitajListe() {
  if (!prozor) return [];
  try {
    const niz = await prozor.webContents.executeJavaScript(
      "localStorage.getItem(" + JSON.stringify(KLJUC_LISTE) + ")",
    );
    const liste = JSON.parse(niz || "[]");
    if (!Array.isArray(liste)) return [];
    return liste.filter(
      (l) =>
        l &&
        typeof l.id === "string" &&
        !l.id.startsWith("lista-mapa-") &&
        typeof l.naslov === "string" &&
        Array.isArray(l.pjesme),
    );
  } catch {
    return [];
  }
}

/** Naslov popisa kao dio imena datoteke: bez znakova koje Windows u imenu ne pušta. @param {string} naslov */
function cistoIme(naslov) {
  return naslov.replace(/[<>:"/\\|?* -]/g, "").trim();
}

/** Mapa zbirke ovoga pokretanja, da se jelovnik može složiti iznova. */
let zbirkaSada = "";

/**
 * Jelovnik iznova, s popisima kakvi su sada. Popisi nastaju i nestaju dok je
 * Lucify otvoren, a jelovnik je složen jednom, pa se osvježava prije svakoga
 * otvaranja tipkom i kad se prozor vrati u prvi plan.
 */
async function osvjeziJelovnik() {
  if (zbirkaSada) slozJelovnik(zbirkaSada, await procitajListe());
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
  osvjeziJelovnik()
    .catch(() => {
      /* stari jelovnik je bolji nego nikakav */
    })
    .then(() => {
      if (jelovnik && prozor) jelovnik.popup({ window: prozor });
    });
}

/**
 * Jelovnik. Mapa zbirke mora se dati otvoriti i promijeniti, jer je inače
 * zakopana u korisnikovoj mapi i nema joj druge vrate.
 *
 * Pamti se, a ne samo postavlja, jer isti onaj koji stoji pod Altom mora moći
 * iskočiti i pod tipkom u traci.
 *
 * @param {string} zbirka
 * @param {{ id: string, naslov: string, pjesme: string[] }[]} [liste] vlastiti popisi, za izvoz po popisu
 */
function slozJelovnik(zbirka, liste = []) {
  /* `&` je u jelovniku na Windowsima znak za prečac, pa se udvostruči. */
  const oznaka = (/** @type {string} */ naslov) => naslov.replace(/&/g, "&&");
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
          label: "Izvoz za mobitel",
          submenu: [
            /* Prvo ono što se radi svaki tjedan, pa ono što se radi jednom po
               uređaju, pa tek onda izvoz za tuđe svirače. */
            {
              label: "U jednu datoteku, samo novo…",
              click: () => izvozUDatoteku(zbirka),
            },
            {
              label: "U jednu datoteku, cijela zbirka…",
              click: () => izvozUDatoteku(zbirka, true),
            },
            { type: "separator" },
            {
              label: "Popisi",
              submenu: liste.length
                ? [
                    {
                      label: "Svi popisi, samo novo…",
                      click: () => izvozUDatoteku(zbirka, false, SVI_POPISI),
                    },
                    {
                      label: "Svi popisi, sve pjesme…",
                      click: () => izvozUDatoteku(zbirka, true, SVI_POPISI),
                    },
                    { type: "separator" },
                    ...liste.map((l) => ({
                      label: oznaka(l.naslov) + " (" + l.pjesme.length + ")…",
                      click: () => izvozUDatoteku(zbirka, false, l.id),
                    })),
                  ]
                : [{ label: "Još nema vlastitih popisa", enabled: false }],
            },
            { type: "separator" },
            {
              label: "U mapu, za tuđi svirač…",
              click: () => izvozZaMobitel(zbirka),
            },
          ],
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
