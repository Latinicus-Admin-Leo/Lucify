/**
 * Zip, onoliko koliko ga izvoz za mobitel treba.
 *
 * Zašto ovo, a ne paket s npm-a: zip koji ovdje nastaje nosi mp3-ove i jpg-ove,
 * a oni su već stisnuti, pa se ne stišću drugi put. Sve što treba je, dakle,
 * arhiva **bez stiskanja** (`store`, metoda 0): datoteka ide u nju bajt po bajt,
 * kakva jest. Za to je dosta sto redaka, a program koji se instalira ostaje bez
 * jedne ovisnosti više.
 *
 * Piše se u tijeku, jedna pjesma za drugom, i nikad se cijela arhiva ne drži u
 * pameti: u njoj je najviše jedna snimka. Zaglavlja se znaju unaprijed, jer se
 * veličina i CRC računaju iz gotove datoteke prije pisanja, pa ne treba onaj
 * dodatak na kraju podataka (`data descriptor`) koji arhive sa strujanjem nose.
 *
 * Imena su UTF-8, i to je upisano u zastavicu (bit 11). Bez toga bi „Тампоны!”
 * i japansko u naslovima izašli nakrivo na svakom raspakiravaču koji ime bez
 * zastavice čita kao CP437.
 *
 * Zip64 ovdje nema: arhiva i svaka datoteka u njoj moraju ostati pod četiri
 * gigabajta, a broj datoteka pod 65535. Izvoz je ionako „samo novo”, pa je to
 * daleko; kad bi se granica ipak dosegnula, bolje je stati s jasnom porukom
 * nego napisati arhivu koju nitko ne može otvoriti.
 */

import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";

/** Koliko zip bez zip64 nosi. */
const NAJVECE = 0xffffffff;
const NAJVISE_DATOTEKA = 0xffff;

/* Tablica za CRC-32, onakav kakav zip traži. Računa se jednom, pri prvom
   pozivu: `zlib.crc32` postoji tek od Nodea 22, a program nosi Electronov
   Node, koji je stariji. */
/** @type {Uint32Array | null} */
let tablica = null;

function dajTablicu() {
  if (tablica) return tablica;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  tablica = t;
  return t;
}

/** @param {Buffer | Uint8Array} podatci */
function crc32(podatci) {
  const t = dajTablicu();
  let c = 0xffffffff;
  for (let i = 0; i < podatci.length; i += 1) c = t[(c ^ podatci[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Vrijeme onako kako ga zip pamti: dva polja iz doba DOS-a, sekunda na dvije
 * i godina od 1980. Prije 1980. se ne da zapisati, pa se takvo podigne.
 *
 * @param {Date} d
 */
function dosVrijeme(d) {
  const g = Math.max(1980, d.getFullYear());
  return {
    vrijeme: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    datum: ((g - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Pisac arhive.
 *
 * @param {string} put kamo se piše
 */
export function zipPisac(put) {
  const tok = createWriteStream(put);
  /** @type {{ ime: Buffer, crc: number, velicina: number, pomak: number, vrijeme: number, datum: number }[]} */
  const stavke = [];
  let pomak = 0;
  /** @type {Error | null} */
  let pukloJe = null;

  tok.on("error", (e) => {
    pukloJe = e;
  });

  /** @param {Buffer} b */
  const piši = (b) =>
    new Promise((uspjelo, palo) => {
      if (pukloJe) return palo(pukloJe);
      /* `write` vrati `false` kad se međuspremnik napunio; čeka se povratni
         poziv, pa se pamćenje ne puni brže nego što disk prima. */
      tok.write(b, (e) => (e ? palo(e) : uspjelo(undefined)));
    });

  return {
    /**
     * Dodaj datoteku u arhivu, pod imenom `ime`.
     *
     * @param {string} ime ime u arhivi, s kosom crtom za podmapu
     * @param {Buffer | Uint8Array} podatci
     * @param {Date} [vrijeme]
     */
    async dodaj(ime, podatci, vrijeme) {
      if (stavke.length >= NAJVISE_DATOTEKA) {
        throw new Error("U arhivu ide najviše " + NAJVISE_DATOTEKA + " datoteka.");
      }
      const imeB = Buffer.from(ime, "utf8");
      const crc = crc32(podatci);
      const { vrijeme: v, datum } = dosVrijeme(vrijeme || new Date());
      if (podatci.length > NAJVECE || pomak + podatci.length > NAJVECE) {
        throw new Error(
          "Arhiva bi prešla četiri gigabajta, koliko zip nosi bez zip64.\n" +
            "Izvezi u mapu umjesto u jednu datoteku.",
        );
      }

      const zaglavlje = Buffer.alloc(30);
      zaglavlje.writeUInt32LE(0x04034b50, 0);
      zaglavlje.writeUInt16LE(20, 4); /* dosta je inačica 2.0 */
      zaglavlje.writeUInt16LE(0x0800, 6); /* imena su UTF-8 */
      zaglavlje.writeUInt16LE(0, 8); /* bez stiskanja */
      zaglavlje.writeUInt16LE(v, 10);
      zaglavlje.writeUInt16LE(datum, 12);
      zaglavlje.writeUInt32LE(crc, 14);
      zaglavlje.writeUInt32LE(podatci.length, 18);
      zaglavlje.writeUInt32LE(podatci.length, 22);
      zaglavlje.writeUInt16LE(imeB.length, 26);
      zaglavlje.writeUInt16LE(0, 28);

      stavke.push({ ime: imeB, crc, velicina: podatci.length, pomak, vrijeme: v, datum });

      await piši(zaglavlje);
      await piši(imeB);
      await piši(Buffer.isBuffer(podatci) ? podatci : Buffer.from(podatci));
      pomak += 30 + imeB.length + podatci.length;
    },

    /**
     * Dodaj datoteku s diska, pod imenom `ime`. Čita se cijela, ali samo jedna
     * u isti čas.
     *
     * @param {string} ime @param {string} odakle @param {Date} [vrijeme]
     */
    async dodajDatoteku(ime, odakle, vrijeme) {
      return this.dodaj(ime, await readFile(odakle), vrijeme);
    },

    /** Popis na kraju arhive, bez kojega arhiva nije arhiva. */
    async gotovo() {
      const pocetakPopisa = pomak;
      for (const s of stavke) {
        const z = Buffer.alloc(46);
        z.writeUInt32LE(0x02014b50, 0);
        z.writeUInt16LE(20, 4); /* tko je pisao */
        z.writeUInt16LE(20, 6); /* tko smije čitati */
        z.writeUInt16LE(0x0800, 8);
        z.writeUInt16LE(0, 10);
        z.writeUInt16LE(s.vrijeme, 12);
        z.writeUInt16LE(s.datum, 14);
        z.writeUInt32LE(s.crc, 16);
        z.writeUInt32LE(s.velicina, 20);
        z.writeUInt32LE(s.velicina, 24);
        z.writeUInt16LE(s.ime.length, 28);
        z.writeUInt16LE(0, 30);
        z.writeUInt16LE(0, 32);
        z.writeUInt16LE(0, 34);
        z.writeUInt16LE(0, 36);
        z.writeUInt32LE(0, 38);
        z.writeUInt32LE(s.pomak, 42);
        await piši(z);
        await piši(s.ime);
        pomak += 46 + s.ime.length;
      }

      const kraj = Buffer.alloc(22);
      kraj.writeUInt32LE(0x06054b50, 0);
      kraj.writeUInt16LE(0, 4);
      kraj.writeUInt16LE(0, 6);
      kraj.writeUInt16LE(stavke.length, 8);
      kraj.writeUInt16LE(stavke.length, 10);
      kraj.writeUInt32LE(pomak - pocetakPopisa, 12);
      kraj.writeUInt32LE(pocetakPopisa, 16);
      kraj.writeUInt16LE(0, 20);
      await piši(kraj);

      await new Promise((uspjelo, palo) => {
        tok.end((/** @type {Error} */ e) => (e ? palo(e) : uspjelo(undefined)));
      });
      if (pukloJe) throw pukloJe;
      return { datoteka: put, stavki: stavke.length, bajtova: pomak + 22 };
    },

    /** Kad izvoz pukne na pola: tok se zatvori, a nedovršena arhiva ostaje na pozivatelju. */
    prekini() {
      tok.destroy();
    },
  };
}
