/**
 * Slaže zbirku za Lucify.
 *
 *   node scripts/glazba.mjs                    ponovno pročita `Glazba/Zvuk/`
 *   node scripts/glazba.mjs --uvezi "<mapa>"   prije toga preseli nove snimke iz mape
 *
 * Ovdje je ostala samo **selidba**, dakle premještanje preuzetih snimaka u
 * zbirku. Sve ostalo, čitanje snimke i slaganje popisa, stoji u
 * `glazba-zbirka.mjs`, jer isti posao radi i preuzimač u Lucifyju, koji u
 * zbirku dodaje jednu po jednu pjesmu.
 *
 * Snimke stoje u `Glazba/Zvuk/`, a ta je mapa u `.gitignore`, jer je glazba
 * tuđe autorsko djelo i osobna je. Namjerno **nije** u `public/`: Vite sve
 * odande prepisuje u `dist/`, pa bi svaki build uzalud kopirao 600 MB. Umjesto
 * toga ih na razvojnom poslužitelju poslužuje mali dodatak u `vite.config.js`,
 * pod adresom `/glazba/`.
 *
 * Ime datoteke je oznaka YouTube snimke (`ETxmCCsMoD0.mp3`), a ne naslov, jer u
 * naslovima ima emojija, japanskoga i ćirilice, a takvo ime mora preživjeti i
 * Windows, i URL, i poslužitelj. Pravi naslov živi u popisu.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { procitaj, putovi, slug, slozi } from "./glazba-zbirka.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { zbirka, omoti } = putovi(root);

/* ---------- selidba ---------- */

/**
 * Preseli mp3 datoteke iz zadane mape u zbirku. Prvo se kopira, pa se provjeri
 * da je kopija iste veličine, i tek onda se izvornik briše. Ako je snimka već
 * u zbirci, izvornik se svejedno miče, jer je posao obavljen.
 *
 * @param {string} izvor
 * @returns {{ preseljeno: number, preskoceno: number, greske: string[] }}
 */
function uvezi(izvor) {
  const greske = [];
  let preseljeno = 0;
  let preskoceno = 0;
  const ulaz = readdirSync(izvor).filter((f) => /\.mp3$/i.test(f));
  for (const ime of ulaz) {
    const staro = join(izvor, ime);
    try {
      const podatci = procitaj(staro);
      const kad = statSync(staro).mtime;
      const novoIme = (podatci.yt || slug(podatci.izvorniNaslov) || slug(ime)) + ".mp3";
      const novo = join(zbirka, novoIme);
      if (existsSync(novo) && statSync(novo).size === podatci.bajtova) {
        unlinkSync(staro);
        preskoceno++;
        continue;
      }
      copyFileSync(staro, novo);
      if (statSync(novo).size !== podatci.bajtova) {
        greske.push(ime + ": kopija nije iste veličine, izvornik ostaje");
        continue;
      }
      /* Kopija dobiva današnji datum, a u popisu treba stajati dan preuzimanja,
         jer se po njemu slaže „Nedavno dodano”. */
      utimesSync(novo, kad, kad);
      unlinkSync(staro);
      preseljeno++;
    } catch (e) {
      greske.push(ime + ": " + (e && e.message ? e.message : String(e)));
    }
  }
  return { preseljeno, preskoceno, greske };
}

/* ---------- glavni posao ---------- */

const argumenti = process.argv.slice(2);
const uvozIz = (() => {
  const i = argumenti.indexOf("--uvezi");
  return i !== -1 ? argumenti[i + 1] : "";
})();
const bezOmota = argumenti.includes("--bez-omota");

if (!existsSync(zbirka)) mkdirSync(zbirka, { recursive: true });
if (!existsSync(omoti)) mkdirSync(omoti, { recursive: true });

if (uvozIz) {
  if (!existsSync(uvozIz)) {
    console.error("Mape nema: " + uvozIz);
    process.exit(1);
  }
  const r = uvezi(uvozIz);
  console.log("Uvoz: preseljeno " + r.preseljeno + ", već bilo " + r.preskoceno);
  r.greske.forEach((g) => console.log("  ⚠ " + g));
}

const { popis, greske, sOmotom, sYt } = await slozi(root, { bezOmota });
greske.forEach((g) => console.log("  ⚠ " + g));
if (!bezOmota) console.log("Omoti: " + sOmotom + " od " + sYt);

const ukupno = popis.pjesme.reduce((s, p) => s + p.trajanje, 0);
console.log(
  "Popis: " +
    popis.pjesme.length +
    " pjesama, " +
    Math.floor(ukupno / 3600) +
    " h " +
    Math.round((ukupno % 3600) / 60) +
    " min, " +
    popis.police.length +
    " polica",
);
const bezTrajanja = popis.pjesme.filter((p) => !p.trajanje).length;
if (bezTrajanja) console.log("  ⚠ bez trajanja: " + bezTrajanja);
