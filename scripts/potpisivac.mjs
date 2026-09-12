/**
 * Alat za potpisivanje, raspakiran onako kako Windows dopušta.
 *
 * Graditelj prije pakiranja dohvaća `winCodeSign`, u kojem su `signtool` i
 * `rcedit`, i raspakirava ga sa `7za x -snld`. Ta zastavica traži da
 * simboličke veze ostanu veze, a u arhivi ih ima dvije, obje za macOS
 * (`libcrypto.dylib`, `libssl.dylib`). Za pravljenje veze na Windowsima treba
 * pravo koje običan račun nema, osim uz „Developer Mode”, pa 7za izađe s
 * greškom, graditelj to shvati kao neuspjeh i pokuša iznova — četiri puta, pa
 * odustane. Svaki pokušaj iznova preuzme istih pet i pol megabajta i za sobom
 * ostavi mapu do pola raspakiranu.
 *
 * Lijek je raspakirati istu arhivu **bez** `-snld`: tada 7za veze zapiše kao
 * obične datoteke, što je ovdje posve svejedno, jer su za macOS, a gradi se za
 * Windows. Graditelj poslije nađe gotovu mapu i ne dira ništa.
 *
 * Isto stoji i u `scripts/pokreni.ps1`, za računalo na kojem Lucifyja još
 * nema. Ovo je za ono na kojem se Lucify gradi svaki dan.
 *
 * Ništa se ne radi ako je mapa već ondje, pa je pokretanje uz svaki `pakiraj`
 * besplatno.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* Inačicu bira graditelj, a ne mi: uz `electron-builder` 25 ide 2.6.0. Ako
   je jednom promijeni, ovo se neće poklopiti, pa će raspakiravanje ostati
   graditelju — dakle isto što je bilo i prije ove datoteke, ni gore. */
const INACICA = "2.6.0";
const IZVOR =
  "https://github.com/electron-userland/electron-builder-binaries/releases/download/" +
  "winCodeSign-" + INACICA + "/winCodeSign-" + INACICA + ".7z";

const korijen = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Mapa u kojoj graditelj drži dohvaćene alate. */
function mapaSpremista() {
  const lokalno = process.env.LOCALAPPDATA;
  if (!lokalno) return null;
  return join(lokalno, "electron-builder", "Cache", "winCodeSign");
}

/**
 * Po ovome se zna da je mapa cijela, a ne do pola raspakirana: `signtool` je
 * ono po što se ovamo i dolazi.
 *
 * @param {string} mapa
 */
function jeCijela(mapa) {
  return existsSync(join(mapa, "windows-10", "x64", "signtool.exe"));
}

/** @param {string} spremiste */
function pospremiOstatke(spremiste) {
  /* Svaki neuspjeli pokušaj ostavi mapu i arhivu pod slučajnim brojem. Same
     od sebe ne odu nikad, a znaju narasti na nekoliko desetaka megabajta. */
  let maknuto = 0;
  for (const ime of readdirSync(spremiste)) {
    if (!/^\d+(\.7z)?$/.test(ime)) continue;
    rmSync(join(spremiste, ime), { recursive: true, force: true });
    maknuto += 1;
  }
  if (maknuto) console.log("Pospremljeno ostataka: " + maknuto);
}

async function glavni() {
  if (process.platform !== "win32") return;

  const spremiste = mapaSpremista();
  if (!spremiste) {
    console.log("Nema LOCALAPPDATA, pa se ništa ne priprema.");
    return;
  }

  const cilj = join(spremiste, "winCodeSign-" + INACICA);
  if (jeCijela(cilj)) {
    console.log("winCodeSign već stoji raspakiran.");
    pospremiOstatke(spremiste);
    return;
  }

  const za = join(korijen, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  if (!existsSync(za)) {
    console.log("Nema 7za, pa raspakiravanje ostaje graditelju.");
    return;
  }

  mkdirSync(spremiste, { recursive: true });
  const arhiva = join(spremiste, "winCodeSign-" + INACICA + ".7z");

  if (!existsSync(arhiva)) {
    console.log("Dohvaćam " + IZVOR);
    const odgovor = await fetch(IZVOR, { redirect: "follow" });
    if (!odgovor.ok) {
      console.log("Nije uspjelo (HTTP " + odgovor.status + "), pa ostaje graditelju.");
      return;
    }
    writeFileSync(arhiva, Buffer.from(await odgovor.arrayBuffer()));
  }

  /* Mapa do pola raspakirana gora je od nikakve, pa se prije prolaza briše. */
  rmSync(cilj, { recursive: true, force: true });

  console.log("Raspakiravam bez -snld…");
  try {
    execFileSync(za, ["x", "-bd", "-y", arhiva, "-o" + cilj], { stdio: "ignore" });
  } catch {
    /* Dvije greške o `.dylib` vezama očekivane su i ovdje; zato se ne gleda
       izlazni kod nego je li mapa nastala. */
  }

  if (jeCijela(cilj)) {
    console.log("winCodeSign je spreman: " + cilj);
    rmSync(arhiva, { force: true });
  } else {
    console.log("Nije uspjelo; raspakiravanje ostaje graditelju.");
    rmSync(cilj, { recursive: true, force: true });
  }
  pospremiOstatke(spremiste);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await glavni();
}
