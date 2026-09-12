/**
 * Svirač: zvuk, red čekanja i sve što odlučuje što sada svira.
 *
 * Stoji **izvan Reacta**, a ne u komponenti: zvuk, red čekanja, redoslijed za
 * nasumično, glasnoća, ponavljanje i mjerač smiju preživjeti svaki ponovni
 * prikaz, a React pri odmontiranju komponente odnosi sve što je u njoj. Zato je
 * ovo obična datoteka s modulskim stanjem, a prikaz ga čita kroz
 * `useSyncExternalStore`: ono što ne smije preživjeti ponovni prikaz ne stavlja
 * se u prikaz.
 *
 * Ovdje nema ničega iz `glazba.css`, jer ova datoteka ne crta ništa.
 */

import { KORIJEN, omotAdresa, pustiAdresu, zvukAdresa } from "./glazba-izvor.mjs";

/* Dosadašnji uvoznici uzimaju `KORIJEN` odavde, pa ostaje gdje je i bio. Sama
   vrijednost sada stoji uz ostalo što zna gdje zbirka jest. */
export { KORIJEN };

const KLJUC_POSTAVKE = "lucijanka.glazba.svirac";
const KLJUC_ZADNJE = "lucijanka.glazba.zadnje";

/* Dva zapisa vremena stoje ovdje, uz svirač, a ne u prikazu, jer su podatak o
   vremenu, a ne o izgledu. Dvije bi se kopije razišle. */

/** Sekunde u „3:41”. @param {number} s */
export function mmss(s) {
  if (!s || !isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

/** Preostalo vrijeme mjerača: „4:59”, a preko sata „1:04:59”. @param {number} s */
export function odbroj(s) {
  const c = Math.max(0, Math.ceil(s));
  const h = Math.floor(c / 3600);
  const m = Math.floor((c % 3600) / 60);
  const sek = String(c % 60).padStart(2, "0");
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + sek : m + ":" + sek;
}

/** @param {string} k @param {any} zadano */
function ucitaj(k, zadano) {
  try {
    const s = localStorage.getItem(k);
    return s ? JSON.parse(s) : zadano;
  } catch {
    return zadano;
  }
}

/** @param {string} k @param {any} v */
function spremi(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* privatni prozor */
  }
}

const post = ucitaj(KLJUC_POSTAVKE, {});

/**
 * Svaki element za zvuk upisuje se u popis na `globalThis`, i to nije opreznost
 * nego popravak kvara koji se doista događao: glazba je svirala dalje i kad je
 * zaustavljena, a na sljedeće puštanje svirale su dvije pjesme odjednom.
 *
 * Uzrok je zamjena modula u razvoju. Kad se datoteka spremi, Vite uveze **novu
 * inačicu ovoga modula**, a stara ostaje živjeti sa svojim elementom, koji i
 * dalje svira i na kraju pjesme sam uzima sljedeću, jer i njegovi događaji i
 * dalje rade. Nova inačica o njemu ne zna ništa: element nije u stranici, pa se
 * ne da naći ni preko `document`.
 *
 * Zato popis stoji izvan modula, na `globalThis`, gdje ga i nova inačica nađe.
 * Prvo što ona učini jest da ušutka sve zatečene elemente.
 */
const POPIS = "__lucijankaZvukovi";
/** @type {Set<HTMLAudioElement>} */
const zvukovi = /** @type {any} */ (globalThis)[POPIS] || new Set();
/** @type {any} */ (globalThis)[POPIS] = zvukovi;

/** @param {HTMLAudioElement} z */
function ugasiElement(z) {
  try {
    z.pause();
    z.removeAttribute("src");
    z.load();
  } catch {
    /* element kojega je preglednik već odbacio */
  }
}

for (const z of zvukovi) ugasiElement(z);
zvukovi.clear();

/* Kad Vite odbaci ovu inačicu modula, zvuk odlazi s njom. Bez ovoga bi popis
   iznad morao čekati da netko otvori Lucify, a dotad bi svirala stara
   pjesma. U produkciji ovoga retka nema, jer ondje zamjene modula nema. */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (zvuk) ugasiElement(zvuk);
    if (otkucaj) clearInterval(otkucaj);
    if (straza) clearInterval(straza);
  });
}

/** @type {HTMLAudioElement | null} */
let zvuk = null;
/** Pjesme po oznaci. Puni ih Lucify kad dohvati popis. @type {Map<string, any>} */
let poId = new Map();
/** @type {string[]} */
let red = [];
let na = -1;
/** @type {any} */
let sada = null;
let svira = false;
/* Namjera, odvojeno od onoga što element doista radi. Po njoj straža zna smije
   li zvuk uopće svirati, a `svira` je samo ono što je element zadnje javio. */
let zeljaSvira = false;
let vrijeme = 0;
let ukupno = 0;
/** Redoslijed za nasumično. Nije za prikaz nego za odluku „koja je sljedeća”. @type {number[]} */
let mijesano = [];
let glasnoca = typeof post.glasnoca === "number" ? post.glasnoca : 0.8;
let tiho = false;
let mijesaj = !!post.mijesaj;
let ponovi = post.ponovi || "ne";
/** Zadnja spremljena sekunda, da se u `localStorage` ne piše četiri puta u sekundi. */
let spremljenoNa = -99;

/* Mjerač vremena: koliko glazba još smije svirati, u sekundama. `kraj` je
   vrsta koja se ne odbrojava nego čeka da pjesma dosvira. Ne pamti se u
   `localStorage`: mjerač vrijedi za ovo slušanje, a ne za svako sljedeće.
   Stoji ovdje, uz zvuk, a ne u prikazu, jer mjeri koliko će se slušati, pa ne
   smije stati kad se prikaz promijeni. */
/** @type {{ ostalo: number, kraj: boolean } | null} */
let mjerac = null;
/** @type {any} */
let otkucaj = null;
let zadnjiOtkucaj = 0;
/** @type {any} */
let straza = null;

/** @type {any} */
let snimka = null;
/** @type {Set<() => void>} */
const pratitelji = new Set();

/**
 * Stanje za prikaz. Isti objekt vraća se sve dok se ništa ne promijeni, jer
 * `useSyncExternalStore` inače misli da se stanje mijenja u nedogled i vrti
 * prikaz bez prestanka.
 */
export function stanje() {
  if (!snimka) {
    snimka = {
      red,
      na,
      sada,
      svira,
      vrijeme,
      /* Trajanje iz popisa pobjeđuje ono iz preglednika, koji na početku samo
         procjenjuje po brzini zapisa: za jednu se pjesmu vidjelo „1:56”
         umjesto „3:57”. U popisu stoji broj okvira iz Xing zaglavlja. */
      trajanje: (sada && sada.trajanje) || ukupno || 0,
      glasnoca,
      tiho,
      mijesaj,
      ponovi,
      mjerac,
    };
  }
  return snimka;
}

/** @param {() => void} f */
export function prati(f) {
  pratitelji.add(f);
  return () => {
    pratitelji.delete(f);
  };
}

function osvjezi() {
  snimka = null;
  for (const f of pratitelji) f();
}

/**
 * Prazan red se **ne zapisuje**, jer bi time obrisao zadnju pjesmu. Događaji
 * zvuka ne stižu odmah nego u svom redu, pa `zatvori()` isprazni red prije
 * nego što stigne njegov vlastiti `pause`: da se ondje pisalo, gumb × bi uz
 * ploču sklonio i pamćenje, a on je tu samo da skloni ploču.
 */
function zapamti() {
  if (!red.length) return;
  spremljenoNa = Math.floor(vrijeme);
  spremi(KLJUC_ZADNJE, { red, na, vrijeme: spremljenoNa });
}

/**
 * Mjerač otkucava samo dok glazba doista svira, jer se mjeri koliko će se
 * slušati, a ne koliko će sat otkucati: tko usred popisa zastane, to vrijeme
 * ne izgubi. Zato se otkucaj pali i gasi odavde, iz istoga mjesta s kojega se
 * pali i gasi zvuk.
 *
 * Preostalo se računa iz sata, a ne zbrajanjem otkucaja, jer preglednik u
 * skrivenoj kartici otkucaje prorijedi, pa bi se zbrojem izgubile minute.
 * Otkucaj je češći od sekunde samo zato da prikazani broj ne preskoči.
 */
function uskladiOtkucaj() {
  const treba = !!mjerac && !mjerac.kraj && svira;
  if (treba && !otkucaj) {
    zadnjiOtkucaj = Date.now();
    otkucaj = setInterval(() => {
      const sad = Date.now();
      const proslo = (sad - zadnjiOtkucaj) / 1000;
      zadnjiOtkucaj = sad;
      if (!mjerac || mjerac.kraj) return;
      mjerac = { ...mjerac, ostalo: mjerac.ostalo - proslo };
      if (mjerac.ostalo <= 0) {
        mjerac = null;
        zeljaSvira = false;
        if (zvuk) zvuk.pause();
        uskladiOtkucaj();
      }
      osvjezi();
    }, 500);
  } else if (!treba && otkucaj) {
    clearInterval(otkucaj);
    otkucaj = null;
  }
}

/** Novo odbrojavanje. @param {number} minuta */
export function postaviMjerac(minuta) {
  mjerac = { ostalo: minuta * 60, kraj: false };
  uskladiOtkucaj();
  osvjezi();
}

/** Vrsta mjerača koja se ne odbrojava nego čeka da pjesma dosvira. */
export function mjeracDoKraja() {
  mjerac = { ostalo: 0, kraj: true };
  uskladiOtkucaj();
  osvjezi();
}

export function ugasiMjerac() {
  mjerac = null;
  uskladiOtkucaj();
  osvjezi();
}

/**
 * Straža: jednom u sekundi provjeri **radi li zvuk ono što je rečeno**.
 *
 * Postoji zato što je puštanje ono što se najlakše raziđe sa stvarnošću: ako
 * jedan `pause()` ne prođe ili se koji događaj izgubi, pjesma svira dalje iako
 * je zaustavljena, a sljedeće puštanje onda svira preko nje. Straža to ne
 * pokušava objasniti nego samo popravi: što nije smjelo svirati, ugasi se.
 */
function postaviStrazu() {
  if (straza) return;
  straza = setInterval(() => {
    if (!zvuk) return;
    const doista = !zvuk.paused && !zvuk.ended;
    if (doista && !zeljaSvira) zvuk.pause();
    /* Ako se prikaz razišao s elementom, vrijedi element. */
    if (svira !== doista) {
      svira = doista;
      uskladiOtkucaj();
      osvjezi();
    }
  }, 1000);
}

/** Tipke na slušalicama i na tipkovnici prijenosnika. */
function objaviPjesmu() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !sada) return;
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: sada.naslov,
      artist: sada.izvodac,
      album: "Lucify",
      artwork: omotAdresa(sada.omot)
        ? [{ src: omotAdresa(sada.omot), sizes: "512x512", type: "image/jpeg" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => prekidac());
    navigator.mediaSession.setActionHandler("pause", () => prekidac());
    navigator.mediaSession.setActionHandler("previoustrack", () => pomakni(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => pomakni(1));
  } catch {
    /* stariji preglednik jednostavno nema te tipke */
  }
}

/* ---------- izvor zvuka ---------- */

/**
 * Adresa s koje sada svira. Na uređaju je to `blob:`, koja vrijedi dok je se ne
 * poništi, pa se pamti zato da je ima tko poništiti kad dođe sljedeća pjesma.
 */
let adresa = "";

/**
 * Svako puštanje dobiva svoj broj. Snimka se na uređaju traži u bazi, dakle s
 * čekanjem, a čovjek dotad može pritisnuti drugu: odgovor na stariji zahtjev
 * tada stigne poslije novoga i, da ovoga broja nema, pretekao bi ga.
 */
let naredba = 0;

/**
 * Postavi izvor zvuka i poništi onaj prije njega.
 *
 * @param {HTMLAudioElement} z @param {any} p
 * @returns {Promise<boolean>} je li adresa doista postavljena
 */
async function postaviIzvor(z, p) {
  const moja = ++naredba;
  const nova = await zvukAdresa(p);
  if (moja !== naredba) {
    /* Pretekla nas je novija pjesma, pa ova adresa nikomu ne treba. */
    pustiAdresu(nova);
    return false;
  }
  if (!nova) return false;
  pustiAdresu(adresa);
  adresa = nova;
  tisina = false;
  z.src = nova;
  return true;
}

/**
 * Tišina od četrdeset pet bajtova, i jedini razlog zašto postoji: iOS ne da
 * zvuku da krene ako `play()` nije došao iz čovjekova dodira. Snimka se na
 * uređaju najprije traži u bazi, dakle s čekanjem, pa `play()` stigne koji
 * trenutak poslije dodira, a ondje je i to dovoljno da ga preglednik odbije.
 *
 * Zato element jednom zasvira ovu tišinu, ravno iz dodira. Poslije toga ga
 * preglednik drži otključanim i pušta sve što dođe.
 */
const TISINA = "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";
let otkljucano = false;
/** Svira li upravo ta tišina, da je „ended” ne shvati kao kraj pjesme. */
let tisina = false;

function otkljucaj() {
  if (otkljucano) return;
  otkljucano = true;
  const z = dajZvuk();
  /* Ako je pjesma već u elementu, otključavati nema što: tada je čovjek već
     nešto pustio, pa je posao obavljen sam od sebe. */
  if (!z || z.src) return;
  tisina = true;
  z.src = TISINA;
  const o = z.play();
  if (o && o.catch) {
    o.catch(() => {
      tisina = false;
    });
  }
}

/* Dodir, a ne klik: dodir se javlja prije, pa je element otključan već kad klik
   stigne do popisa. Sluša se jedanput i više nikad. */
if (typeof document !== "undefined") {
  const naDodir = () => otkljucaj();
  document.addEventListener("pointerdown", naDodir, { once: true, capture: true });
  document.addEventListener("keydown", naDodir, { once: true, capture: true });
}

/**
 * Zvuk se stvara tek kad zatreba, a ne pri učitavanju stranice. Kad jednom
 * nastane, živi do zatvaranja stranice, pa se događaji vežu samo jedanput.
 */
function dajZvuk() {
  if (zvuk || typeof Audio === "undefined") return zvuk;
  const z = new Audio();
  zvuk = z;
  zvukovi.add(z);
  postaviStrazu();
  /* Bez ovoga bi vraćanje zadnje pjesme povuklo cijelu datoteku, a ona se
     dotad možda neće ni pustiti. Zaglavlje je dovoljno da se zna trajanje. */
  z.preload = "metadata";
  z.volume = tiho ? 0 : glasnoca;
  z.addEventListener("timeupdate", () => {
    vrijeme = z.currentTime;
    /* Mjesto u pjesmi pamti se svakih pet sekunda, a ne pri svakoj promjeni,
       jer `timeupdate` javlja četiri puta u sekundi. */
    if (Math.abs(Math.floor(vrijeme) - spremljenoNa) >= 5) zapamti();
    osvjezi();
  });
  const naPodatke = () => {
    ukupno = z.duration || 0;
    osvjezi();
  };
  z.addEventListener("loadedmetadata", naPodatke);
  z.addEventListener("durationchange", naPodatke);
  z.addEventListener("play", () => {
    /* Tišina koja otključava element nije pjesma, pa se ne smije vidjeti u
       prikazu: inače bi prvi dodir bilo gdje na trenutak pokazao da nešto
       svira, a ništa ne svira. */
    if (tisina) return;
    svira = true;
    uskladiOtkucaj();
    osvjezi();
  });
  z.addEventListener("pause", () => {
    svira = false;
    uskladiOtkucaj();
    zapamti();
    osvjezi();
  });
  z.addEventListener("ended", () => {
    /* Tišina koja otključava element završi odmah, i to nije kraj pjesme nego
       kraj tišine: bez ovoga bi prvi dodir uzeo sljedeću pjesmu. */
    if (tisina) {
      tisina = false;
      return;
    }
    /* Mjerač postavljen na „do kraja pjesme” staje ovdje, prije ponavljanja i
       prije nego što `pomakni` uzme sljedeću: mjerač je noviji dogovor, pa
       nadjačava i „ponovi jednu”. */
    if (mjerac && mjerac.kraj) {
      mjerac = null;
      zeljaSvira = false;
      z.pause();
      osvjezi();
      return;
    }
    if (ponovi === "jedna") {
      z.currentTime = 0;
      zeljaSvira = true;
      z.play().catch(() => {
        zeljaSvira = false;
        svira = false;
        osvjezi();
      });
      return;
    }
    pomakni(1, true);
  });
  return z;
}

/**
 * Novi nasumičan redoslijed, uvijek s trenutnom pjesmom na početku.
 * @param {number} duljina @param {number} prvi
 */
function promijesaj(duljina, prvi) {
  /** @type {number[]} */
  const r = [];
  for (let i = 0; i < duljina; i++) if (i !== prvi) r.push(i);
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  mijesano = prvi >= 0 ? [prvi, ...r] : r;
}

/**
 * Zadnja pjesma iz prošloga posjeta. Vraća se **zaustavljena i na svom
 * mjestu**, a ne puštena: preglednik ionako ne da da zvuk krene sam, a i da
 * da, glazba koja se upali čim se otvori stranica nije ono što se traži. Gumb
 * je tu, pa se nastavlja jednim pritiskom.
 */
function vrati() {
  const z = ucitaj(KLJUC_ZADNJE, null);
  if (!z || !Array.isArray(z.red) || !z.red.length) return;
  /* Pjesma je u međuvremenu mogla nestati iz zbirke, pa se red pročisti, a
     mjesto u njemu traži po oznaci, a ne po starom broju. */
  const trazena = z.red[z.na];
  const cisti = z.red.filter((/** @type {string} */ id) => poId.has(id));
  const indeks = cisti.indexOf(trazena);
  if (indeks < 0) return;
  const a = dajZvuk();
  if (!a) return;
  red = cisti;
  na = indeks;
  sada = poId.get(trazena);
  vrijeme = z.vrijeme || 0;
  /* `currentTime` nema kamo dok se ne pročita zaglavlje, pa se mjesto vraća tek
     kad preglednik javi da zna koliko pjesma traje. Slušatelj se veže prije
     adrese, jer na uređaju snimka zna doći iz baze brže nego što bi se stigao
     vezati poslije. */
  a.addEventListener(
    "loadedmetadata",
    () => {
      try {
        a.currentTime = vrijeme;
      } catch {
        /* preglednik koji ne da premotavanje prije prvoga sviranja */
      }
    },
    { once: true },
  );
  postaviIzvor(a, sada);
  if (mijesaj) promijesaj(red.length, na);
  objaviPjesmu();
}

/**
 * Lucify predaje popis čim ga dohvati. Prvi put se odatle vraća i zadnja
 * pjesma, jer se tek s popisom zna koja je i gdje stoji.
 * @param {any[]} pjesme
 */
export function postaviZbirku(pjesme) {
  poId = new Map();
  for (const p of pjesme || []) poId.set(p.id, p);
  if (sada && poId.has(sada.id)) sada = poId.get(sada.id);
  else if (!sada) vrati();
  osvjezi();
}

/** @param {string} id */
export function pjesma(id) {
  return poId.get(id);
}

/**
 * @param {string[]} noviRed oznake pjesama
 * @param {number} indeks koja se od njih pušta
 */
export function pusti(noviRed, indeks) {
  const z = dajZvuk();
  const p = poId.get(noviRed[indeks]);
  if (!z || !p) return;
  red = noviRed;
  na = indeks;
  sada = p;
  vrijeme = 0;
  ukupno = 0;
  zeljaSvira = true;
  /* Prikaz se osvježava odmah, a ne kad zvuk krene: na uređaju se snimka
     najprije traži u bazi, pa bi inače između pritiska i prve crte prošao
     trenutak u kojem se ne bi dogodilo ništa. */
  if (mijesaj) promijesaj(noviRed.length, indeks);
  zapamti();
  objaviPjesmu();
  osvjezi();
  postaviIzvor(z, p).then((ima) => {
    /* Dok se snimka tražila, čovjek je mogao pritisnuti stanku ili drugu
       pjesmu. Prvo se vidi po namjeri, a drugo je `postaviIzvor` već odbio. */
    if (!ima || !zeljaSvira) return;
    z.play().catch(() => {
      zeljaSvira = false;
      svira = false;
      osvjezi();
    });
  });
}

/** Pusti ili zaustavi ono što je već učitano. */
export function prekidac() {
  const z = zvuk;
  /* Pita se za pjesmu, a ne više za `z.src`: otključavanje ostavi u elementu
     tišinu, pa bi `src` postojao i kad nije odabrano ništa, a onda bi se ta
     tišina i „pustila”. */
  if (!z || !sada) return;
  if (z.paused) {
    zeljaSvira = true;
    z.play().catch(() => {
      zeljaSvira = false;
      svira = false;
      osvjezi();
    });
  } else {
    zeljaSvira = false;
    z.pause();
  }
}

/**
 * Sljedeća u redu. `samo` znači da je pjesma došla do kraja sama, pa se na
 * kraju popisa staje, dok pritisak na tipku uvijek prelazi u krug.
 * @param {number} smjer @param {boolean} [samo]
 */
export function pomakni(smjer, samo) {
  if (!red.length) return;
  if (mijesaj) {
    const gdje = mijesano.indexOf(na);
    const sljedeci = gdje + smjer;
    if (sljedeci < 0 || sljedeci >= mijesano.length) {
      if (samo && ponovi !== "sve") {
        zeljaSvira = false;
        if (zvuk) zvuk.pause();
        return;
      }
      promijesaj(red.length, -1);
      pusti(red, mijesano[0]);
      return;
    }
    pusti(red, mijesano[sljedeci]);
    return;
  }
  const sljedeci = na + smjer;
  if (sljedeci < 0) {
    pusti(red, red.length - 1);
    return;
  }
  if (sljedeci >= red.length) {
    if (samo && ponovi !== "sve") {
      zeljaSvira = false;
      if (zvuk) zvuk.pause();
      return;
    }
    pusti(red, 0);
    return;
  }
  pusti(red, sljedeci);
}

/** Skok na mjesto u pjesmi. @param {number} s */
export function premotaj(s) {
  const z = zvuk;
  if (!z || !z.src) return;
  z.currentTime = s;
  vrijeme = s;
  /* Ovdje se ne piše u `localStorage`: klizač javlja svaki pomak ručice, a
     `timeupdate` odmah nakon skoka ionako vidi razliku veću od pet sekunda. */
  osvjezi();
}

/** Pomak naprijed ili natrag, za tipke sa strelicama. @param {number} s */
export function pomakZa(s) {
  const z = zvuk;
  if (!z || !z.src) return;
  premotaj(Math.max(0, Math.min(z.duration || 0, z.currentTime + s)));
}

function spremiPostavke() {
  spremi(KLJUC_POSTAVKE, { glasnoca, mijesaj, ponovi });
}

/** @param {number} v */
export function postaviGlasnocu(v) {
  glasnoca = v;
  tiho = false;
  if (zvuk) zvuk.volume = v;
  spremiPostavke();
  osvjezi();
}

export function prigusi() {
  tiho = !tiho;
  if (zvuk) zvuk.volume = tiho ? 0 : glasnoca;
  osvjezi();
}

/** @param {boolean} v */
export function postaviMijesaj(v) {
  mijesaj = v;
  if (v) promijesaj(red.length, na);
  spremiPostavke();
  osvjezi();
}

/** Redom: ne, cijeli popis, jedna pjesma. */
export function sljedecePonavljanje() {
  ponovi = ponovi === "ne" ? "sve" : ponovi === "sve" ? "jedna" : "ne";
  spremiPostavke();
  osvjezi();
}

/**
 * Zaustavi sve i isprazni red. Zadnja pjesma se pritom **ne zaboravlja**, jer
 * se ovim briše red, a ne povijest: pri sljedećem otvaranju ista pjesma opet
 * čeka.
 *
 * Sam Lucify ovo ne zove. Stoji jer je svirač namijenjen i tomu da ga
 * ugosti druga stranica, kojoj treba način da glazbu ušutka izvana; u
 * Lucijankici je to bio gumb × na maloj ploči u kutu bilježnice.
 */
export function zatvori() {
  zeljaSvira = false;
  if (zvuk) {
    zvuk.pause();
    zvuk.removeAttribute("src");
    zvuk.load();
  }
  red = [];
  na = -1;
  sada = null;
  svira = false;
  vrijeme = 0;
  ukupno = 0;
  /* Mjerač ide s glazbom: kad nema što svirati, nema se što ni zaustaviti. */
  mjerac = null;
  uskladiOtkucaj();
  osvjezi();
}
