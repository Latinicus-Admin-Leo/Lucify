/**
 * Zbirka na samom uređaju.
 *
 * Objavljeni Lucify nema poslužitelja iza sebe, pa nema ni adrese `/glazba/` s
 * koje bi snimke stigle. Umjesto toga ih **nosi sam uređaj**: jednom se uveze
 * mapa koju je složio `npm run izvezi`, snimke odu u IndexedDB, i odande sviraju
 * i bez mreže i bez upaljenog računala.
 *
 * Zašto IndexedDB, a ne `localStorage`: ondje idu samo niske, i svega nekoliko
 * megabajta. Ovdje stoji šesto megabajta zvuka, a IndexedDB jedini prima `Blob`
 * i jedini ga drži na disku umjesto u pamćenju.
 *
 * Zašto ne `Cache` uz service worker: ondje se sprema **odgovor na zahtjev**, a
 * ovamo ništa ne dolazi mrežom. Snimka dolazi iz čovjekove mape, kroz polje za
 * odabir datoteka, pa nema zahtjeva čiji bi odgovor bila.
 *
 * **Sve je po uređaju.** Mobitel i prijenosnik ne dijele ništa, kao što ni
 * srca i vlastiti popisi u `localStorage` ne putuju. To nije nedostatak nego
 * ono što je traženo: svaki uređaj nosi svoju zbirku, i ne ovisi ni o čemu.
 */

import { odrediJezike } from "./glazba-mape.mjs";
import { police } from "./glazba-naslovi.mjs";
import { jeArhiva, raspakiraj } from "./glazba-zip.mjs";

const BAZA = "lucify.zbirka";
const IZDANJE = 1;

/* Tri skladišta, jer se troje traži u različita vremena: popis odmah pri
   otvaranju, omoti skupno čim popis stigne, a snimka tek kad se pusti. */
const ZVUK = "zvuk";
const OMOTI = "omoti";
const POPIS = "popis";

/** U skladištu `popis` stoji jedan jedini zapis, pod ovim ključem. */
const KLJUC_POPISA = "popis";

/** @type {Promise<IDBDatabase> | null} */
let veza = null;

/** Obećanje od zahtjeva, jer IndexedDB govori događajima, a ostatak Lucifyja ne. */
function zahtjev(/** @type {IDBRequest} */ r) {
  return new Promise((vrati, pukni) => {
    r.onsuccess = () => vrati(r.result);
    r.onerror = () => pukni(r.error);
  });
}

/**
 * Baza se otvara jednom i veza se pamti. Pri prvom otvaranju nastaju sva tri
 * skladišta; kad im se ikad promijeni oblik, diže se `IZDANJE`.
 */
function otvori() {
  if (veza) return veza;
  veza = new Promise((vrati, pukni) => {
    if (typeof indexedDB === "undefined") {
      pukni(new Error("Ovaj preglednik nema IndexedDB."));
      return;
    }
    const r = indexedDB.open(BAZA, IZDANJE);
    r.onupgradeneeded = () => {
      const b = r.result;
      if (!b.objectStoreNames.contains(ZVUK)) b.createObjectStore(ZVUK);
      if (!b.objectStoreNames.contains(OMOTI)) b.createObjectStore(OMOTI);
      if (!b.objectStoreNames.contains(POPIS)) b.createObjectStore(POPIS);
    };
    r.onsuccess = () => vrati(r.result);
    r.onerror = () => pukni(r.error);
    /* Drugi otvoreni Lucify koji traži novije izdanje čeka na ovaj, pa se
       zatvaramo umjesto da ga držimo. */
    r.onblocked = () => pukni(new Error("Lucify je otvoren u još jednoj kartici."));
  });
  return veza;
}

/** @param {string} skladiste @param {IDBTransactionMode} nacin */
async function ured(skladiste, nacin) {
  const b = await otvori();
  return b.transaction(skladiste, nacin).objectStore(skladiste);
}

/* ---------- popis ---------- */

/** Popis zbirke, onakav kakav je stigao iz izvoza. @returns {Promise<any>} */
export async function dajPopis() {
  try {
    return (await zahtjev((await ured(POPIS, "readonly")).get(KLJUC_POPISA))) || null;
  } catch {
    return null;
  }
}

/** @param {any} popis */
export async function spremiPopis(popis) {
  await zahtjev((await ured(POPIS, "readwrite")).put(popis, KLJUC_POPISA));
}

/* ---------- snimke ---------- */

/** @param {string} id @returns {Promise<Blob | null>} */
export async function zvukZa(id) {
  try {
    return (await zahtjev((await ured(ZVUK, "readonly")).get(id))) || null;
  } catch {
    return null;
  }
}

/** Oznake svih snimaka koje su doista ovdje. @returns {Promise<Set<string>>} */
export async function oznakeSnimaka() {
  try {
    const kljucevi = await zahtjev((await ured(ZVUK, "readonly")).getAllKeys());
    return new Set((kljucevi || []).map(String));
  } catch {
    return new Set();
  }
}

/* ---------- omoti ---------- */

/**
 * Svi omoti odjednom, složeni po imenu kakvo stoji u popisu
 * (`omoti/ETxmCCsMoD0.jpg`).
 *
 * Uzimaju se skupno, a snimke jedna po jedna, i to namjerno: omot je stotinjak
 * kilobajta i treba odmah, u svakom retku popisa; snimka je četiri megabajta i
 * treba tek kad se pusti.
 *
 * @returns {Promise<Map<string, Blob>>}
 */
export async function sviOmoti() {
  /** @type {Map<string, Blob>} */
  const m = new Map();
  try {
    const s = await ured(OMOTI, "readonly");
    const [kljucevi, slike] = await Promise.all([
      zahtjev(s.getAllKeys()),
      zahtjev(s.getAll()),
    ]);
    (kljucevi || []).forEach((/** @type {any} */ k, /** @type {number} */ i) => {
      if (slike[i]) m.set(String(k), slike[i]);
    });
  } catch {
    /* prazna mapa je valjan odgovor: Lucify tada crta slovo */
  }
  return m;
}

/** Imena svih omota koji su ovdje, onakva kakva stoje u popisu. @returns {Promise<Set<string>>} */
export async function oznakeOmota() {
  try {
    const kljucevi = await zahtjev((await ured(OMOTI, "readonly")).getAllKeys());
    return new Set((kljucevi || []).map(String));
  } catch {
    return new Set();
  }
}

/* ---------- uvoz ---------- */

/** Ime datoteke bez mape ispred njega. @param {string} put */
function samoIme(put) {
  const s = String(put || "");
  return s.slice(s.lastIndexOf("/") + 1);
}

/**
 * Uvoz onoga što je složio izvoz za mobitel: mape ili **jedne datoteke**.
 *
 * **Dodaje, a ne zamjenjuje.** Na iPhoneu se mapa ne može odabrati, nego se
 * datoteke biraju rukom, pa ih zna stići pola; drugi odabir tada donese
 * ostatak umjesto da počne ispočetka. Snimka koja je već ovdje preskače se, pa
 * ponovljeni uvoz ne troši ni vrijeme ni mjesto.
 *
 * Arhiva stoji na mjestu mape i ondje je bolja od nje: jedna datoteka prelazi
 * na uređaj lakše nego sto pedeset njih, a u Datotekama se označi jednim
 * pritiskom. Uz to nosi samo ono što uređaj još nema, pa je obično sitna.
 * Raspakirava se odmah ovdje, i sve dalje ne zna odakle je što došlo.
 *
 * Popis je jedino što uvoz **mora** naći, ovaj put ili neki prije: iz njega
 * dolaze očišćeni naslovi, izvođači i police. Bez njega bi ostala samo imena
 * datoteka.
 *
 * @param {File[]} datoteke
 * @param {(n: { gotovo: number, ukupno: number, ime: string }) => void} [naNapredak]
 */
export async function uvezi(datoteke, naNapredak) {
  /** @type {File[]} */
  const odabrane = [];
  for (const f of datoteke) {
    if (jeArhiva(f)) odabrane.push(...(await raspakiraj(f)));
    else odabrane.push(f);
  }

  /** @type {Map<string, File>} */
  const poImenu = new Map();
  /** @type {File | null} */
  let popisF = null;
  for (const f of odabrane) {
    const ime = samoIme(f.name);
    if (ime.toLowerCase() === "popis.json") popisF = f;
    else poImenu.set(ime, f);
  }

  let popis = null;
  if (popisF) {
    try {
      popis = JSON.parse(await popisF.text());
    } catch {
      throw new Error("popis.json se ne da pročitati, pokvaren je.");
    }
  } else {
    popis = await dajPopis();
  }
  if (!popis || !Array.isArray(popis.pjesme)) {
    throw new Error(
      "U odabranome nema datoteke popis.json. Ona stoji u arhivi i u mapi koje " +
        "složi izvoz za mobitel, i mora doći s prvim uvozom.",
    );
  }

  /* Pjesme preuzete na samom mobitelu u popisu s računala ne stoje, jer ih
     računalo nikad nije ni vidjelo. Bez ovoga bi ih svaki uvoz sakrio, a
     „Počisti” zatim i obrisao. Čim ista pjesma stigne i s računala, vrijedi
     njezin redak iz uvoza. */
  const stari = popisF ? await dajPopis() : null;
  const uNovom = new Set(popis.pjesme.map((/** @type {any} */ p) => String(p.id)));
  const svoje = ((stari && stari.pjesme) || []).filter(
    (/** @type {any} */ p) => p.naUredaju && !uNovom.has(String(p.id)),
  );

  const vecTu = await oznakeSnimaka();
  const ukupno = popis.pjesme.length;
  let doneseno = 0;
  let preskoceno = 0;
  /** @type {string[]} */
  const greske = [];

  for (const [i, p] of popis.pjesme.entries()) {
    if (naNapredak) naNapredak({ gotovo: i, ukupno, ime: p.naslov || p.id });

    /* Omot je sitan, pa se prepisuje i kad je snimka već ovdje: tako se
       popravi zbirka uvezena prije nego što su omoti postojali. */
    if (p.omot) {
      const slika = poImenu.get(samoIme(p.omot));
      if (slika) {
        try {
          await zahtjev((await ured(OMOTI, "readwrite")).put(slika, p.omot));
        } catch {
          /* omot nije vrijedan prekida uvoza */
        }
      }
    }

    if (vecTu.has(p.id)) {
      preskoceno += 1;
      continue;
    }
    const snimka = poImenu.get(samoIme(p.datoteka));
    if (!snimka) continue;

    try {
      await zahtjev((await ured(ZVUK, "readwrite")).put(snimka, p.id));
      doneseno += 1;
    } catch (e) {
      /* Puno mjesto je jedina greška koju ima smisla pokazati imenom, jer je
         jedina koju čovjek može riješiti. */
      const puno = e && /quota/i.test(String(e.name || e.message || ""));
      greske.push((p.naslov || p.id) + (puno ? ": nema više mjesta na uređaju" : ": nije spremljeno"));
      if (puno) break;
    }
  }

  if (svoje.length) {
    const pjesme = [...popis.pjesme, ...svoje];
    odrediJezike(pjesme);
    pjesme.sort((/** @type {any} */ a, /** @type {any} */ b) => a.naslov.localeCompare(b.naslov, "hr"));
    popis = { ...popis, pjesme, police: police(pjesme) };
  }
  await spremiPopis(popis);
  if (naNapredak) naNapredak({ gotovo: ukupno, ukupno, ime: "" });

  const imam = await oznakeSnimaka();
  return { doneseno, preskoceno, greske, uZbirci: imam.size, uPopisu: ukupno };
}

/* ---------- višak ---------- */

/**
 * Što na uređaju stoji, a u popisu ga više nema.
 *
 * Uvoz samo dodaje, pa zbirka uređaja zna jedino rasti. Pjesma koja je na
 * računalu izbačena ostaje ovdje zauvijek: `samoDostupno()` je ne pokaže, jer
 * je nema u popisu, ali njezina četiri megabajta i dalje stoje. Na mobitelu, u
 * koji stane šesto megabajta, to je prije ili poslije jedina stvar koja smeta,
 * a jedini je lijek dosad bio obrisati sve i prenositi zbirku iznova.
 *
 * Višak se traži prema **popisu**, a ne prema onome što je maloprije odabrano,
 * i u tome je sav oprez: na iPhoneu se datoteke biraju rukom, pa ih zna stići
 * pola, dok je `popis.json` cijel već iz prvoga odabira. Kad bi se višak
 * računao iz odabira, drugi bi uvoz pobrisao sve što je donio prvi.
 *
 * @returns {Promise<{ snimke: string[], omoti: string[], bajtova: number }>}
 */
export async function visak() {
  const popis = await dajPopis();
  /* Bez popisa se ne zna što je ovdje suvišno, pa nije suvišno ništa. */
  if (!popis || !Array.isArray(popis.pjesme)) return { snimke: [], omoti: [], bajtova: 0 };

  const uPopisu = new Set(popis.pjesme.map((/** @type {any} */ p) => String(p.id)));
  const omotiUPopisu = new Set(
    popis.pjesme
      .map((/** @type {any} */ p) => p.omot)
      .filter(Boolean)
      .map(String),
  );

  const snimke = [...(await oznakeSnimaka())].filter((k) => !uPopisu.has(k));
  const omoti = [...(await oznakeOmota())].filter((k) => !omotiUPopisu.has(k));

  const bajtova = (await zbrojiVelicine(ZVUK, snimke)) + (await zbrojiVelicine(OMOTI, omoti));
  return { snimke, omoti, bajtova };
}

/**
 * Koliko zauzima ono što se nabraja.
 *
 * Pita se samo za višak, a nikad za cijelo skladište: `get` vraća `Blob`, a
 * `Blob` je ovdje uputa na datoteku, a ne njezin sadržaj, pa `.size` ništa ne
 * čita s diska. Svejedno, za sto pedeset njih nema smisla ići kad se pita za
 * troje.
 *
 * @param {string} skladiste @param {string[]} kljucevi
 */
async function zbrojiVelicine(skladiste, kljucevi) {
  let zbroj = 0;
  for (const k of kljucevi) {
    try {
      const b = await zahtjev((await ured(skladiste, "readonly")).get(k));
      if (b && b.size) zbroj += b.size;
    } catch {
      /* veličina je ovdje obavijest, a ne uvjet */
    }
  }
  return zbroj;
}

/**
 * Briše točno ono što je `visak()` našao, i ništa mimo toga.
 *
 * Popis se ne dira: on je već onakav kakav treba biti, inače viška ne bi ni
 * bilo.
 *
 * @param {{ snimke: string[], omoti: string[] }} sto
 */
export async function pocisti(sto) {
  const b = await otvori();
  await Promise.all([
    obrisiKljuceve(b, ZVUK, sto.snimke || []),
    obrisiKljuceve(b, OMOTI, sto.omoti || []),
  ]);
}

/**
 * Jedan ured po skladištu, a ne po ključu: brisanje ne čeka ništa izvana, pa
 * svi zahtjevi stanu u isti, dok bi `await` među njima svaki put zatvorio ured
 * i otvorio novi.
 *
 * @param {IDBDatabase} b @param {string} skladiste @param {string[]} kljucevi
 */
function obrisiKljuceve(b, skladiste, kljucevi) {
  if (!kljucevi.length) return Promise.resolve([]);
  const s = b.transaction(skladiste, "readwrite").objectStore(skladiste);
  return Promise.all(kljucevi.map((k) => zahtjev(s.delete(k))));
}

/**
 * Jedna pjesma van sa uređaja: snimka, omot i redak u popisu.
 *
 * Redak ide iz popisa zato da je ne vrati `samoDostupno()` ako se snimka
 * ikad opet nađe, i da je `visak()` ne broji. Sljedeći uvoz donese svjež popis
 * u kojem ona opet stoji, ali ne i snimku, jer izvoz „samo novo” zna da ju je
 * uređaj već dobio; vraća se tek uvozom cijele zbirke.
 *
 * @param {string} id
 * @returns {Promise<number>} koliko je bajtova oslobođeno
 */
export async function ukloni(id) {
  const popis = await dajPopis();
  const pjesme = popis && Array.isArray(popis.pjesme) ? popis.pjesme : [];
  const p = pjesme.find((/** @type {any} */ x) => x.id === id);
  const ostale = pjesme.filter((/** @type {any} */ x) => x.id !== id);
  const omot = p && p.omot && !ostale.some((/** @type {any} */ x) => x.omot === p.omot) ? [p.omot] : [];

  const oslobodeno = (await zbrojiVelicine(ZVUK, [id])) + (await zbrojiVelicine(OMOTI, omot));
  const b = await otvori();
  await Promise.all([obrisiKljuceve(b, ZVUK, [id]), obrisiKljuceve(b, OMOTI, omot)]);
  if (popis && p) {
    await spremiPopis({
      ...popis,
      pjesme: ostale,
      police: (popis.police || []).map((/** @type {any} */ x) => ({
        ...x,
        pjesme: (x.pjesme || []).filter((/** @type {string} */ y) => y !== id),
      })),
    });
  }
  return oslobodeno;
}

/**
 * Jedna nova pjesma u zbirku uređaja: snimka, omot i redak u popisu.
 *
 * Ovamo piše preuzimač na Androidu, koji pjesmu dohvati sam, bez izvoza. Radi
 * isto što i `dodajUPopis()` u `scripts/glazba-zbirka.mjs`: ostale pjesme
 * ostaju onakve kakve jesu, a iznova se slažu samo poredak i police. Ono što
 * je čovjek u staroj pjesmi ispravio ili dopisao ostaje, isto kao ondje.
 *
 * Snimka se sprema **prije** popisa. Obrnuto bi popis na trenutak pokazivao
 * pjesmu koje nema, a ako spremanje padne, i ostao takav.
 *
 * @param {{ pjesma: any, snimka: Blob, omot?: Blob | null }} nova
 * @returns {Promise<any>} pjesma onakva kakva je upisana
 */
export async function dodajPjesmu({ pjesma, snimka, omot }) {
  await zahtjev((await ured(ZVUK, "readwrite")).put(snimka, pjesma.id));
  if (omot && pjesma.omot) {
    try {
      await zahtjev((await ured(OMOTI, "readwrite")).put(omot, pjesma.omot));
    } catch {
      /* omot nije vrijedan prekida */
    }
  }

  const popis = (await dajPopis()) || { pjesme: [], police: [] };
  const pjesme = Array.isArray(popis.pjesme) ? popis.pjesme : [];
  const prije = pjesme.find((/** @type {any} */ x) => x.id === pjesma.id) || {};
  const upisana = {
    ...pjesma,
    naslov: prije.ispravljeno ? prije.naslov : pjesma.naslov,
    izvodac: prije.ispravljeno ? prije.izvodac : pjesma.izvodac,
    ...(prije.ispravljeno ? { ispravljeno: true } : {}),
    razdoblje: prije.razdoblje || pjesma.razdoblje || "",
    biljeska: prije.biljeska || pjesma.biljeska || "",
    ...(prije.mapa ? { mapa: prije.mapa } : {}),
    ...(prije.jezik ? { jezik: prije.jezik } : {}),
  };

  const ostale = pjesme.filter((/** @type {any} */ x) => x.id !== pjesma.id);
  ostale.push(upisana);
  odrediJezike(ostale);
  ostale.sort((/** @type {any} */ a, /** @type {any} */ b) => a.naslov.localeCompare(b.naslov, "hr"));
  await spremiPopis({ ...popis, gradeno: new Date().toISOString(), pjesme: ostale, police: police(ostale) });
  return upisana;
}

/** Briše cijelu zbirku s ovoga uređaja. Srca i popisi u `localStorage` ostaju. */
export async function obrisiSve() {
  const b = await otvori();
  await Promise.all(
    [ZVUK, OMOTI, POPIS].map((s) =>
      zahtjev(b.transaction(s, "readwrite").objectStore(s).clear()),
    ),
  );
}

/* ---------- mjesto na uređaju ---------- */

/**
 * Koliko je zauzeto i koliko ima. Preglednik odgovara okruglo i sa zadrškom,
 * pa je ovo mjera, a ne vaga.
 *
 * @returns {Promise<{ koristeno: number, ukupno: number } | null>}
 */
export async function procjena() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const o = await navigator.storage.estimate();
    return { koristeno: o.usage || 0, ukupno: o.quota || 0 };
  } catch {
    return null;
  }
}

/**
 * Zamolba da se zbirka ne izbaci sama od sebe.
 *
 * Preglednik inače smije počistiti spremište stranice koja se dugo nije
 * otvarala, a šesto megabajta je prvo na redu. Odgovor nije u našim rukama:
 * Chrome je na Androidu obično da stranici koja je dodana na početni zaslon,
 * dok Safari zna odbiti i svejedno počistiti zbirku poslije nekoliko tjedana
 * nekorištenja. Zato se ovdje samo pita, a odgovor se pokaže u okviru za uvoz.
 *
 * @returns {Promise<boolean>}
 */
export async function trajno() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
