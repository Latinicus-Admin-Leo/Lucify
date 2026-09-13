/**
 * Zbirka za Lucify: čitanje snimke i slaganje popisa.
 *
 * Ovdje stoji sve što o zbirci znaju **dvoje** pozivatelja:
 *
 *   - `scripts/glazba.mjs`, naredba `npm run glazba`, koja pročita cijelu mapu
 *   - `scripts/preuzimac.mjs`, koji u zbirku dodaje jednu po jednu snimku,
 *     onako kako ih Lucify preuzme
 *
 * Zato nijedna funkcija ovdje ne zna gdje zbirka stoji, nego joj se mapa
 * predaje. Da je putanju računala sama, iz `import.meta.url`, ne bi preživjela
 * put kroz `vite.config.js`: taj se spaja u jednu datoteku prije pokretanja, pa
 * bi ondje `import.meta.url` pokazivao na privremeni spoj, a ne na ovu datoteku.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { odrediJezike } from "../src/glazba-mape.mjs";
import { police, rastavi, ytOznaka } from "../src/glazba-naslovi.mjs";
import { adresaSnimke } from "../src/glazba-veze.mjs";

/* Čišćenje naslova i police stoje u `src/glazba-naslovi.mjs`, jer ih treba i
   Lucify na Androidu. Odavde se i dalje daju uvesti, kao i prije. */
export { police, slug, ytOznaka } from "../src/glazba-naslovi.mjs";

/* ---------- ID3v2, samo ono što nam treba ---------- */

/**
 * Tekstualni okviri iz ID3v2 zaglavlja i mjesto na kojem zaglavlje završava.
 * @param {Buffer} buf
 * @returns {{ t: Record<string, string>, kraj: number }}
 */
function oznake(buf) {
  /** @type {Record<string, string>} */
  const t = {};
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return { t, kraj: 0 };
  /* Veličina je zapisana u sedam bitova po bajtu, da se u njoj ne pojavi 0xFF. */
  const velicina =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  let p = 10;
  while (p + 10 <= velicina + 10 && p + 10 <= buf.length) {
    const id = buf.toString("latin1", p, p + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const n = buf.readUInt32BE(p + 4);
    if (n <= 0 || p + 10 + n > buf.length) break;
    const tijelo = buf.subarray(p + 10, p + 10 + n);
    const enc = tijelo[0];
    let v;
    if (enc === 1 || enc === 2) v = tijelo.subarray(1).toString("utf16le").replace(/^﻿/, "");
    else if (enc === 3) v = tijelo.subarray(1).toString("utf8");
    else v = tijelo.subarray(1).toString("latin1");
    t[id] = v.replace(/\0+$/, "").trim();
    p += 10 + n;
  }
  return { t, kraj: velicina + 10 };
}

const BRZINE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const FREKVENCIJE = [44100, 48000, 32000, 0];

/**
 * Trajanje u sekundama. Traži se Xing ili Info zaglavlje u prvom okviru, jer
 * ono nosi točan broj okvira, pa računa i za promjenljivu brzinu. Ako ga nema,
 * ostaje procjena po brzini, a to je za stalnu brzinu točno.
 *
 * @param {Buffer} buf
 * @param {number} od mjesto na kojem završava ID3 zaglavlje
 * @returns {number}
 */
function trajanje(buf, od) {
  const doKle = Math.min(od + 400000, buf.length - 4);
  for (let i = od; i < doKle; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const verzija = (buf[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const sloj = (buf[i + 1] >> 1) & 3; // 1 = Layer III
    if (verzija === 1 || sloj !== 1) continue;
    const bi = (buf[i + 2] >> 4) & 15;
    const fi = (buf[i + 2] >> 2) & 3;
    if (bi === 0 || bi === 15 || fi === 3) continue;
    let sr = FREKVENCIJE[fi];
    if (verzija === 2) sr /= 2;
    else if (verzija === 0) sr /= 4;
    const mono = ((buf[i + 3] >> 6) & 3) === 3;
    const pomak = verzija === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const glava = buf.toString("latin1", i + 4 + pomak, i + 8 + pomak);
    if (glava === "Xing" || glava === "Info") {
      const zastavice = buf.readUInt32BE(i + 8 + pomak);
      if (zastavice & 1) {
        const okvira = buf.readUInt32BE(i + 12 + pomak);
        const uzoraka = verzija === 3 ? 1152 : 576;
        return Math.round((okvira * uzoraka) / sr);
      }
    }
    const kbps = BRZINE[bi];
    return kbps ? Math.round(((buf.length - od) * 8) / (kbps * 1000)) : 0;
  }
  return 0;
}

/* ---------- popis ---------- */

/**
 * Pročita jednu snimku. Vraća null ako to nije mp3 koji umijemo pročitati.
 * @param {string} put
 */
export function procitaj(put) {
  const buf = readFileSync(put);
  const { t, kraj } = oznake(buf);
  const yt = ytOznaka(t.TXXX || t.WXXX || t.COMM || "");
  const sirovi = t.TIT2 || put.split(/[\\/]/).pop().replace(/\.mp3$/i, "");
  const { naslov, izvodac } = rastavi(sirovi, t.TPE1 || "");
  return {
    yt,
    naslov,
    izvodac: izvodac || "Nepoznat izvođač",
    izvorniNaslov: sirovi,
    trajanje: trajanje(buf, kraj),
    bajtova: buf.length,
  };
}

/* ---------- omoti ---------- */

/**
 * Sličica s YouTubea, spremljena jednom pa se više ne dohvaća. Bez nje
 * Lucify crta prijelaz boja iz imena, pa neuspjeh nije kvar.
 *
 * @param {string} omoti mapa u koju se sprema
 * @param {string} yt
 * @returns {Promise<boolean>}
 */
export async function omot(omoti, yt) {
  const put = join(omoti, yt + ".jpg");
  if (existsSync(put) && statSync(put).size > 1000) return true;
  for (const vrsta of ["maxresdefault", "hqdefault", "mqdefault"]) {
    try {
      const odgovor = await fetch("https://i.ytimg.com/vi/" + yt + "/" + vrsta + ".jpg");
      if (!odgovor.ok) continue;
      const bajtovi = Buffer.from(await odgovor.arrayBuffer());
      if (bajtovi.length < 1000) continue;
      writeFileSync(put, bajtovi);
      return true;
    } catch {
      /* bez mreže se jednostavno ostaje bez omota */
    }
  }
  return false;
}

/* ---------- popis ---------- */

/**
 * Gdje zbirka stoji. Jedino mjesto na kojem su te tri putanje napisane.
 * @param {string} korijen mapa projekta
 */
export function putovi(korijen) {
  const zbirka = join(korijen, "Glazba", "Zvuk");
  return { zbirka, omoti: join(zbirka, "omoti"), popisPut: join(zbirka, "popis.json") };
}

/**
 * Stari popis, složen po oznaci snimke. Iz njega se prepisuje ono što je
 * čovjek dopisao (`razdoblje`, `biljeska`), da se ne izgubi.
 *
 * @param {string} popisPut
 * @returns {Record<string, any>}
 */
export function stari(popisPut) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!existsSync(popisPut)) return out;
  try {
    const prije = JSON.parse(readFileSync(popisPut, "utf8"));
    for (const p of prije.pjesme || []) out[p.id] = p;
  } catch {
    /* pokvaren popis se jednostavno piše iznova */
  }
  return out;
}

/**
 * Jedan zapis pjesme, onakav kakav stoji u popisu. Baca ako se datoteka ne da
 * pročitati, pa svaki pozivatelj sam odlučuje što s tim.
 *
 * @param {string} zbirka
 * @param {string} ime datoteka, npr. `ETxmCCsMoD0.mp3`
 * @param {any} [prije] isti zapis iz staroga popisa, ako ga ima
 */
export function unos(zbirka, ime, prije) {
  const put = join(zbirka, ime);
  const podatci = procitaj(put);
  const p = prije || {};
  return {
    id: ime.replace(/\.mp3$/i, ""),
    /* Naslov i izvođač ispravljeni rukom pobjeđuju ono što piše u datoteci. U
       njoj stoji naslov s YouTubea, u kojem je izvođač često ime kanala koje je
       snimku preneslo, a ne onaj tko ju je napravio. Bez ovoga bi svako novo
       čitanje zbirke vratilo staro ime, pa bi se ispravak tiho izgubio. */
    naslov: p.ispravljeno ? p.naslov : podatci.naslov,
    izvodac: p.ispravljeno ? p.izvodac : podatci.izvodac,
    ...(p.ispravljeno ? { ispravljeno: true } : {}),
    datoteka: ime,
    trajanje: podatci.trajanje,
    /* Snimka koja nije došla s YouTubea nema adrese u sebi, pa joj je poveznicu
       našao `npm run youtube`, po trajanju. Ta živi samo u popisu, i bez ovoga
       bi je svako čitanje zbirke izgubilo, a s njom i omot. */
    yt: podatci.yt || p.yt || "",
    dodano: statSync(put).mtime.toISOString().slice(0, 10),
    izvorniNaslov: podatci.izvorniNaslov,
    /* Ova dva polja upisuje čovjek, za školske slušne primjere. */
    razdoblje: p.razdoblje || "",
    biljeska: p.biljeska || "",
    /* Iz koje je mape pjesma ušla u zbirku, ako je ušla iz mape. Lucify to
       pokaže uz pjesmu („Iz mape …”), ali od toga više ne slaže popis. Čita se
       iz staroga popisa, a ne iz datoteke: u njoj za to nema mjesta, a svako bi
       novo čitanje zbirke inače izgubilo pripadnost. */
    ...(p.mapa ? { mapa: p.mapa } : {}),
    /* Kojoj od dviju glavnih mapa pjesma pripada. Jednom odlučeno ostaje, pa
       i ono što je čovjek ispravio. */
    ...(p.jezik ? { jezik: p.jezik } : {}),
    omot: "",
  };
}

/**
 * Zapiše popis na disk, s policama i abecednim poretkom.
 * @param {string} popisPut
 * @param {any[]} pjesme
 */
export function zapisi(popisPut, pjesme) {
  odrediJezike(pjesme);
  pjesme.sort((a, b) => a.naslov.localeCompare(b.naslov, "hr"));
  const popis = { gradeno: new Date().toISOString(), pjesme, police: police(pjesme) };
  writeFileSync(popisPut, JSON.stringify(popis, null, 1) + "\n", "utf8");
  return popis;
}

/**
 * Uz popis se zapisuje i `public/poveznice.json`: zbirka svedena na same
 * YouTube adrese, bez ijednog bajta zvuka. Ta datoteka **smije** u git, jer
 * adresa nije snimka, pa preko nje zbirka stigne i na objavljenu stranicu,
 * gdje glazbe nema i neće je biti.
 *
 * Piše se pri svakom slaganju popisa, dakle i kad Lucify preuzme jednu jedinu
 * pjesmu, da popis adresa ne zaostaje za zbirkom.
 *
 * Mape `public/` u namjenskoj aplikaciji nema: ondje zbirka stoji u mapi koju
 * je čovjek odabrao, a projekta nema. Zato se ondje ne zapisuje ništa, da se
 * usred tuđe mape s glazbom ne stvara prazna mapa projekta.
 *
 * @param {string} korijen
 * @param {any[]} pjesme
 * @returns {number} koliko ih je zapisano, ili -1 ako mape `public/` nema
 */
export function zapisiPoveznice(korijen, pjesme) {
  const mapa = join(korijen, "public");
  if (!existsSync(mapa)) return -1;
  const sVezom = pjesme.filter((p) => p.yt);
  const sadrzaj = {
    gradeno: new Date().toISOString(),
    pjesme: sVezom.map((p) => ({
      naslov: p.naslov,
      izvodac: p.izvodac,
      adresa: adresaSnimke(p.yt),
    })),
  };
  writeFileSync(join(mapa, "poveznice.json"), JSON.stringify(sadrzaj, null, 1) + "\n", "utf8");
  return sVezom.length;
}

/**
 * Cijela zbirka iznova: pročita svaku snimku u mapi i složi popis.
 *
 * @param {string} korijen
 * @param {{ bezOmota?: boolean }} [opcije]
 */
export async function slozi(korijen, opcije = {}) {
  const { zbirka, omoti, popisPut } = putovi(korijen);
  const prije = stari(popisPut);
  /** @type {any[]} */
  const pjesme = [];
  /** @type {string[]} */
  const greske = [];

  for (const ime of readdirSync(zbirka).filter((f) => /\.mp3$/i.test(f))) {
    try {
      pjesme.push(unos(zbirka, ime, prije[ime.replace(/\.mp3$/i, "")]));
    } catch (e) {
      greske.push(ime + ": " + (e && e.message ? e.message : String(e)));
    }
  }

  let sOmotom = 0;
  if (!opcije.bezOmota) {
    for (const p of pjesme) {
      if (p.yt && (await omot(omoti, p.yt))) sOmotom++;
    }
  }
  for (const p of pjesme) {
    p.omot = p.yt && existsSync(join(omoti, p.yt + ".jpg")) ? "omoti/" + p.yt + ".jpg" : "";
  }

  const popis = zapisi(popisPut, pjesme);
  const veze = zapisiPoveznice(korijen, pjesme);
  return { popis, greske, sOmotom, sYt: pjesme.filter((p) => p.yt).length, veze };
}

/**
 * Jedna nova snimka u već postojeći popis.
 *
 * Namjerno **ne** čita cijelu mapu: zbirka ima šest stotina megabajta, a
 * trajanje se čita iz same datoteke, pa bi svako dodavanje jedne pjesme
 * značilo ponovno čitanje svih. Ostale pjesme dolaze iz staroga popisa, onakve
 * kakve su bile, a preslaguju se samo poredak i police.
 *
 * @param {string} korijen
 * @param {string} ime datoteka u zbirci
 * @param {string} [yt] oznaka snimke, ako je pozivatelj već zna
 */
export async function dodajUPopis(korijen, ime, yt) {
  const { zbirka, omoti, popisPut } = putovi(korijen);
  const prije = stari(popisPut);
  const id = ime.replace(/\.mp3$/i, "");
  const nova = unos(zbirka, ime, prije[id]);

  /* Oznaka se inače čita iz komentara u samoj datoteci. Preuzimač je zna
     unaprijed, pa je predaje: bez nje ne bi bilo ni omota. */
  if (!nova.yt && yt) nova.yt = yt;

  if (nova.yt) await omot(omoti, nova.yt);
  nova.omot = nova.yt && existsSync(join(omoti, nova.yt + ".jpg")) ? "omoti/" + nova.yt + ".jpg" : "";

  const pjesme = Object.values(prije).filter((p) => p.id !== id);
  pjesme.push(nova);
  zapisi(popisPut, pjesme);
  /* I popis adresa, da nova pjesma odmah stigne i na objavljenu stranicu. */
  zapisiPoveznice(korijen, pjesme);
  return nova;
}

/**
 * Pjesma van iz zbirke: iz popisa, a snimka i s diska.
 *
 * Postoji zbog mjesta, a ne zbog reda. Zbirka zna narasti na gigabajte, a
 * računalo ili mobitel nemaju ih uvijek, pa pjesma koja se više ne sluša mora
 * moći otići skroz, a ne samo iz pogleda. Natrag se vraća samo ponovnim
 * dodavanjem poveznice, kao i svaka nova.
 *
 * Omot ide s njom, osim ako ga dijeli s drugom pjesmom iste snimke.
 *
 * @param {string} korijen
 * @param {string} id
 * @returns {any | null} uklonjena pjesma, ili null ako je u popisu nema
 */
export function ukloniIzPopisa(korijen, id) {
  const { zbirka, popisPut } = putovi(korijen);
  const prije = stari(popisPut);
  const pjesma = prije[id];
  if (!pjesma) return null;
  const ostale = Object.values(prije).filter((p) => p.id !== id);

  /* `basename`, a ne ime kakvo piše u popisu: popis je datoteka na disku, pa
     ime u njemu ne smije moći izaći iz mape zbirke. */
  const snimka = join(zbirka, basename(String(pjesma.datoteka || "")));
  if (pjesma.datoteka && existsSync(snimka)) rmSync(snimka, { force: true });
  if (pjesma.omot && !ostale.some((p) => p.omot === pjesma.omot)) {
    rmSync(join(zbirka, "omoti", basename(String(pjesma.omot))), { force: true });
  }

  zapisi(popisPut, ostale);
  zapisiPoveznice(korijen, ostale);
  return pjesma;
}
