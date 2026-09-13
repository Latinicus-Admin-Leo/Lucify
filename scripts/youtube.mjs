/**
 * Poveznica i omot za snimke koje nisu došle s YouTubea.
 *
 *   npm run youtube                             zbirka iz projekta
 *   npm run youtube -- --zbirka "<mapa>"        zbirka namjenske aplikacije
 *   npm run youtube -- --probaj                 samo ispiše što bi upisao
 *
 * Pjesma koja je u zbirku ušla kao datoteka, iz mape s računala, nema u sebi
 * adrese snimke. Zato u popisu ondje piše „Datoteka”, nema omota, i nema je u
 * „Poveznicama”. Ovdje joj se snimka traži na samom YouTubeu.
 *
 * Traži se po izvođaču i naslovu, a odlučuje **po trajanju**: ista pjesma u
 * drugoj izvedbi, uživo ili prepjevana, gotovo nikad nema isto trajanje, pa je
 * razlika od nekoliko sekunda najbolji znak da je to ista snimka. Uz trajanje
 * moraju se poklopiti i riječi naslova, inače se ne upisuje ništa: bolje
 * „Datoteka” nego pogrešna pjesma.
 *
 * Snimka se pritom **ne preuzima**. Upisuju se samo oznaka snimke u popis i
 * sličica u `omoti/`, dakle nekoliko desetaka kilobajta po pjesmi.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { omot, putovi, stari, zapisi, zapisiPoveznice } from "./glazba-zbirka.mjs";
import { nadiYtDlp, pokreni } from "./preuzimac-alati.mjs";

const projekt = join(dirname(fileURLToPath(import.meta.url)), "..");

const argumenti = process.argv.slice(2);
const zadano = (/** @type {string} */ ime) => {
  const i = argumenti.indexOf(ime);
  return i !== -1 ? argumenti[i + 1] : "";
};
const korijen = resolve(zadano("--zbirka") || process.env.LUCIFY_ZBIRKA || projekt);
const samoProbaj = argumenti.includes("--probaj");

/** Koliko se traženja vrti odjednom. Više od toga YouTube ionako uspori. */
const ODJEDNOM = 4;
/** Koliko se rezultata gleda po pjesmi. */
const REZULTATA = 10;

/* Izvođači koji to nisu: mapa iz koje je pjesma došla tako je zvala ono što
   nije znala imenovati. Traži se tada samo po naslovu. */
const NE_IZVODAC = new Set(["strano", "nepoznat izvodac", "razno", "various artists"]);

/* Riječi koje kazuju da je snimka nešto drugo od izvornika. Kažnjavaju se samo
   ako ih u našem naslovu nema: „Lepa protina kći (uživo)” smije biti uživo.

   Tuđa izvedba ne dolazi u obzir ni uz savršeno trajanje, jer to više nije ta
   pjesma; snimka uživo istih izvođača smije, ali tek kad bolje nema. */
const TUDJE = [
  "cover",
  "karaoke",
  "remix",
  "instrumental",
  "sped",
  "slowed",
  "reverb",
  "nightcore",
  "8d",
  "tutorial",
  "lesson",
  "reaction",
  "bass boosted",
  "1 hour",
  "10 hours",
  "mashup",
];
const UZIVO = ["live", "uzivo", "koncert", "concert", "acoustic", "akusticno"];

/**
 * Riječi bez kvačica i velikih slova. „Đ” postaje „dj”, a ne „d”, jer tako piše
 * onaj tko kvačica nema: „Djordje Balasevic” na disku, „Đorđe Balašević” na
 * YouTubeu.
 * @param {string} s
 */
function rijeci(s) {
  return String(s || "")
    .replace(/[đĐ]/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((r) => r.length > 1 || /\d/.test(r));
}

/**
 * Koliki dio riječi iz `trazeno` stoji u `nadeno`. Riječ se broji i kad joj u
 * nađenom stoji samo početak ili nastavak, jer isti naslov jedan kanal piše
 * „Ringišpil”, a drugi „Ringispil”.
 * @param {string[]} trazeno @param {Set<string>} nadeno
 */
function pokrivenost(trazeno, nadeno) {
  if (!trazeno.length) return 1;
  let ima = 0;
  for (const r of trazeno) {
    if (nadeno.has(r)) ima += 1;
    else if (r.length >= 4 && [...nadeno].some((n) => n.startsWith(r) || (n.length >= 4 && r.startsWith(n)))) {
      ima += 0.8;
    }
  }
  return ima / trazeno.length;
}

/**
 * Ocjena jednoga rezultata, ili `null` ako ne dolazi u obzir.
 * @param {any} p pjesma iz popisa @param {{ id: string, trajanje: number, kanal: string, naslov: string }} r
 */
function ocijeni(p, r) {
  const razlika = Math.abs(r.trajanje - p.trajanje);
  /* Sedam sekunda, a ne više: već se na dvanaest kao Balaševićeva
     „Poluuspavanka” javila snimka s nečijega vjenčanja. */
  if (!r.trajanje || razlika > 7) return null;

  const nadeno = new Set(rijeci(r.naslov + " " + r.kanal));
  const naslov = pokrivenost(rijeci(p.naslov.replace(/\((?:uzivo|uživo|live)\)/gi, "")), nadeno);
  const izvodac = NE_IZVODAC.has(rijeci(p.izvodac).join(" "))
    ? 1
    : Math.max(...String(p.izvodac).split(",").map((i) => pokrivenost(rijeci(i), nadeno)));

  if (naslov < 0.66 || izvodac < 0.5) return null;
  /* Veće odstupanje trpi se samo uz naslov i izvođača koji se poklapaju do riječi. */
  if (razlika > 5 && (naslov < 1 || izvodac < 1)) return null;

  const nas = new Set(rijeci(p.naslov + " " + p.izvorniNaslov));
  const njihov = " " + rijeci(r.naslov).join(" ") + " ";
  /** @param {string[]} popis */
  const ima = (popis) =>
    popis.filter((d) => !d.split(" ").every((x) => nas.has(x)) && njihov.includes(" " + d + " ")).length;
  if (ima(TUDJE)) return null;
  /* Nadnevak u naslovu („Subotica 01.09.2010”) znači da je netko snimao iz
     publike. */
  if (/\b\d{1,2}\.\s?\d{1,2}\.\s?(?:19|20)\d{2}\b/.test(r.naslov)) return null;

  const zaTrajanje = razlika <= 2 ? 1.2 : razlika <= 4 ? 0.8 : razlika <= 6 ? 0.4 : 0;
  return { ...r, razlika, ocjena: naslov * 2 + izvodac + zaTrajanje - ima(UZIVO) };
}

/** @param {any} alat @param {string} upit */
async function trazi(alat, upit) {
  const { izlaz } = await pokreni({
    cmd: alat.cmd,
    args: [
      ...alat.args,
      "ytsearch" + REZULTATA + ":" + upit,
      "--flat-playlist",
      "--no-warnings",
      /* Bez ovoga yt-dlp na Windowsima piše kodnom stranicom konzole, pa od
         „Nemoj da sudiš” ostane „sudi�”, a riječ se više ne poklopi. */
      "--encoding",
      "utf-8",
      "--print",
      "%(id)s\t%(duration)s\t%(channel)s\t%(title)s",
    ],
  });
  return izlaz
    .split("\n")
    .map((r) => r.split("\t"))
    .filter((d) => d.length >= 4 && /^[A-Za-z0-9_-]{11}$/.test(d[0]))
    .map(([id, trajanje, kanal, ...naslov]) => ({
      id,
      trajanje: Number(trajanje) || 0,
      kanal: kanal === "NA" ? "" : kanal,
      naslov: naslov.join("\t"),
    }));
}

/** @param {any} alat @param {any} p */
async function nadi(alat, p) {
  const izvodac = NE_IZVODAC.has(rijeci(p.izvodac).join(" ")) ? "" : p.izvodac;
  const upiti = [izvodac + " " + p.naslov, p.naslov + " " + izvodac + " audio"];
  for (const upit of upiti) {
    const ocijenjeni = (await trazi(alat, upit.trim()))
      .map((r) => ocijeni(p, r))
      .filter(Boolean)
      .sort((a, b) => b.ocjena - a.ocjena);
    if (ocijenjeni[0] && ocijenjeni[0].ocjena >= 2.2) return ocijenjeni[0];
  }
  return null;
}

/* ---------- glavni posao ---------- */

const { zbirka, omoti, popisPut } = putovi(korijen);
if (!existsSync(popisPut)) {
  console.error("Popisa nema: " + popisPut);
  process.exit(1);
}
const alat = await nadiYtDlp(existsSync(join(korijen, "alati")) ? korijen : projekt);
if (!alat) {
  console.error("Nema yt-dlpa. Pokreni `npm run alati`.");
  process.exit(1);
}

const bez = Object.values(stari(popisPut)).filter((p) => !p.yt && p.trajanje);
console.log("Bez poveznice: " + bez.length + " (" + zbirka + ")");

/** @type {Map<string, any>} */
const nadene = new Map();
let redom = 0;
let gotovo = 0;
await Promise.all(
  Array.from({ length: ODJEDNOM }, async () => {
    while (redom < bez.length) {
      const p = bez[redom++];
      try {
        const r = await nadi(alat, p);
        if (r) nadene.set(p.id, r);
        gotovo += 1;
        console.log(
          (r ? "  ✓ " : "  · ") +
            p.izvodac + " — " + p.naslov + " (" + p.trajanje + " s)" +
            (r ? "  →  " + r.id + "  " + r.naslov + " [" + r.kanal + "] " + r.trajanje + " s" : "") +
            "  " + gotovo + "/" + bez.length,
        );
      } catch (e) {
        gotovo += 1;
        console.log("  ⚠ " + p.naslov + ": " + (e && e.message ? e.message : String(e)));
      }
    }
  }),
);

console.log("Nađeno: " + nadene.size + " od " + bez.length);
if (samoProbaj || !nadene.size) process.exit(0);

mkdirSync(omoti, { recursive: true });
let sOmotom = 0;
for (const r of nadene.values()) if (await omot(omoti, r.id)) sOmotom += 1;

/* Popis se čita iznova tek sada, a ne onaj s početka: traženje traje minutama,
   a Lucify za to vrijeme smije dodati pjesmu. Upisuju se samo dva polja. */
copyFileSync(popisPut, popisPut + ".prije-youtubea");
const svjeze = stari(popisPut);
for (const [id, r] of nadene) {
  const p = svjeze[id];
  if (!p || p.yt) continue;
  p.yt = r.id;
  p.omot = existsSync(join(omoti, r.id + ".jpg")) ? "omoti/" + r.id + ".jpg" : "";
}
const pjesme = Object.values(svjeze);
zapisi(popisPut, pjesme);
zapisiPoveznice(korijen, pjesme);
console.log("Upisano u popis, omota " + sOmotom + ". Stari popis: popis.json.prije-youtubea");
