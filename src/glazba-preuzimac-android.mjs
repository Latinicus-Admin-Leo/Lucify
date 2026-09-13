/**
 * Preuzimač na Androidu: iz poveznice s YouTubea u zbirku, u samom mobitelu.
 *
 * Ovo je par `scripts/preuzimac.mjs`, ali bez poslužitelja. yt-dlp, Python i
 * ffmpeg stoje u aplikaciji (knjižnica `youtubedl-android`) i pokreće ih
 * `LucifyPreuzimacPlugin.java`. Red čekanja, stanja poslova i upis u zbirku
 * drže se ovdje, istim redom i istim imenima kao na poslužitelju, pa okvir
 * „Dodaj pjesmu” ne vidi razliku.
 *
 * Gotova pjesma ne ide na disk nego u **zbirku uređaja**, u IndexedDB, isto
 * kamo ide i uvoz. Zato je poslije nitko ne razlikuje od uvezene: svira se,
 * uklanja i čisti istim putem.
 *
 * Ova se datoteka uvozi samo uz `ANDROID`, pa u ostalim izlazima ne postoji, a
 * s njom ni Capacitor.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { procitajGresku } from "./glazba-greske.mjs";
import { rastavi } from "./glazba-naslovi.mjs";
import { procitajVeze } from "./glazba-veze.mjs";

/**
 * @typedef {object} Domaci
 * @property {() => Promise<{ ytDlp: string }>} stanje
 * @property {() => Promise<{ inacica: string }>} osvjezi
 * @property {(o: { adresa: string }) => Promise<{ json: string }>} podatci
 * @property {(o: { posao: string, adresa: string, oznaka: string, kakvoca: string }) =>
 *   Promise<{ mp3: string, omot: string }>} preuzmi
 * @property {(o: { posao: string }) => Promise<void>} odustani
 * @property {(o: { posao: string }) => Promise<void>} pospremi
 * @property {() => Promise<{ tekst: string }>} uzmiPodijeljeno
 * @property {(dogadaj: string, slusac: (podatci: any) => void) => Promise<{ remove: () => void }>} addListener
 */

/** @type {Domaci} */
const domaci = /** @type {any} */ (registerPlugin("LucifyPreuzimac"));

/** Koliko ih se pretvara istodobno. Mobitel je sporiji od računala. */
const NAJVISE_ODJEDNOM = 2;
/** Koliko poveznica prima jedno slanje, isto kao na poslužitelju. */
const NAJVISE_ODJEDNOM_POSLANO = 20;
/** Dulje od ovoga ne preuzimamo, da se uređaj ne napuni greškom. */
const NAJDULJE_SEKUNDI = 4 * 60 * 60;

/* Postotci dvaju dugih koraka slažu se u jedan, da traka nikad ne ide unatrag. */
const MJERE = { podatci: 5, preuzeto: 70, pretvoreno: 99 };

/**
 * Kakvoće, iste kao `KAKVOCE` u `scripts/preuzimac-posao.mjs`. Ondje ih ffmpeg
 * dobiva kao `-q:a`, a ovdje yt-dlp kao `--audio-quality`, što je isti broj; tu
 * pretvorbu radi `LucifyPreuzimacPlugin.java`. Tko promijeni jedno, mijenja i
 * drugo.
 */
const KAKVOCE = [
  { id: "mala", ime: "Manja", opis: "oko 115 kbps" },
  { id: "srednja", ime: "Srednja", opis: "oko 165 kbps" },
  { id: "visoka", ime: "Visoka", opis: "oko 190 kbps" },
  { id: "najveca", ime: "Najveća", opis: "320 kbps" },
];
const ZADANA_KAKVOCA = "visoka";

/** @param {number} p @param {number} od @param {number} do_ */
function stopi(p, od, do_) {
  const c = Math.max(0, Math.min(100, Number(p) || 0));
  return od + (c / 100) * (do_ - od);
}

/** Greška koja se smije pokazati, istoga oblika kao `javna()` na poslužitelju. */
class Greska extends Error {
  /** @param {string} oznaka @param {string} poruka @param {string} [detalj] */
  constructor(oznaka, poruka, detalj = "") {
    super(poruka);
    this.oznaka = oznaka;
    this.detalj = detalj;
  }
}

/** @param {any} e @returns {{ oznaka: string, poruka: string, detalj: string }} */
function javna(e) {
  if (e instanceof Greska) return { oznaka: e.oznaka, poruka: e.message, detalj: e.detalj };
  return {
    oznaka: "NEPOZNATO",
    poruka: "Nešto je pošlo po zlu pri obradi ove snimke.",
    detalj: e && e.message ? String(e.message).slice(0, 300) : "",
  };
}

/**
 * Greška iz Jave nosi yt-dlpov ispis u poruci. Odande se čita isto kao na
 * poslužitelju, istim pravilima.
 *
 * @param {any} e @param {string} zadano
 */
function prevedi(e, zadano) {
  if (e instanceof Greska) return e;
  const g = procitajGresku((e && e.message) || "", zadano);
  return new Greska(g.oznaka, g.poruka, g.detalj);
}

/* ---------- spremište ---------- */

/** @type {Promise<typeof import("./glazba-spremiste.mjs")> | null} */
let ucitano = null;
function spremiste() {
  if (!ucitano) ucitano = import("./glazba-spremiste.mjs");
  return ucitano;
}

/**
 * Pjesma koja u zbirci uređaja već stoji pod tom snimkom, i to **sa snimkom**:
 * redak u popisu bez zvuka ne vrijedi, jer ga `samoDostupno()` ionako ne
 * pokaže. Traži se i po `yt`, kao na poslužitelju.
 *
 * @param {string} oznaka
 */
async function izZbirke(oznaka) {
  const { dajPopis, oznakeSnimaka } = await spremiste();
  const [popis, ima] = await Promise.all([dajPopis(), oznakeSnimaka()]);
  const pjesme = (popis && popis.pjesme) || [];
  return (
    pjesme.find((/** @type {any} */ x) => ima.has(x.id) && (x.id === oznaka || x.yt === oznaka)) || null
  );
}

/**
 * Datoteka koju je Java ostavila u privremenoj mapi, kao `Blob`. Čita se kroz
 * Capacitorovu adresu za datoteke, a ne kroz most, jer bi most četiri
 * megabajta zvuka morao pretvoriti u tekst i natrag.
 *
 * @param {string} put @param {string} vrsta
 */
async function procitajDatoteku(put, vrsta) {
  const odgovor = await fetch(Capacitor.convertFileSrc(put));
  if (!odgovor.ok) throw new Error("Datoteka " + put + " se ne da pročitati (" + odgovor.status + ").");
  const bajtovi = await odgovor.arrayBuffer();
  return new Blob([bajtovi], { type: vrsta });
}

/* ---------- red čekanja ---------- */

/** @type {Map<string, any>} */
const poslovi = new Map();
/** @type {Set<(posao: any) => void>} */
const slusaci = new Set();
/** @type {any[]} */
const red = [];
let uTijeku = 0;
let brojac = 0;

/** Jedini oblik koji izlazi van, isti kao `snimak` na poslužitelju. @param {any} p */
const snimak = (p) => ({
  id: p.id,
  stanje: p.stanje,
  korak: p.korak,
  posto: Math.round(p.posto),
  naslov: p.naslov,
  kanal: p.kanal,
  trajanje: p.trajanje,
  kakvoca: p.kakvoca,
  oznaka: p.oznaka,
  pjesma: p.pjesma,
  greska: p.greska,
});

/** @param {any} p @param {any} promjena */
function javi(p, promjena) {
  Object.assign(p, promjena);
  const s = snimak(p);
  for (const slusac of slusaci) slusac(s);
}

/* Napredak stiže iz Jave za sve poslove jednim slušačem, kao što na
   poslužitelju stiže jednim tokom. */
domaci
  .addListener("napredak", (/** @type {any} */ n) => {
    const p = poslovi.get(n && n.posao);
    if (!p || p.prekinut) return;
    if (n.faza === "pretvaram") {
      if (p.stanje !== "pretvaram") {
        javi(p, { stanje: "pretvaram", korak: "Pretvaram u mp3", posto: MJERE.preuzeto });
      }
      return;
    }
    if (p.stanje === "preuzimam") {
      javi(p, { posto: Math.max(p.posto, stopi(n.posto, MJERE.podatci, MJERE.preuzeto)) });
    }
  })
  .catch(() => {
    /* bez napretka traka samo stoji, a posao se svejedno obavi */
  });

/**
 * Cijeli posao, od poveznice do pjesme u zbirci uređaja.
 * @param {any} p
 */
async function obavi(p) {
  try {
    javi(p, { stanje: "citam", korak: "Čitam podatke o snimci", posto: 2 });

    let o;
    try {
      o = JSON.parse((await domaci.podatci({ adresa: p.adresa })).json);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Greska("NEČITLJIVO", "yt-dlp je vratio nešto nečitljivo.");
      throw prevedi(e, "Ne mogu pročitati ovu snimku.");
    }
    if (p.prekinut) return;

    if (o.is_live) throw new Greska("UŽIVO", "Ovo se prenosi uživo, pa nema kraja za pretvoriti.");
    if (o.live_status === "is_upcoming") throw new Greska("NAJAVA", "Ova snimka još nije objavljena.");

    const trajanje = Number.isFinite(o.duration) ? o.duration : null;
    if (trajanje && trajanje > NAJDULJE_SEKUNDI) {
      throw new Greska("PREDUGO", "Snimka je dulja od " + Math.round(NAJDULJE_SEKUNDI / 3600) + " sata.");
    }

    const naslov = o.title || null;
    const kanal = o.uploader || o.channel || null;
    javi(p, { naslov, kanal, trajanje, stanje: "preuzimam", korak: "Preuzimam zvuk", posto: MJERE.podatci });

    let gotovo;
    try {
      gotovo = await domaci.preuzmi({
        posao: p.id,
        adresa: o.webpage_url || p.adresa,
        oznaka: p.oznaka,
        kakvoca: p.kakvoca,
      });
    } catch (e) {
      throw prevedi(e, "Preuzimanje nije uspjelo.");
    }
    if (p.prekinut) return;

    javi(p, { stanje: "pretvaram", korak: "Slažem u zbirku", posto: MJERE.pretvoreno });

    const snimka = await procitajDatoteku(gotovo.mp3, "audio/mpeg");
    /* Omot nije vrijedan prekida: bez njega Lucify crta slovo. */
    const omot = gotovo.omot ? await procitajDatoteku(gotovo.omot, "image/jpeg").catch(() => null) : null;

    /* Zapis istoga oblika kao `unos()` u `scripts/glazba-zbirka.mjs`. Ondje se
       naslov i izvođač čitaju iz oznaka u datoteci, a u njih ih je upisao
       preuzimač, iz ovih istih podataka; ovdje se uzimaju ravno odande. */
    const razdvojeno = rastavi(naslov || p.oznaka, kanal || "");
    const nova = {
      id: p.oznaka,
      naslov: razdvojeno.naslov,
      izvodac: razdvojeno.izvodac || "Nepoznat izvođač",
      datoteka: p.oznaka + ".mp3",
      trajanje: trajanje ? Math.round(trajanje) : 0,
      yt: p.oznaka,
      dodano: new Date().toISOString().slice(0, 10),
      izvorniNaslov: naslov || p.oznaka,
      razdoblje: "",
      biljeska: "",
      omot: omot ? "omoti/" + p.oznaka + ".jpg" : "",
      /* Ove pjesme na računalu nema, pa je nema ni u popisu koji stigne
         sljedećim uvozom. Po ovome je uvoz ne izbaci, a „Počisti” ne broji u
         višak. */
      naUredaju: true,
    };

    const { dodajPjesmu } = await spremiste();
    let pjesma;
    try {
      pjesma = await dodajPjesmu({ pjesma: nova, snimka, omot });
    } catch (e) {
      const puno = e && /quota/i.test(String(/** @type {any} */ (e).name || /** @type {any} */ (e).message || ""));
      throw puno
        ? new Greska("NEMA_MJESTA", "Na uređaju više nema mjesta za ovu pjesmu.")
        : new Greska("NE_SPREMA_SE", "Pjesma se nije dala spremiti u zbirku.", String(e && /** @type {any} */ (e).message || ""));
    }

    javi(p, {
      stanje: "gotovo",
      korak: "U zbirci",
      posto: 100,
      naslov: pjesma.naslov || naslov,
      kanal: pjesma.izvodac || kanal,
      trajanje: pjesma.trajanje || trajanje,
      pjesma,
    });
  } catch (e) {
    if (p.prekinut) return;
    javi(p, { stanje: "greska", korak: "Nije uspjelo", greska: javna(e) });
  } finally {
    domaci.pospremi({ posao: p.id }).catch(() => {});
  }
}

/** Koliko ih smije raditi, toliko ih i radi, pa opet kad se koji oslobodi. */
function guraj() {
  while (uTijeku < NAJVISE_ODJEDNOM && red.length > 0) {
    const p = red.shift();
    if (p.stanje !== "ceka") continue;
    uTijeku += 1;
    obavi(p).finally(() => {
      uTijeku -= 1;
      guraj();
    });
  }
}

/** @param {string} adresa @param {string} oznaka @param {string} kakvoca */
function novi(adresa, oznaka, kakvoca) {
  brojac += 1;
  const p = {
    id: "posao-" + Date.now().toString(36) + "-" + brojac,
    adresa,
    oznaka,
    kakvoca,
    stanje: "ceka",
    korak: "Čeka red",
    posto: 0,
    naslov: null,
    kanal: null,
    trajanje: null,
    pjesma: null,
    greska: null,
    prekinut: false,
  };
  poslovi.set(p.id, p);
  return p;
}

/* ---------- ono što vidi okvir ---------- */

/** @type {import("./glazba-preuzimac.mjs").Preuzimac} */
export const preuzimac = {
  async stanje() {
    const s = await domaci.stanje();
    const ima = Boolean(s && s.ytDlp);
    return {
      ima,
      /* ffmpeg dolazi u istoj knjižnici kao i yt-dlp, pa ga ima čim ima
         yt-dlpa. Inačica mu se ne ispisuje, jer je knjižnica ne kazuje. */
      alati: { ytDlp: { ima, inacica: (s && s.ytDlp) || "" }, ffmpeg: { ima, inacica: "" } },
      kakvoce: KAKVOCE,
      zadana: ZADANA_KAKVOCA,
    };
  },

  async osvjeziAlate() {
    try {
      await domaci.osvjezi();
      const s = await this.stanje();
      return { ok: true, alati: s.alati };
    } catch (e) {
      let alati;
      try {
        alati = (await this.stanje()).alati;
      } catch {
        alati = undefined;
      }
      return {
        ok: false,
        alati,
        greska: {
          oznaka: "ALATI",
          poruka: "Nov yt-dlp nije stigao.",
          detalj: e && /** @type {any} */ (e).message ? String(/** @type {any} */ (e).message).slice(0, 300) : "",
        },
      };
    }
  },

  async pretvori({ veze, kakvoca }) {
    const procitano = procitajVeze(String(veze || ""));
    const odbijene = procitano.greske.map((/** @type {any} */ g) => ({ upisano: g.upisano, razlog: g.razlog }));

    if (procitano.prihvacene.length === 0) {
      return {
        ok: false,
        greska: {
          oznaka: "LOŠA_VEZA",
          poruka: procitano.greske[0] ? procitano.greske[0].razlog : "Zalijepi barem jednu poveznicu s YouTubea.",
        },
        odbijene,
      };
    }
    if (procitano.prihvacene.length > NAJVISE_ODJEDNOM_POSLANO) {
      return {
        ok: false,
        greska: {
          oznaka: "PREVIŠE",
          poruka:
            "To je " + procitano.prihvacene.length + " poveznica, a odjednom ih ide najviše " +
            NAJVISE_ODJEDNOM_POSLANO + ".",
        },
      };
    }
    const izbor = String(kakvoca || ZADANA_KAKVOCA);
    if (!KAKVOCE.some((k) => k.id === izbor)) {
      return { ok: false, greska: { oznaka: "KAKVOĆA", poruka: "Takve kakvoće nema među ponuđenima." } };
    }

    const napravljeni = [];
    for (const v of procitano.prihvacene) {
      const posao = novi(v.adresa, v.oznaka, izbor);
      /* Ista snimka drugi put ne preuzima se iznova. Ni ona koja se upravo
         preuzima: dva ista posla pisala bi istu pjesmu dvaput. */
      const vec = await izZbirke(v.oznaka);
      const radi = [...poslovi.values()].some(
        (x) => x !== posao && x.oznaka === v.oznaka && ["ceka", "citam", "preuzimam", "pretvaram"].includes(x.stanje),
      );
      if (vec) {
        javi(posao, {
          stanje: "vec",
          korak: "Već u zbirci",
          posto: 100,
          naslov: vec.naslov,
          kanal: vec.izvodac,
          trajanje: vec.trajanje,
          pjesma: vec,
        });
      } else if (radi) {
        poslovi.delete(posao.id);
        continue;
      } else {
        red.push(posao);
        javi(posao, {});
      }
      napravljeni.push(posao);
    }
    guraj();

    return { ok: true, poslovi: napravljeni.map(snimak), odbijene, ponovljene: procitano.ponovljene };
  },

  prati(naPromjenu) {
    /* Najprije zatečeno stanje, da okvir koji se upravo otvorio sustigne ono
       što je propustio, isto kao tok događaja na poslužitelju. */
    for (const p of poslovi.values()) naPromjenu(snimak(p));
    slusaci.add(naPromjenu);
    return () => {
      slusaci.delete(naPromjenu);
    };
  },

  odustani(id) {
    const p = poslovi.get(id);
    if (!p || ["gotovo", "vec", "greska", "prekinuto"].includes(p.stanje)) return;
    p.prekinut = true;
    javi(p, { stanje: "prekinuto", korak: "Prekinuto" });
    domaci.odustani({ posao: id }).catch(() => {});
  },

  zaboravi(id) {
    const p = poslovi.get(id);
    /* Zaboravlja se samo redak u okviru. Pjesma u zbirci ostaje. */
    if (p && !["ceka", "citam", "preuzimam", "pretvaram"].includes(p.stanje)) poslovi.delete(id);
  },

  poruke: {
    nedostupan: "Preuzimač se ne javlja. Zatvori Lucify i otvori ga opet.",
    nedohvatljiv: "Preuzimač nije primio posao. Pokušaj opet.",
  },
};

/* ---------- podijeljeno iz druge aplikacije ---------- */

/**
 * Poveznica podijeljena iz YouTubea ili preglednika („Dijeli” → Lucify).
 *
 * Stiže dvama putovima. Kad je Lucify već bio otvoren, Java javi događajem.
 * Kad ga je tek dijeljenje otvorilo, događaj bi otišao prije nego što ga itko
 * sluša, pa Java poveznicu čuva, a ovdje se pokupi jednom, pri prijavi.
 *
 * @param {(tekst: string) => void} naTekst
 * @returns {() => void} odjava
 */
export function naPodijeljeno(naTekst) {
  let ziv = true;
  /** @type {{ remove: () => void } | null} */
  let slusac = null;
  domaci
    .addListener("podijeljeno", (/** @type {any} */ d) => {
      if (ziv && d && d.tekst) naTekst(String(d.tekst));
    })
    .then((s) => {
      if (ziv) slusac = s;
      else s.remove();
    })
    .catch(() => {});
  domaci
    .uzmiPodijeljeno()
    .then((d) => {
      if (ziv && d && d.tekst) naTekst(String(d.tekst));
    })
    .catch(() => {});
  return () => {
    ziv = false;
    if (slusac) slusac.remove();
  };
}
