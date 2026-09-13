/**
 * Tri koraka jednoga preuzimanja: pročitaj podatke, dohvati zvuk, pretvori u mp3.
 *
 * Ovdje je jedino mjesto u mapi koje zna da yt-dlp i ffmpeg uopće postoje. Tko
 * ih ikad zamijeni, mijenja ovu datoteku i nijednu drugu.
 *
 * Preuzeti zvuk se **ne dira** dok ne dođe do ffmpega: yt-dlp ga samo spremi
 * onakav kakav jest, jer je pretvorba posao ffmpega, a jedan alat po jednom
 * poslu lakše je popraviti kad se pokvari.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { procitajGresku } from "../src/glazba-greske.mjs";
import { Greska, nadiFfmpeg, nadiYtDlp, pokreni } from "./preuzimac-alati.mjs";

/**
 * Kakvoća zvuka. `args` idu ravno ffmpegu, a Lucify šalje samo oznaku, pa
 * ništa iz preglednika ne može doći do njegove naredbe.
 *
 * Promjenljiva brzina (`-q:a`) daje manju datoteku za isti dojam. Zapis od 320
 * kbps ima stalnu brzinu, jer se pod „320” to i podrazumijeva.
 *
 * Vrijedi znati: ono što YouTube daje već je izgubilo dio zvuka, obično kao
 * Opus oko 130 kbps. Ponovna pretvorba to ne vraća, pa veća kakvoća kupuje
 * veličinu, a ne vjernost. Zato je „Visoka” zadana.
 */
export const KAKVOCE = {
  mala: { id: "mala", ime: "Manja", opis: "oko 115 kbps", args: ["-q:a", "6"] },
  srednja: { id: "srednja", ime: "Srednja", opis: "oko 165 kbps", args: ["-q:a", "4"] },
  visoka: { id: "visoka", ime: "Visoka", opis: "oko 190 kbps", args: ["-q:a", "2"] },
  najveca: { id: "najveca", ime: "Najveća", opis: "320 kbps", args: ["-b:a", "320k"] },
};

export const ZADANA_KAKVOCA = "visoka";

/** @param {string} id */
export function kakvoca(id) {
  return KAKVOCE[id] || null;
}

/* ---------- yt-dlp ---------- */

/** @param {string} korijen */
async function ytDlp(korijen) {
  const nadeno = await nadiYtDlp(korijen);
  if (!nadeno) {
    throw new Greska(
      "NEMA_YTDLP",
      "yt-dlp nije instaliran.",
      "Instaliraj ga s: python -m pip install --upgrade yt-dlp",
    );
  }
  return nadeno;
}

/**
 * Podatci o snimci, bez ijednog preuzetog bajta. Odavde dolazi naslov.
 *
 * @param {string} korijen @param {string} adresa
 * @param {{ znak?: AbortSignal }} [opcije]
 */
export async function podatci(korijen, adresa, opcije = {}) {
  const alat = await ytDlp(korijen);
  const args = [
    ...alat.args,
    "--dump-single-json",
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--skip-download",
    adresa,
  ];

  let izlaz;
  try {
    ({ izlaz } = await pokreni({ cmd: alat.cmd, args }, { znak: opcije.znak }));
  } catch (e) {
    throw prevedi(e, "Ne mogu pročitati ovu snimku.");
  }

  let o;
  try {
    o = JSON.parse(izlaz.trim());
  } catch {
    throw new Greska("NEČITLJIVO", "yt-dlp je vratio nešto nečitljivo.");
  }

  if (o.is_live) throw new Greska("UŽIVO", "Ovo se prenosi uživo, pa nema kraja za pretvoriti.");
  if (o.live_status === "is_upcoming") throw new Greska("NAJAVA", "Ova snimka još nije objavljena.");

  return {
    oznaka: o.id || null,
    naslov: o.title || null,
    kanal: o.uploader || o.channel || null,
    trajanje: Number.isFinite(o.duration) ? o.duration : null,
    adresa: o.webpage_url || adresa,
  };
}

/**
 * Dohvati najbolji zvučni zapis, onakav kakav jest. Ovdje se ništa ne pretvara.
 *
 * @param {string} korijen @param {string} adresa
 * @param {{ mapa: string, naNapredak?: (p: number) => void, znak?: AbortSignal }} opcije
 * @returns {Promise<string>} putanja do preuzete datoteke
 */
export async function zvuk(korijen, adresa, opcije) {
  const alat = await ytDlp(korijen);
  const args = [
    ...alat.args,
    "--no-playlist",
    "--no-part",
    "--no-mtime",
    "--newline",
    "--no-warnings",
    "--format",
    "bestaudio/best",
    "--progress-template",
    "download:NAPREDAK %(progress._percent_str)s",
    "--output",
    join(opcije.mapa, "izvor.%(ext)s"),
    adresa,
  ];

  /** @param {string} r */
  const napredak = (r) => {
    const m = /^NAPREDAK\s+([\d.]+)%/.exec(r.trim());
    if (m && opcije.naNapredak) opcije.naNapredak(Math.min(100, Number(m[1])));
  };

  try {
    await pokreni(
      { cmd: alat.cmd, args },
      { znak: opcije.znak, kupiIzlaz: false, naIzlaz: napredak, naGresku: napredak },
    );
  } catch (e) {
    throw prevedi(e, "Preuzimanje nije uspjelo.");
  }

  const nadeno = readdirSync(opcije.mapa).find((i) => i.startsWith("izvor."));
  if (!nadeno) throw new Greska("BEZ_DATOTEKE", "Preuzimanje je završilo, a datoteke nema.");
  return join(opcije.mapa, nadeno);
}

/* ---------- ffmpeg ---------- */

/**
 * Pretvori bilo koji zvučni zapis u mp3, s oznakama koje Lucify poslije
 * čita iz same datoteke.
 *
 * Komentar nosi adresu snimke i to **nije ukras**: iz njega `glazba-zbirka.mjs`
 * čita oznaku YouTube snimke, a po njoj se dohvaća omot.
 *
 * @param {string} korijen
 * @param {{ ulaz: string, izlaz: string, trajanje?: number | null, kakvoca?: string,
 *           oznake?: { title?: string, artist?: string, comment?: string },
 *           naNapredak?: (p: number) => void, znak?: AbortSignal }} opcije
 */
export async function uMp3(korijen, opcije) {
  const alat = await nadiFfmpeg(korijen);
  if (!alat) {
    throw new Greska(
      "NEMA_FFMPEGA",
      "ffmpeg nije instaliran.",
      "Pokreni `npm install`, koji dovuče ffmpeg-static, ili stavi ffmpeg na putanju.",
    );
  }

  const izbor = kakvoca(opcije.kakvoca || ZADANA_KAKVOCA);
  if (!izbor) throw new Greska("KAKVOĆA", "Takve kakvoće nema među ponuđenima.");

  const args = [
    ...alat.args,
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    opcije.ulaz,
    "-vn" /* omot van, ostaje samo zvuk */,
    "-c:a",
    "libmp3lame",
    ...izbor.args,
    "-id3v2_version",
    "3" /* inačica koju čita i Windows */,
    "-write_id3v1",
    "1",
  ];

  for (const [kljuc, vrijednost] of Object.entries(opcije.oznake || {})) {
    if (vrijednost) args.push("-metadata", kljuc + "=" + vrijednost);
  }

  args.push("-progress", "pipe:1", "-nostats", opcije.izlaz);

  /** @param {string} r */
  const napredak = (r) => {
    if (!opcije.trajanje || !opcije.naNapredak) return;
    /* `out_time_ms` je oduvijek u mikrosekundama, unatoč imenu. */
    const m = /^out_time_(us|ms)=(\d+)/.exec(r.trim());
    if (!m) return;
    const sekundi = Number(m[2]) / 1000000;
    opcije.naNapredak(Math.max(0, Math.min(100, (sekundi / opcije.trajanje) * 100)));
  };

  try {
    await pokreni(
      { cmd: alat.cmd, args },
      { znak: opcije.znak, kupiIzlaz: false, naIzlaz: napredak },
    );
  } catch (e) {
    if (e instanceof Greska && e.oznaka !== "IZLAZ_NIJE_NULA") throw e;
    const rep = (e && /** @type {any} */ (e).rep) || "";
    if (/Unknown encoder .?libmp3lame/i.test(rep)) {
      throw new Greska("NEMA_MP3", "Ovaj ffmpeg nema mp3 pretvarač (libmp3lame).", rep.slice(0, 300));
    }
    if (/Invalid data found|does not contain any stream/i.test(rep)) {
      throw new Greska("LOŠ_ZVUK", "U preuzetoj datoteci nema upotrebljiva zvuka.", rep.slice(0, 300));
    }
    throw new Greska("PRETVORBA", "ffmpeg nije uspio pretvoriti zvuk.", rep.slice(0, 300));
  }

  if (opcije.naNapredak) opcije.naNapredak(100);
}

/* ---------- tuđa poruka u našu ---------- */

/**
 * Od yt-dlpova ispisa napravi jednu rečenicu s kojom se može nešto poduzeti.
 * Sama pravila stoje u `src/glazba-greske.mjs`, jer isti ispis čita i Lucify
 * na Androidu.
 *
 * @param {any} e @param {string} zadano
 */
function prevedi(e, zadano) {
  if (e instanceof Greska && e.oznaka !== "IZLAZ_NIJE_NULA") return e;
  const g = procitajGresku((e && (e.rep || e.detalj)) || "", zadano);
  return new Greska(g.oznaka, g.poruka, g.detalj);
}
