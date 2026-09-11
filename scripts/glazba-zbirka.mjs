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

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/* ---------- čišćenje naslova ---------- */

/** Zagrade koje su ostale od YouTubea, a ne kazuju ništa o pjesmi. */
const SUVISNO =
  /[([]\s*(?:[^()[\]]*\b(?:official|オフィシャル|lyric|lyrics|audio|video|visuali[sz]er|mv|hd|hq|4k|full\s*version|music\s*video|performance\s*video|artwork\s*video|colou?r\s*coded)\b[^()[\]]*)\s*[)\]]/gi;

/** Iste riječi, ali za dio naslova koji nije u zagradama. */
const SUVISAN_REP = /\b(?:official|lyrics?|audio|visuali[sz]er|music\s*video|colou?r\s*coded)\b/i;
/** Riječi od kojih se sastoji čist otpad, kao „Official Lyric Video”. */
const OTPAD =
  /\b(?:official|lyrics?|audio|video|visuali[sz]er|music|mv|hd|hq|4k|full|version|the|performance|artwork|soundtrack)\b/gi;

/**
 * Je li taj odsječak sav od YouTubeovih riječi, dakle nema u njemu ničega o
 * pjesmi. „Official Lyric Video” jest, „'Nxde'” nije.
 * @param {string} dio
 */
function samoOtpad(dio) {
  if (!SUVISAN_REP.test(dio)) return false;
  return dio.replace(OTPAD, "").replace(/[^\p{L}\p{N}]+/gu, "").length === 0;
}

/**
 * Naslov bez onoga što je YouTube dopisao. Otpad dolazi u četiri oblika, pa
 * ide u četiri koraka: u zagradama („(Official Video)”), kao odsječak iza
 * uspravne crte („| Official Music Video | Eurovision 2024”), kao odsječak
 * među crticama („- Official Music Video -”) i kao gol rep na kraju
 * („'Nxde' Official Music Video”).
 *
 * Reže se samo odsječak koji je **sav** otpad. Prije je uzorak gutao i ono
 * ispred njega, pa je od „'Nxde' Official Music Video” ostajalo ime sastava
 * bez imena pjesme.
 *
 * @param {string} s
 */
function ocisti(s) {
  let n = s.replace(SUVISNO, " ");

  /* Iza prve suvišne uspravne crte obično slijedi samo još otpada, pa se reže
     sve od nje. Ako je već prvi odsječak otpad, zapis se ne dira, jer bi
     ostao prazan. */
  const crte = n.split("|");
  if (crte.length > 1) {
    const prvi = crte.findIndex((d) => SUVISAN_REP.test(d));
    if (prvi > 0) n = crte.slice(0, prvi).join(" | ");
  }

  /* Gol rep na kraju, bez ijedne crtice ispred sebe. */
  n = n.replace(/\s*\bofficial\b[\p{L}\p{N}\s]{0,24}?\b(?:video|audio|visuali[sz]er|mv)\b\s*$/iu, "");

  /* Crtica s razmacima s obje strane dijeli naslov, a crtica bez njih ne, jer
     bi inače „Toy-Box” bio dva odsječka. */
  const dijelovi = n.split(/\s+[-–—]\s+/);
  if (dijelovi.length > 1) {
    const ostaje = dijelovi.filter((d, i) => i === 0 || !samoOtpad(d));
    if (ostaje.length !== dijelovi.length) n = ostaje.join(" - ");
  }

  return n
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[\s\-–—|:,]+$/, "")
    .trim();
}

/**
 * Riječi iz imena kanala, bez kvačica i bez razmaka, kao skup. Služi za
 * usporedbu, jer isti izvođač na YouTubeu piše ime na tri načina.
 * @param {string} s
 */
function rijeci(s) {
  return new Set(
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/** Nastavci kojima kanal kaže da je službeni, a ne dio imena. @param {string} s */
function bezNastavka(s) {
  return s
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s*\b(?:VEVO|Official(?:\s+(?:Channel|Music|Video|Band))?|Music|Records)\b\s*$/i, "")
    .trim();
}

/**
 * Izvođač i naslov iz jednoga zapisa. Naslov s YouTubea gotovo uvijek već
 * sadrži ime izvođača („ABBA - Money, Money, Money”), pa se ono makne, da u
 * popisu ne stoji dvaput.
 *
 * Usporedba je namjerno labava, po skupu riječi, jer isti izvođač u naslovu i
 * u imenu kanala rijetko stoji istim slovima: „Rammstein” prema „Rammstein
 * Official”, a „米津玄師 Kenshi Yonezu” prema „Kenshi Yonezu 米津玄師”.
 *
 * @param {string} naslov
 * @param {string} izvodac
 */
function rastavi(naslov, izvodac) {
  const i = ocisti(bezNastavka(izvodac));
  let n = ocisti(naslov);
  const cijeli = rijeci(izvodac);
  const kratki = rijeci(i);
  /* Prazan skup ne vrijedi ništa, inače bi svaki naslov ostao bez glave. */
  const pokriva = (a, b) => a.size > 0 && [...a].every((r) => b.has(r));
  /**
   * Je li taj komad naslova zapravo ime izvođača. Traži se pokrivenost u oba
   * smjera, dakle da komad ne kaže ni više ni manje od imena kanala. Samo
   * jedan smjer nije dosta: „Toy” je podskup od „Toy-Box”, pa je od
   * „Toy-Box - 007” ostajalo „Box - 007”.
   * @param {string} dio
   */
  const jeIzvodac = (dio) => {
    const d = rijeci(dio);
    return pokriva(d, cijeli) && pokriva(kratki, d);
  };

  /* Ime izvođača stoji ili na početku („ABBA - Money, Money, Money”)
     ili na kraju („Catchit - S3RL”). Miče se s obje strane.

     Kušaju se sva mjesta rastavljanja, a ne samo prvo, jer i samo ime zna
     imati crticu: kod „Toy-Box - 007” prva je crtica ona u imenu, pa bi se na
     njoj stalo i naslov bi ostao „Box - 007”. */
  /** Mjesta na kojima se naslov smije rastaviti. @param {string} t */
  const mjesta = (t) => {
    /** @type {number[]} */
    const out = [];
    const trazi = /[-–—:|]/g;
    let m;
    while ((m = trazi.exec(t)) !== null) out.push(m.index);
    return out;
  };

  for (const k of mjesta(n)) {
    const lijevo = n.slice(0, k).trim();
    const desno = n.slice(k + 1).trim();
    if (desno.length > 1 && jeIzvodac(lijevo)) {
      n = ocisti(desno);
      break;
    }
  }
  /* Popis se traži iznova, jer je prethodni korak možda skratio naslov. */
  const straga = mjesta(n);
  for (let k = straga.length - 1; k >= 0; k--) {
    const lijevo = n.slice(0, straga[k]).trim();
    const desno = n.slice(straga[k] + 1).trim();
    if (lijevo.length > 1 && desno.length > 0 && jeIzvodac(desno)) {
      n = ocisti(lijevo);
      break;
    }
  }

  return { naslov: n || ocisti(naslov) || naslov, izvodac: i || izvodac.trim() };
}

/* ---------- popis ---------- */

/** @param {string} s */
export function slug(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Oznaka YouTube snimke iz komentara koji ostavlja preuzimač. @param {string} s */
export function ytOznaka(s) {
  const m = String(s || "").match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

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
    yt: podatci.yt,
    dodano: statSync(put).mtime.toISOString().slice(0, 10),
    izvorniNaslov: podatci.izvorniNaslov,
    /* Ova dva polja upisuje čovjek, za školske slušne primjere. */
    razdoblje: p.razdoblje || "",
    biljeska: p.biljeska || "",
    omot: "",
  };
}

/**
 * Izvođač s barem tri pjesme dobiva svoju policu, kao album. Ostali stanu u
 * „Sve pjesme”, jer polica s jednom pjesmom nije polica.
 *
 * @param {any[]} pjesme
 */
export function police(pjesme) {
  /** @type {Map<string, any[]>} */
  const poIzvodacu = new Map();
  for (const p of pjesme) {
    /* Grupira se po prvom izvođaču, a ne po cijelom potpisu. U potpisu stoje i
       gosti, pa bi „Disko Warp” i „Disko Warp, Kick, Punch” bile dvije police
       od kojih nijedna nema dovoljno pjesama, iako je izvođač isti. */
    const glavni = p.izvodac.split(",")[0].trim();
    if (!poIzvodacu.has(glavni)) poIzvodacu.set(glavni, []);
    poIzvodacu.get(glavni).push(p);
  }
  return [...poIzvodacu.entries()]
    .filter(([ime, lista]) => lista.length >= 3 && ime !== "Nepoznat izvođač")
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "hr"))
    .map(([ime, lista]) => ({
      id: "izvodac-" + slug(ime),
      naslov: ime,
      vrsta: "izvodac",
      pjesme: lista.map((p) => p.id),
    }));
}

/**
 * Zapiše popis na disk, s policama i abecednim poretkom.
 * @param {string} popisPut
 * @param {any[]} pjesme
 */
export function zapisi(popisPut, pjesme) {
  pjesme.sort((a, b) => a.naslov.localeCompare(b.naslov, "hr"));
  const popis = { gradeno: new Date().toISOString(), pjesme, police: police(pjesme) };
  writeFileSync(popisPut, JSON.stringify(popis, null, 1) + "\n", "utf8");
  return popis;
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
  return { popis, greske, sOmotom, sYt: pjesme.filter((p) => p.yt).length };
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
  return nova;
}
