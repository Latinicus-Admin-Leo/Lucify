/**
 * Alati koji dolaze s namjenskom aplikacijom.
 *
 * ffmpeg stiže kroz `npm install`, jer za njega postoji paket
 * (`ffmpeg-static`). Za yt-dlp takva paketa nema, a bez njega „Dodaj pjesmu”
 * ne radi: preuzimač ga traži redom po `YTDLP_PATH`, mapi `alati/`, putanji i
 * Pythonu, pa na tuđem računalu, gdje yt-dlp nije instaliran, ne nađe ništa.
 *
 * Zato ga ova datoteka dohvaća, i to na dva mjesta:
 *
 * - **pri gradnji**, kao `npm run alati`, u `alati/` uz projekt, odakle ga
 *   graditelj spakira uz program;
 * - **iz samoga Lucifyja**, kroz `dohvatiYtDlp()`, u `alati/` unutar mape
 *   zbirke, kad YouTube promijeni svirač pa zapakirani primjerak zastari.
 *
 * Drugo je razlog zašto je posao ovdje izvađen u funkciju. Zapakirani yt-dlp
 * stoji u `Program Files`, kamo se ne piše, pa se osvježeni mora spustiti
 * pokraj zbirke, u korisnikovu mapu. Ondje ga onda nađe i preuzimač.
 *
 * Sam program nije u gitu: tuđi je i mijenja se svaki tjedan, pa mu je mjesto
 * uz build, a ne u povijesti Lucifyja.
 *
 *   npm run alati              dohvati ako ga nema
 *   npm run alati -- --osvjezi dohvati iznova, pa i ako već stoji
 */

import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

/* Ime se razlikuje po sustavu, a adresa je uvijek „zadnje izdanje”: yt-dlp
   izlazi često, a stariji zna prestati raditi kad YouTube nešto promijeni. */
const IMENA = {
  win32: "yt-dlp.exe",
  darwin: "yt-dlp_macos",
  linux: "yt-dlp_linux",
};

/** Ime programa na ovom sustavu. */
export function imeYtDlpa() {
  return IMENA[process.platform] || "yt-dlp";
}

/**
 * Dohvati yt-dlp u zadanu mapu.
 *
 * @param {object} opcije
 * @param {string} opcije.mapa mapa `alati/` u koju program ide
 * @param {boolean} [opcije.osvjezi] dohvati i ako već stoji
 * @param {(r: string) => void} [opcije.javi] kamo idu poruke o tijeku
 * @returns {Promise<{ put: string, inacica: string, mb: string, preskoceno: boolean }>}
 */
export async function dohvatiYtDlp({ mapa, osvjezi = false, javi = () => {} }) {
  const ime = imeYtDlpa();
  /* Na sustavu koji nije u popisu uzima se obična inačica: ona je Python
     skripta i traži Python, ali je bolja od ničega. */
  const dalekoIme = IMENA[process.platform] ? ime : "yt-dlp";
  const izvor = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + dalekoIme;
  const cilj = join(mapa, ime);

  if (existsSync(cilj) && !osvjezi) {
    return { put: cilj, inacica: procitajInacicu(cilj), mb: megabajti(cilj), preskoceno: true };
  }

  mkdirSync(mapa, { recursive: true });
  javi("Dohvaćam " + izvor);

  const odgovor = await fetch(izvor, { redirect: "follow" });
  if (!odgovor.ok) {
    throw new Error("Nije uspjelo: HTTP " + odgovor.status + " " + odgovor.statusText);
  }

  /* Piše se pokraj pa se preimenuje, da prekinuto preuzimanje ne ostavi
     krnji program na mjestu s kojega se poslije pokreće. Kod osvježavanja to
     čuva i onaj koji već radi: dok novi ne stigne cijel, stari ostaje. */
  const uz = cilj + ".dio";
  writeFileSync(uz, Buffer.from(await odgovor.arrayBuffer()));
  if (existsSync(cilj)) rmSync(cilj);
  renameSync(uz, cilj);
  if (process.platform !== "win32") chmodSync(cilj, 0o755);

  /* Provjera da je doista stigao program, a ne stranica s greškom: takva bi
     datoteka imala pravu veličinu i pravo ime, a pukla bi tek pri prvom
     preuzimanju pjesme, daleko od mjesta na kojem je nastala. */
  const inacica = procitajInacicu(cilj);
  if (!inacica) throw new Error("Preuzeto, ali se ne pokreće.");

  return { put: cilj, inacica, mb: megabajti(cilj), preskoceno: false };
}

/** @param {string} put */
function procitajInacicu(put) {
  try {
    return String(execFileSync(put, ["--version"], { encoding: "utf8" })).trim();
  } catch {
    return "";
  }
}

/** @param {string} put */
function megabajti(put) {
  return (statSync(put).size / 1e6).toFixed(1);
}

/* ------------------------------------------------------------------ redak */

/* Samo kad se datoteka pokrene kao naredba, a ne kad je Lucify uveze. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const korijen = join(dirname(fileURLToPath(import.meta.url)), "..");
  const mapa = join(korijen, "alati");
  const osvjezi = process.argv.slice(2).includes("--osvjezi");

  try {
    const ishod = await dohvatiYtDlp({ mapa, osvjezi, javi: (r) => console.log(r) });
    if (ishod.preskoceno) {
      console.log("yt-dlp već stoji: alati/" + imeYtDlpa() + " (" + ishod.mb + " MB)");
      console.log("Za noviji: npm run alati -- --osvjezi");
    } else {
      console.log("yt-dlp " + ishod.inacica + " u alati/" + imeYtDlpa() + " (" + ishod.mb + " MB)");
    }
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }
}
