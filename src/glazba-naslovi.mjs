/**
 * Naslovi s YouTubea: čišćenje, izvođač iz naslova, police po izvođaču.
 *
 * Stoji u `src/`, a ne uz `scripts/glazba-zbirka.mjs`, jer istu stvar rade
 * dvoje: poslužitelj, kad pjesmu upisuje u popis, i Lucify na Androidu, koji
 * pjesmu preuzme i upiše sam, bez poslužitelja. Kao i `glazba-mape.mjs`, ova
 * datoteka zato ne smije ništa ni od Nodea ni od preglednika.
 */

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
export function rastavi(naslov, izvodac) {
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

/* ---------- oznake ---------- */

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

/* ---------- police ---------- */

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
