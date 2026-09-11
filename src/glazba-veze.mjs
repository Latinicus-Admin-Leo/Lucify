/**
 * Čitanje YouTube poveznica, i za preglednik i za poslužitelj.
 *
 * Datoteka namjerno ne dira ni DOM ni Node: uvozi je i okvir za dodavanje u
 * Lucifyju, koji broji poveznice dok se tipkaju, i preuzimač u
 * `scripts/preuzimac.mjs`, koji ih prima. Tako se ono što okvir prihvaća i ono
 * što poslužitelj prihvaća ne mogu razići.
 *
 * Poslužitelj svejedno provjerava **iznova**. Provjera u pregledniku je
 * uljudnost, a ne brana.
 */

/** Oznaka snimke uvijek ima jedanaest znakova. */
const OZNAKA = /^[A-Za-z0-9_-]{11}$/;

const DOMENE = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Putanje iza kojih odmah slijedi oznaka snimke. */
const OBLICI = ["/shorts/", "/live/", "/embed/", "/v/"];

/**
 * Puna adresa snimke iz njezine oznake.
 *
 * Stoji na jednom mjestu, jer je traže troje: presuda o zalijepljenoj
 * poveznici, popis poveznica u Lucifyju i `npm run glazba`, koji taj popis
 * zapisuje. Dvije bi se kopije razišle čim YouTube promijeni oblik adrese.
 *
 * @param {string} oznaka
 */
export function adresaSnimke(oznaka) {
  return "https://www.youtube.com/watch?v=" + oznaka;
}

/**
 * Presuda o jednoj poveznici. Zapisana je kao jedan oblik s neobaveznim
 * poljima, a ne kao dva odvojena, jer se ova mapa provjerava bez `strict`, pa
 * TypeScript ondje ne umije suziti oblik po polju `ok`.
 *
 * @typedef {{ ok: boolean, oznaka?: string, adresa?: string, razlog?: string }} Presuda
 */

/**
 * @param {string} oznaka
 * @returns {Presuda}
 */
function prihvati(oznaka) {
  if (!OZNAKA.test(oznaka)) return { ok: false, razlog: "Oznaka snimke u toj poveznici ne valja." };
  return { ok: true, oznaka, adresa: adresaSnimke(oznaka) };
}

/**
 * Jedna poveznica.
 * @param {string} sirovo
 * @returns {Presuda}
 */
export function procitajVezu(sirovo) {
  const tekst = String(sirovo == null ? "" : sirovo).trim();
  if (!tekst) return { ok: false, razlog: "Zalijepi poveznicu s YouTubea." };

  /* Gola oznaka snimke prolazi, jer se ponekad tako i kopira. */
  if (OZNAKA.test(tekst)) return prihvati(tekst);

  let adresa;
  try {
    adresa = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(tekst) ? tekst : "https://" + tekst);
  } catch {
    return { ok: false, razlog: "To nije valjana mrežna adresa." };
  }

  if (adresa.protocol !== "http:" && adresa.protocol !== "https:") {
    return { ok: false, razlog: "Prima se samo http i https." };
  }

  const domena = adresa.hostname.toLowerCase();
  if (!DOMENE.has(domena)) return { ok: false, razlog: "Prima se samo poveznica s YouTubea." };

  if (domena.endsWith("youtu.be")) {
    const o = adresa.pathname.split("/").filter(Boolean)[0];
    return o ? prihvati(o) : { ok: false, razlog: "U toj kratkoj poveznici nema oznake snimke." };
  }

  if (adresa.pathname === "/watch") {
    const o = adresa.searchParams.get("v");
    return o ? prihvati(o) : { ok: false, razlog: "Toj poveznici nedostaje dio `v=`." };
  }

  for (const pocetak of OBLICI) {
    if (adresa.pathname.startsWith(pocetak)) {
      const o = adresa.pathname.slice(pocetak.length).split("/")[0];
      return o ? prihvati(o) : { ok: false, razlog: "U toj poveznici nema oznake snimke." };
    }
  }

  if (adresa.pathname === "/playlist" || adresa.searchParams.has("list")) {
    const o = adresa.searchParams.get("v");
    if (o) return prihvati(o);
    return { ok: false, razlog: "Popisi se ne primaju. Zalijepi jednu snimku." };
  }

  return { ok: false, razlog: "Ta poveznica ne pokazuje na jednu snimku." };
}

/**
 * Cijeli zalijepljeni tekst: jedna poveznica po retku, više njih u istom
 * retku, odvojene zarezom, ili slijepljene bez ijednog razmaka.
 *
 * Svaka zadržava svoju presudu, da okvir može reći koji je redak odbijen i
 * zašto, a ista se snimka dvaput broji jednom.
 *
 * @param {string} sirovo
 */
export function procitajVeze(sirovo) {
  const tekst = String(sirovo == null ? "" : sirovo);

  /* Zalijepljeno „https://a...https://b...” dvije su poveznice, a ne jedna
     pokvarena, pa se ispred svakoga `http` umetne razmak. */
  const razdvojeno = tekst.replace(/(.)(?=https?:\/\/)/gi, "$1 ");

  const komadi = razdvojeno
    .split(/[\s,;]+/)
    .map((k) => k.replace(/^[<("']+/, "").replace(/[>)"'.,]+$/, ""))
    .filter(Boolean);

  /** @type {any[]} */
  const stavke = [];
  /** @type {any[]} */
  const prihvacene = [];
  /** @type {any[]} */
  const greske = [];
  const videne = new Set();
  let ponovljene = 0;

  for (const komad of komadi) {
    const p = procitajVezu(komad);

    if (!p.ok) {
      const s = { upisano: komad, ok: false, razlog: p.razlog };
      stavke.push(s);
      greske.push(s);
      continue;
    }

    if (videne.has(p.oznaka)) {
      ponovljene += 1;
      stavke.push({ upisano: komad, ok: true, ponovljena: true, ...p });
      continue;
    }

    videne.add(p.oznaka);
    const s = { upisano: komad, ok: true, ponovljena: false, ...p };
    stavke.push(s);
    prihvacene.push(s);
  }

  return { stavke, prihvacene, greske, ponovljene };
}
