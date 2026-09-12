/**
 * Odakle zbirka dolazi.
 *
 * Lucify živi na tri mjesta i zbirka mu na svako stiže drukčije. Na
 * `npm run dev` i u namjenskoj aplikaciji iza njega stoji poslužitelj, pa
 * snimka dolazi s adrese `/glazba/`, kao i dosad. Na objavljenoj stranici
 * poslužitelja nema, pa snimka dolazi iz **samoga uređaja**, iz IndexedDB, gdje
 * ju je ostavio uvoz.
 *
 * Ta se razlika drži ovdje, na jednome mjestu, a ne po sviraču i prikazu.
 * Svirač pita „koja je adresa ove pjesme”, dobije nisku i s njome radi isto što
 * je radio i prije; je li to putanja na poslužitelju ili `blob:` iz baze, njega
 * se ne tiče.
 */

export const KORIJEN = import.meta.env.BASE_URL || "/";

/**
 * Gdje god ima poslužitelja koji zna preuzeti pjesmu, ima i poslužitelja koji
 * je zna poslužiti; gdje ga nema, nema ni jednoga ni drugoga. Zato je ovo ista
 * provjera kao `PREUZIMAC` u `Glazba.jsx`, samo okrenuta, i zato je ondje
 * izvedena odavde, a ne napisana drugi put.
 */
export const NA_UREDAJU = !(import.meta.env.DEV || import.meta.env.MODE === "namjenska");

/**
 * Spremište se uvozi tek kad zatreba, i samo ondje gdje se doista koristi.
 * Uvjet je doslovna vrijednost u buildu, pa u namjenskoj aplikaciji cijela ova
 * grana, a s njom i `glazba-spremiste.mjs`, ispadne iz izlaza.
 */
/** @type {Promise<typeof import("./glazba-spremiste.mjs")> | null} */
let ucitano = null;
function spremiste() {
  if (!ucitano) ucitano = import("./glazba-spremiste.mjs");
  return ucitano;
}

/* ---------- snimke ---------- */

/**
 * Adresa s koje se pjesma pušta.
 *
 * Na uređaju se za svako puštanje stvara nova `blob:` adresa, jer stara vrijedi
 * dok se ne poništi, a poništava je svirač čim prijeđe na sljedeću: držati sto
 * pedeset otvorenih značilo bi držati i sto pedeset snimaka.
 *
 * @param {any} p
 * @returns {Promise<string>}
 */
export async function zvukAdresa(p) {
  if (!p) return "";
  if (!NA_UREDAJU) return KORIJEN + "glazba/" + p.datoteka;
  const { zvukZa } = await spremiste();
  const snimka = await zvukZa(p.id);
  return snimka ? URL.createObjectURL(snimka) : "";
}

/** Poništi adresu s koje se više ne svira. @param {string} adresa */
export function pustiAdresu(adresa) {
  if (adresa && adresa.slice(0, 5) === "blob:") {
    try {
      URL.revokeObjectURL(adresa);
    } catch {
      /* već je otišla */
    }
  }
}

/* ---------- omoti ---------- */

/**
 * Omoti se, za razliku od snimaka, drže otvoreni cijelo vrijeme: svaki redak
 * popisa crta svoj, pa bi ih se inače tražilo pri svakom prikazu, a prikaz mora
 * moći nacrtati odmah, bez čekanja.
 *
 * @type {Map<string, string>}
 */
const omoti = new Map();

/**
 * Otvori sve omote s uređaja. Zove se jednom, pošto popis stigne, a prije nego
 * što se preda prikazu, da prvi prikaz već ima što nacrtati.
 */
export async function pripremiOmote() {
  if (!NA_UREDAJU) return;
  zatvoriOmote();
  const { sviOmoti } = await spremiste();
  for (const [ime, slika] of await sviOmoti()) omoti.set(ime, URL.createObjectURL(slika));
}

/** Poslije novoga uvoza stare adrese više ne vrijede. */
export function zatvoriOmote() {
  for (const a of omoti.values()) pustiAdresu(a);
  omoti.clear();
}

/**
 * Adresa omota, onakva kakva ide u `<img src>`. Namjerno je **bez čekanja**:
 * prikaz je već ima spremnu, jer su omoti otvoreni prije njega.
 *
 * @param {string} [ime] ime kakvo stoji u popisu, `omoti/ETxmCCsMoD0.jpg`
 */
export function omotAdresa(ime) {
  if (!ime) return "";
  return NA_UREDAJU ? omoti.get(ime) || "" : KORIJEN + "glazba/" + ime;
}

/* ---------- popis ---------- */

/**
 * Popis sveden na ono što je doista na uređaju.
 *
 * Na iPhoneu se mapa ne bira odjednom nego datoteka po datoteka, pa uvoz zna
 * ostati nedovršen. Pjesma koje nema ne smije stajati u popisu: pritisnula bi
 * se i ne bi se dogodilo ništa. Zato ispadaju i one, i njihova mjesta na
 * policama, a polica koja time ostane prazna ispada cijela.
 *
 * @param {any} popis
 */
export async function samoDostupno(popis) {
  if (!NA_UREDAJU || !popis) return popis;
  const { oznakeSnimaka } = await spremiste();
  const ima = await oznakeSnimaka();
  const pjesme = (popis.pjesme || []).filter((/** @type {any} */ p) => ima.has(p.id));
  const police = (popis.police || [])
    .map((/** @type {any} */ p) => ({
      ...p,
      pjesme: (p.pjesme || []).filter((/** @type {string} */ id) => ima.has(id)),
    }))
    .filter((/** @type {any} */ p) => p.pjesme.length);
  return { ...popis, pjesme, police };
}

/**
 * Cijela zbirka ovoga uređaja, spremna za prikaz. Ondje gdje ima poslužitelja
 * vraća `null`, jer je popis tada obična datoteka koju Lucify dohvati sam.
 *
 * @returns {Promise<any>}
 */
export async function zbirkaUredaja() {
  if (!NA_UREDAJU) return null;
  const { dajPopis } = await spremiste();
  const popis = await dajPopis();
  if (!popis) return { pjesme: [], police: [] };
  await pripremiOmote();
  return await samoDostupno(popis);
}
