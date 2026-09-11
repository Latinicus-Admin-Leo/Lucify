/**
 * Vanjski alati preuzimača i pokretanje tuđih programa.
 *
 * Dva alata rade sav posao: **yt-dlp** dohvaća zvuk, a **ffmpeg** ga pretvara u
 * mp3. Nijedan nije knjižnica nego program koji se pokreće, pa ih ovdje treba
 * najprije naći, a onda pokrenuti tako da naslov pjesme ne može postati naredba.
 *
 * Ništa u ovoj datoteci ne računa gdje je mapa projekta, nego joj se ona
 * predaje. Razlog je isti kao u `glazba-zbirka.mjs`: `vite.config.js` se prije
 * pokretanja spoji u jednu datoteku, pa bi ondje `import.meta.url` pokazivao na
 * taj privremeni spoj.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const windows = process.platform === "win32";

/** Greška čija se poruka smije pokazati u Lucifyju, na hrvatskom. */
export class Greska extends Error {
  /** @param {string} oznaka @param {string} poruka @param {string} [detalj] */
  constructor(oznaka, poruka, detalj = "") {
    super(poruka);
    this.name = "Greska";
    this.oznaka = oznaka;
    this.detalj = detalj;
  }
}

/** Sve što nije naša greška ide van bez pojedinosti, da ne izađu putanje. @param {any} e */
export function javna(e) {
  if (e instanceof Greska) return { oznaka: e.oznaka, poruka: e.message, detalj: e.detalj || "" };
  return {
    oznaka: "NEPOZNATO",
    poruka: "Nešto je pošlo po zlu pri obradi ove snimke.",
    detalj: e && e.message ? String(e.message).slice(0, 300) : "",
  };
}

/**
 * Pokrene program i javlja njegov ispis redak po redak.
 *
 * Argumenti se **uvijek** predaju kao polje, uz `shell: false`, pa naslov
 * snimke ili adresa nikad ne mogu postati naredba ljusci.
 *
 * @param {{ cmd: string, args: string[] }} naredba
 * @param {{ naIzlaz?: (r: string) => void, naGresku?: (r: string) => void,
 *           znak?: AbortSignal, kupiIzlaz?: boolean }} [opcije]
 * @returns {Promise<{ izlaz: string, rep: string }>}
 */
export function pokreni(naredba, opcije = {}) {
  const { naIzlaz, naGresku, znak, kupiIzlaz = true } = opcije;

  return new Promise((uspjeh, pad) => {
    if (znak && znak.aborted) {
      pad(new Greska("PREKINUTO", "Prekinuto."));
      return;
    }

    const dijete = spawn(naredba.cmd, naredba.args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let izlaz = "";
    /** @type {string[]} */
    const redci = [];
    let gotovo = false;

    const prekid = () => {
      try {
        dijete.kill("SIGKILL");
      } catch {
        /* već je otišlo */
      }
    };
    if (znak) znak.addEventListener("abort", prekid, { once: true });

    poRetcima(dijete.stdout, (r) => {
      if (kupiIzlaz) izlaz += r + "\n";
      if (naIzlaz) naIzlaz(r);
    });
    poRetcima(dijete.stderr, (r) => {
      redci.push(r);
      if (redci.length > 60) redci.shift();
      if (naGresku) naGresku(r);
    });

    /** @param {(v: any) => void} sto @param {any} cime */
    const kraj = (sto, cime) => {
      if (gotovo) return;
      gotovo = true;
      if (znak) znak.removeEventListener("abort", prekid);
      sto(cime);
    };

    dijete.on("error", (e) => {
      kraj(pad, new Greska("NE_POKREĆE_SE", "Ne mogu pokrenuti " + naredba.cmd + ".", e.message));
    });

    dijete.on("close", (kod, sig) => {
      const rep = redci.join("\n");
      if (znak && znak.aborted) {
        kraj(pad, new Greska("PREKINUTO", "Prekinuto."));
      } else if (kod === 0) {
        kraj(uspjeh, { izlaz, rep });
      } else {
        const e = new Greska(
          "IZLAZ_NIJE_NULA",
          naredba.cmd + " je stao s kodom " + (kod === null ? sig : kod) + ".",
          rep,
        );
        /** @type {any} */ (e).rep = rep;
        kraj(pad, e);
      }
    });
  });
}

/**
 * Dijeli tok na retke. Podnosi i `\r`, kojim yt-dlp ispisuje napredovanje
 * preko istoga retka.
 * @param {any} tok @param {(r: string) => void} naRedak
 */
function poRetcima(tok, naRedak) {
  let ostatak = "";
  tok.setEncoding("utf8");
  tok.on("data", (komad) => {
    ostatak += komad;
    const dijelovi = ostatak.split(/\r\n|\r|\n/);
    ostatak = dijelovi.pop() || "";
    for (const d of dijelovi) naRedak(d);
  });
  tok.on("end", () => {
    if (ostatak.trim()) naRedak(ostatak);
    ostatak = "";
  });
}

/* ---------- traženje alata ---------- */

/** Jednom nađen alat pamti se, jer se traži pokretanjem, a to traje. */
const nadeni = new Map();

export function zaboraviAlate() {
  nadeni.clear();
}

/**
 * Uzme prvoga kandidata koji se odazove na pitanje o inačici.
 *
 * @param {string} kljuc
 * @param {any[]} kandidati
 * @param {string[]} pitanje
 * @param {(s: string) => string | undefined} inacica
 */
async function nadi(kljuc, kandidati, pitanje, inacica) {
  if (nadeni.has(kljuc)) return nadeni.get(kljuc);

  for (const k of kandidati) {
    if (!k) continue;
    if (k.mora && !existsSync(k.mora)) continue;
    try {
      const { izlaz } = await pokreni({ cmd: k.cmd, args: [...(k.args || []), ...pitanje] });
      const nadeno = {
        cmd: k.cmd,
        args: k.args || [],
        inacica: inacica(izlaz) || "nepoznata",
        odakle: k.odakle,
      };
      nadeni.set(kljuc, nadeno);
      return nadeno;
    } catch {
      /* toga nema, ide sljedeći */
    }
  }

  nadeni.set(kljuc, null);
  return null;
}

/**
 * yt-dlp: kao program na putanji ili kao Python modul.
 * @param {string} korijen
 */
export function nadiYtDlp(korijen) {
  const vlastiti = join(korijen, "alati", windows ? "yt-dlp.exe" : "yt-dlp");
  return nadi(
    "yt-dlp",
    [
      process.env.YTDLP_PATH && { cmd: process.env.YTDLP_PATH, odakle: "YTDLP_PATH" },
      { cmd: vlastiti, mora: vlastiti, odakle: "alati/" },
      { cmd: "yt-dlp", odakle: "putanja" },
      { cmd: "python", args: ["-m", "yt_dlp"], odakle: "python -m yt_dlp" },
      { cmd: "python3", args: ["-m", "yt_dlp"], odakle: "python3 -m yt_dlp" },
      windows && { cmd: "py", args: ["-3", "-m", "yt_dlp"], odakle: "py -3 -m yt_dlp" },
    ],
    ["--version"],
    (i) => (i.trim().split("\n").pop() || "").trim(),
  );
}

/**
 * ffmpeg: najprije onaj na putanji, pa onaj koji dođe s `npm install`.
 * @param {string} korijen
 */
export function nadiFfmpeg(korijen) {
  return nadi(
    "ffmpeg",
    [
      process.env.FFMPEG_PATH && { cmd: process.env.FFMPEG_PATH, odakle: "FFMPEG_PATH" },
      { cmd: "ffmpeg", odakle: "putanja" },
      izPaketa(korijen),
    ],
    ["-version"],
    (i) => (i.match(/ffmpeg version (\S+)/) || [])[1],
  );
}

/**
 * Program iz paketa `ffmpeg-static`. Paket je **neobavezan** (`optionalDependencies`),
 * pa se traži oprezno: da se ne da preuzeti, `npm install` svejedno prolazi, a
 * s njim i build na Vercelu, kojemu ffmpeg ionako ne treba.
 *
 * Putanja se računa iz mape projekta, a ne iz `import.meta.url`, jer ova
 * datoteka prolazi kroz `vite.config.js`, koji se prije pokretanja spoji u
 * privremenu datoteku na drugom mjestu.
 *
 * @param {string} korijen
 */
function izPaketa(korijen) {
  try {
    const zatrazi = createRequire(pathToFileURL(join(korijen, "package.json")).href);
    const program = zatrazi("ffmpeg-static");
    if (typeof program === "string" && existsSync(program)) {
      return { cmd: program, mora: program, odakle: "ffmpeg-static" };
    }
  } catch {
    /* paketa nema, i to je u redu */
  }
  const izravno = join(korijen, "node_modules", "ffmpeg-static", windows ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(izravno) ? { cmd: izravno, mora: izravno, odakle: "ffmpeg-static" } : null;
}

/**
 * Jedna provjera koju Lucify pokaže prije nego što se išta preuzme.
 * @param {string} korijen
 */
export async function provjeriAlate(korijen) {
  const [yt, ff] = await Promise.all([nadiYtDlp(korijen), nadiFfmpeg(korijen)]);
  return {
    ytDlp: yt
      ? { ima: true, inacica: yt.inacica, odakle: yt.odakle }
      : { ima: false, savjet: "Instaliraj ga s: python -m pip install --upgrade yt-dlp" },
    ffmpeg: ff
      ? { ima: true, inacica: ff.inacica, odakle: ff.odakle }
      : { ima: false, savjet: "Instaliraj ga s: npm install (dolazi kroz ffmpeg-static)" },
  };
}
