/**
 * Čitanje arhive koju je složio izvoz za mobitel.
 *
 * Zašto ovdje, a ne paketom s npm-a: arhiva iz izvoza je bez stiskanja
 * (`store`), pa svaka snimka u njoj leži kao neprekinut niz bajtova, na svojem
 * mjestu. Za takvu se ne treba raspakiravati ništa — dosta je `Blob.slice()`,
 * koji ne prepisuje bajtove nego samo kaže gdje počinju i gdje završavaju. Šest
 * stotina megabajta tako prođe kroz uvoz bez ijednoga prepisivanja i bez
 * ijednoga megabajta u pameti.
 *
 * Stisnute stavke (`deflate`) svejedno prolaze, kroz `DecompressionStream`, jer
 * arhiva ne mora doći iz Lucifyja: čovjek smije sam zapakirati mapu, a Windows
 * i Android tada stišću. Tada se bajtovi prepisuju, ali to je njegov izbor.
 *
 * Vraćaju se `File` objekti, isti kakvi dođu iz odabira datoteka, pa uvoz
 * poslije ne zna i ne mora znati je li mapa došla iz arhive ili iz Datoteka.
 */

/** Veličine polja i potpisi, onako kako ih zip propisuje. */
const KRAJ = 0x06054b50;
const POPIS = 0x02014b50;
const STAVKA = 0x04034b50;
/** Najveći mogući komentar na kraju arhive, plus samo zaglavlje. */
const NAJDALJE = 0xffff + 22;

/** @param {Blob} dio */
async function bajtovi(dio) {
  return new DataView(await dio.arrayBuffer());
}

/**
 * Nađi zaglavlje na kraju arhive. Traži se od kraja, jer iza njega smije
 * stajati komentar, pa mu mjesto nije unaprijed poznato.
 *
 * @param {Blob} datoteka
 */
async function nadiKraj(datoteka) {
  const koliko = Math.min(datoteka.size, NAJDALJE);
  const od = datoteka.size - koliko;
  const d = await bajtovi(datoteka.slice(od));
  for (let i = koliko - 22; i >= 0; i -= 1) {
    if (d.getUint32(i, true) === KRAJ) {
      const stavki = d.getUint16(i + 10, true);
      const velicinaPopisa = d.getUint32(i + 12, true);
      const pocetakPopisa = d.getUint32(i + 16, true);
      if (stavki === 0xffff || pocetakPopisa === 0xffffffff) {
        throw new Error("Arhiva je u zip64 obliku, koji Lucify ne čita.");
      }
      return { stavki, velicinaPopisa, pocetakPopisa };
    }
  }
  throw new Error(
    "Ovo nije zip arhiva, ili je prijenos ostao nedovršen: kraj arhive se ne nalazi.",
  );
}

/**
 * Raspakiraj arhivu u popis datoteka.
 *
 * @param {File | Blob} datoteka
 * @returns {Promise<File[]>}
 */
export async function raspakiraj(datoteka) {
  const { stavki, velicinaPopisa, pocetakPopisa } = await nadiKraj(datoteka);
  const popis = await bajtovi(datoteka.slice(pocetakPopisa, pocetakPopisa + velicinaPopisa));
  const imena = new TextDecoder("utf-8");

  /** @type {{ ime: string, nacin: number, velicina: number, pomak: number }[]} */
  const stavke = [];
  let p = 0;
  for (let i = 0; i < stavki; i += 1) {
    if (p + 46 > popis.byteLength || popis.getUint32(p, true) !== POPIS) {
      throw new Error("Popis u arhivi je pokvaren, stavka " + (i + 1) + ".");
    }
    const nacin = popis.getUint16(p + 10, true);
    const velicina = popis.getUint32(p + 20, true);
    const duzinaImena = popis.getUint16(p + 28, true);
    const duzinaDodatka = popis.getUint16(p + 30, true);
    const duzinaBiljeske = popis.getUint16(p + 32, true);
    const pomak = popis.getUint32(p + 42, true);
    /* Zip propisuje kosu crtu, ali Windowsov „Compress-Archive” piše obratnu,
       pa se izjednačuje ovdje: uvoz podmapu odbacuje traženjem zadnje kose
       crte, i tuđa arhiva bi mu inače omote sakrila pod „omoti\ime.jpg”. */
    const ime = imena
      .decode(new Uint8Array(popis.buffer, popis.byteOffset + p + 46, duzinaImena))
      .replace(/\\/g, "/");
    p += 46 + duzinaImena + duzinaDodatka + duzinaBiljeske;
    /* Mape su u arhivi stavke bez sadržaja, s kosom crtom na kraju imena. */
    if (ime.endsWith("/")) continue;
    stavke.push({ ime, nacin, velicina, pomak });
  }

  /** @type {File[]} */
  const van = [];
  for (const s of stavke) {
    /* Ime i dodatak znaju se razlikovati od onih u popisu, pa se mjesto
       podataka mora pročitati iz same stavke, a ne izračunati iz popisa. */
    const zaglavlje = await bajtovi(datoteka.slice(s.pomak, s.pomak + 30));
    if (zaglavlje.byteLength < 30 || zaglavlje.getUint32(0, true) !== STAVKA) {
      throw new Error("Stavka „" + s.ime + "” ne stoji ondje gdje popis kaže.");
    }
    const pocetak =
      s.pomak + 30 + zaglavlje.getUint16(26, true) + zaglavlje.getUint16(28, true);
    if (pocetak + s.velicina > datoteka.size) {
      throw new Error(
        "Arhiva je nepotpuna: „" + s.ime + "” prelazi njezin kraj.\n" +
          "Prijenos na uređaj je vjerojatno stao na pola, pa datoteku prenesi iznova.",
      );
    }

    const dio = datoteka.slice(pocetak, pocetak + s.velicina);
    if (s.nacin === 0) {
      van.push(new File([dio], s.ime));
      continue;
    }
    if (s.nacin === 8) {
      const odstisnuto = dio.stream().pipeThrough(new DecompressionStream("deflate-raw"));
      van.push(new File([await new Response(odstisnuto).blob()], s.ime));
      continue;
    }
    throw new Error(
      "Stavka „" + s.ime + "” stisnuta je načinom koji Lucify ne čita (" + s.nacin + ").",
    );
  }

  return van;
}

/** Je li ovo arhiva, koliko se dade znati prije otvaranja. */
export const jeArhiva = (/** @type {File} */ f) =>
  /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
