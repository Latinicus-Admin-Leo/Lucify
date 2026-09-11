/**
 * Alati koji dolaze s namjenskom aplikacijom.
 *
 * ffmpeg stiže kroz `npm install`, jer za njega postoji paket
 * (`ffmpeg-static`). Za yt-dlp takva paketa nema, a bez njega „Dodaj pjesmu”
 * ne radi: preuzimač ga traži redom po `YTDLP_PATH`, mapi `alati/`, putanji i
 * Pythonu, pa na tuđem računalu, gdje yt-dlp nije instaliran, ne nađe ništa.
 *
 * Zato ga ova naredba dohvaća u `alati/`, odakle ga graditelj spakira uz
 * program. Sam program nije u gitu: tuđi je i mijenja se svaki tjedan, pa mu
 * je mjesto uz build, a ne u povijesti Lucifyja. Tko gradi, dohvati ga sam —
 * `npm run pakiraj` to radi prije svega ostaloga.
 *
 * Pokreće se i ručno:
 *
 *   npm run alati              dohvati ako ga nema
 *   npm run alati -- --osvjezi dohvati iznova, pa i ako već stoji
 */

import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const korijen = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapa = join(korijen, "alati");

/* Ime se razlikuje po sustavu, a adresa je uvijek „zadnje izdanje”: yt-dlp
   izlazi često, a stariji zna prestati raditi kad YouTube nešto promijeni. */
const IMENA = {
  win32: "yt-dlp.exe",
  darwin: "yt-dlp_macos",
  linux: "yt-dlp_linux",
};

const ime = IMENA[process.platform] || "yt-dlp";
/* Na sustavu koji nije u popisu uzima se obična inačica: ona je Python
   skripta i traži Python, ali je bolja od ničega. */
const dalekoIme = IMENA[process.platform] ? ime : "yt-dlp";
const izvor = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + dalekoIme;

const cilj = join(mapa, ime);
const osvjezi = process.argv.slice(2).includes("--osvjezi");

if (existsSync(cilj) && !osvjezi) {
  const mb = (statSync(cilj).size / 1e6).toFixed(1);
  console.log("yt-dlp već stoji: alati/" + ime + " (" + mb + " MB)");
  console.log("Za noviji: npm run alati -- --osvjezi");
  process.exit(0);
}

mkdirSync(mapa, { recursive: true });

console.log("Dohvaćam " + izvor);
const odgovor = await fetch(izvor, { redirect: "follow" });
if (!odgovor.ok) {
  console.error("Nije uspjelo: HTTP " + odgovor.status + " " + odgovor.statusText);
  process.exit(1);
}

/* Piše se pokraj pa se preimenuje, da prekinuto preuzimanje ne ostavi
   krnji program na mjestu s kojega se poslije pokreće. */
const uz = cilj + ".dio";
writeFileSync(uz, Buffer.from(await odgovor.arrayBuffer()));
if (existsSync(cilj)) rmSync(cilj);
renameSync(uz, cilj);
if (process.platform !== "win32") chmodSync(cilj, 0o755);

const mb = (statSync(cilj).size / 1e6).toFixed(1);

/* Provjera da je doista stigao program, a ne stranica s greškom: takva bi
   datoteka imala pravu veličinu i pravo ime, a pukla bi tek pri prvom
   preuzimanju pjesme, daleko od mjesta na kojem je nastala. */
let inacica = "";
try {
  inacica = String(execFileSync(cilj, ["--version"], { encoding: "utf8" })).trim();
} catch (e) {
  console.error("Preuzeto, ali se ne pokreće: " + (e && e.message ? e.message : String(e)));
  process.exit(1);
}

console.log("yt-dlp " + inacica + " u alati/" + ime + " (" + mb + " MB)");
