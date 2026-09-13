/**
 * Preuzimač: iz poveznice s YouTubea u zbirku Lucifyja.
 *
 * Stoji na razvojnom poslužitelju, uz `apply: "serve"` u `vite.config.js`, s
 * adrese `/preuzmi/`. Na objavljenoj stranici ga nema, i to je jedino ispravno:
 * ondje ne bi imao ni yt-dlp, ni ffmpeg, ni mapu u koju bi spremio, jer
 * `Glazba/Zvuk/` nije u gitu.
 *
 * Gotova pjesma ide **ravno u zbirku**, kao `<oznaka>.mp3`, i odmah u
 * `popis.json`. Zato se pojavi u „Sve pjesme” i ostane ondje: popis je na disku,
 * a ne u pregledniku.
 *
 * Napredovanje svih poslova ide **jednim** tokom događaja, a ne jednim po
 * poslu, jer preglednik na isto ime domaćina drži najviše šest veza, pa bi kod
 * većega popisa zadnji poslovi zašutjeli.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { procitajVeze } from "../src/glazba-veze.mjs";
import { dohvatiYtDlp } from "./alati.mjs";
import { dodajUPopis, putovi, ukloniIzPopisa } from "./glazba-zbirka.mjs";
import { Greska, javna, provjeriAlate, zaboraviAlate } from "./preuzimac-alati.mjs";
import { KAKVOCE, ZADANA_KAKVOCA, kakvoca, podatci, uMp3, zvuk } from "./preuzimac-posao.mjs";

/** Koliko ih se pretvara istodobno. Ostali čekaju red. */
const NAJVISE_ODJEDNOM = 3;
/** Koliko poveznica prima jedno slanje, da promašeno lijepljenje ne pokrene stotine. */
const NAJVISE_ODJEDNOM_POSLANO = 20;
/** Dulje od ovoga ne preuzimamo, da se disk ne napuni greškom. */
const NAJDULJE_SEKUNDI = 4 * 60 * 60;
/** Nedovršen posao koji toliko traje otpisuje se. Gotovi se ne diraju. */
const ROK = 20 * 60 * 1000;

/* Postotci dvaju dugih koraka slažu se u jedan, da traka nikad ne ide unatrag. */
const MJERE = { podatci: 5, preuzeto: 70, pretvoreno: 99 };

/** @param {number} p @param {number} od @param {number} do_ */
function stopi(p, od, do_) {
  const c = Math.max(0, Math.min(100, Number(p) || 0));
  return od + (c / 100) * (do_ - od);
}

/**
 * Preuzimač za jednu mapu projekta. Sve stanje je u ovoj zatvorenoj funkciji,
 * pa ponovno pokretanje poslužitelja počinje s čistim popisom poslova.
 *
 * @param {string} korijen
 */
function napravi(korijen) {
  /** @type {Map<string, any>} */
  const poslovi = new Map();
  const glasnik = new EventEmitter();
  glasnik.setMaxListeners(0);
  const radnaMapa = join(tmpdir(), "lucijanka-preuzimanje");
  /** @type {any[]} */
  const red = [];
  let uTijeku = 0;

  /* Ostatci prošloga pokretanja. Vite se ponovno pokrene na svaku izmjenu
     postavaka, pa ovih mapa zna ostati. */
  rmSync(radnaMapa, { recursive: true, force: true });
  mkdirSync(radnaMapa, { recursive: true });

  /** Jedini oblik koji izlazi iz poslužitelja. @param {any} p */
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
  const javi = (p, promjena) => {
    Object.assign(p, promjena);
    glasnik.emit("promjena", snimak(p));
  };

  /** @param {any} p */
  const pospremi = (p) => {
    if (p.pospremljeno) return;
    p.pospremljeno = true;
    try {
      rmSync(p.mapa, { recursive: true, force: true });
    } catch {
      /* metla će to pokupiti */
    }
  };

  /**
   * Cijeli posao, od poveznice do retka u popisu.
   * @param {any} p
   */
  async function obavi(p) {
    const znak = p.prekidac.signal;
    const { zbirka } = putovi(korijen);

    try {
      mkdirSync(p.mapa, { recursive: true });

      javi(p, { stanje: "citam", korak: "Čitam podatke o snimci", posto: 2 });
      const o = await podatci(korijen, p.adresa, { znak });

      if (o.trajanje && o.trajanje > NAJDULJE_SEKUNDI) {
        throw new Greska(
          "PREDUGO",
          "Snimka je dulja od " + Math.round(NAJDULJE_SEKUNDI / 3600) + " sata.",
        );
      }

      javi(p, {
        naslov: o.naslov,
        kanal: o.kanal,
        trajanje: o.trajanje,
        stanje: "preuzimam",
        korak: "Preuzimam zvuk",
        posto: MJERE.podatci,
      });

      const izvor = await zvuk(korijen, p.adresa, {
        mapa: p.mapa,
        znak,
        naNapredak: (n) => javi(p, { posto: stopi(n, MJERE.podatci, MJERE.preuzeto) }),
      });

      javi(p, {
        stanje: "pretvaram",
        korak: "Pretvaram u mp3",
        posto: MJERE.preuzeto,
      });

      const mp3 = join(p.mapa, "izlaz.mp3");
      await uMp3(korijen, {
        ulaz: izvor,
        izlaz: mp3,
        trajanje: o.trajanje,
        kakvoca: p.kakvoca,
        oznake: {
          title: o.naslov || undefined,
          artist: o.kanal || undefined,
          /* Adresa u komentaru nije ukras: iz nje se poslije čita oznaka
             snimke, a po njoj se dohvaća omot. */
          comment: o.adresa,
        },
        znak,
        naNapredak: (n) => javi(p, { posto: stopi(n, MJERE.preuzeto, MJERE.pretvoreno) }),
      });

      javi(p, { korak: "Slažem u zbirku", posto: MJERE.pretvoreno });

      /* Ime datoteke je oznaka snimke, kako i cijela zbirka stoji. */
      const ime = p.oznaka + ".mp3";
      preseli(mp3, join(zbirka, ime));
      const pjesma = await dodajUPopis(korijen, ime, p.oznaka);

      javi(p, {
        stanje: "gotovo",
        korak: "U zbirci",
        posto: 100,
        naslov: pjesma.naslov || o.naslov,
        kanal: pjesma.izvodac || o.kanal,
        trajanje: pjesma.trajanje || o.trajanje,
        pjesma,
      });
      pospremi(p);
    } catch (e) {
      if (p.prekidac.signal.aborted) return;
      javi(p, { stanje: "greska", korak: "Nije uspjelo", greska: javna(e) });
      pospremi(p);
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

  /**
   * Pjesma koja u zbirci već stoji pod tom snimkom, da se u okviru ne pojavi
   * gola oznaka. Traži se i po `yt`, a ne samo po imenu: pjesma unesena iz mape
   * zove se po naslovu, a poveznicu joj je poslije našao `npm run youtube`.
   * @param {string} oznaka
   */
  function izPopisa(oznaka) {
    const { popisPut } = putovi(korijen);
    try {
      const popis = JSON.parse(readFileSync(popisPut, "utf8"));
      const pjesme = popis.pjesme || [];
      return (
        pjesme.find((/** @type {any} */ x) => x.id === oznaka) ||
        pjesme.find((/** @type {any} */ x) => x.yt === oznaka) ||
        null
      );
    } catch {
      return null;
    }
  }

  /** @param {string} adresa @param {string} oznaka @param {string} izbor */
  function novi(adresa, oznaka, izbor) {
    const id = randomUUID();
    const p = {
      id,
      adresa,
      oznaka,
      kakvoca: izbor,
      stanje: "ceka",
      korak: "Čeka red",
      posto: 0,
      naslov: null,
      kanal: null,
      trajanje: null,
      pjesma: null,
      greska: null,
      kad: Date.now(),
      mapa: join(radnaMapa, id),
      prekidac: new AbortController(),
      pospremljeno: false,
    };
    poslovi.set(id, p);
    return p;
  }

  /* Nedovršeni poslovi koji predugo traju. Gotovi ostaju, jer je iza njih
     prava datoteka u zbirci. */
  const metla = setInterval(() => {
    const sad = Date.now();
    for (const p of [...poslovi.values()]) {
      if (p.stanje === "gotovo" || p.stanje === "vec") continue;
      if (sad - p.kad > ROK) {
        p.prekidac.abort();
        pospremi(p);
        poslovi.delete(p.id);
      }
    }
  }, 60 * 1000);
  if (metla.unref) metla.unref();

  return { poslovi, glasnik, snimak, javi, pospremi, guraj, izPopisa, novi, red };
}

/**
 * Premjesti gotovu datoteku u zbirku. `rename` ne radi preko dvaju diskova, a
 * radna mapa je u sustavskom „temp”, koji zna biti drugdje, pa je kopiranje
 * zamjena kad prvo ne prođe.
 *
 * @param {string} odakle @param {string} kamo
 */
function preseli(odakle, kamo) {
  try {
    renameSync(odakle, kamo);
  } catch {
    copyFileSync(odakle, kamo);
    rmSync(odakle, { force: true });
  }
}

/* ---------- adrese ---------- */

/** @param {any} res @param {number} kod @param {any} tijelo */
function posalji(res, kod, tijelo) {
  res.statusCode = kod;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(tijelo));
}

/** Pročita tijelo zahtjeva, uz gornju među, da nitko ne pošalje megabajt. @param {any} req */
function tijelo(req) {
  return new Promise((gotovo) => {
    let tekst = "";
    req.on("data", (/** @type {any} */ komad) => {
      tekst += komad;
      if (tekst.length > 16000) {
        tekst = "";
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        gotovo(JSON.parse(tekst || "{}"));
      } catch {
        gotovo({});
      }
    });
    req.on("error", () => gotovo({}));
  });
}

/**
 * Rukovatelj za adrese pod `/preuzmi/`. Isti ga uzimaju Vite na `npm run dev` i
 * mali poslužitelj namjenske aplikacije, pa red čekanja i poslovi žive na
 * jednome mjestu.
 *
 * Mapa projekta dolazi izvana, a ne iz `import.meta.url`, jer ova datoteka
 * prolazi kroz `vite.config.js`, koji se prije pokretanja spoji u privremenu
 * datoteku na drugom mjestu.
 *
 * @param {string} korijen
 */
export function preuzimacRukovatelj(korijen) {
  const p = napravi(korijen);

  return async function preuzmi(/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) {
    /* Putanja se uspoređuje ovdje, a ne kroz `use("/preuzmi", ...)`, jer
       connect uspoređuje ne razlikujući velika i mala slova. Ista je zamka
       kod `/glazba/` progutala mapu `Glazba/`. */
    const puna = decodeURIComponent((req.url || "").split("?")[0]);
    if (puna.slice(0, 9) !== "/preuzmi/") {
      next();
      return;
    }
    const staza = puna.slice(9);
    const upit = new URLSearchParams((req.url || "").split("?")[1] || "");

    if (staza === "stanje") {
      const alati = await provjeriAlate(korijen);
      posalji(res, 200, {
        ima: alati.ytDlp.ima && alati.ffmpeg.ima,
        alati,
        kakvoce: Object.values(KAKVOCE).map((k) => ({ id: k.id, ime: k.ime, opis: k.opis })),
        zadana: ZADANA_KAKVOCA,
      });
      return;
    }

    /*
     * Noviji yt-dlp, iz samoga Lucifyja.
     *
     * yt-dlp izlazi gotovo svaki tjedan, a stariji prestane raditi čim YouTube
     * promijeni svirač. Zapakirani primjerak zato zastari, a stoji u
     * `Program Files`, kamo se ne piše. Novi se zato spušta u `alati/` unutar
     * mape zbirke, koja je u korisnikovoj mapi i piše se.
     *
     * `YTDLP_PATH` se odmah preusmjeri na nov program, jer je on prvi na
     * popisu u `nadiYtDlp()`: bez toga bi se i dalje pokretao stari, sve do
     * ponovnog pokretanja Lucifyja.
     *
     * `zaboraviAlate()` uz to mora pasti, i to je ovdje cijela bit. Nađeni se
     * alat pamti, jer se traži pokretanjem, a to traje; bez brisanja bi se i
     * dalje vrtio **stari program sa zapamćene putanje**, pa bi osvježavanje
     * izvana izgledalo kao da je prošlo, a ne bi promijenilo ništa.
     */
    if (staza === "alati" && req.method === "POST") {
      try {
        const ishod = await dohvatiYtDlp({ mapa: join(korijen, "alati"), osvjezi: true });
        process.env.YTDLP_PATH = ishod.put;
        zaboraviAlate();
        posalji(res, 200, {
          ishod: { inacica: ishod.inacica, mb: ishod.mb },
          alati: await provjeriAlate(korijen),
        });
      } catch (e) {
        posalji(res, 502, {
          greska: {
            oznaka: "ALATI",
            poruka: "Nov yt-dlp nije stigao.",
            detalj: e && e.message ? String(e.message).slice(0, 300) : "",
          },
          alati: await provjeriAlate(korijen),
        });
      }
      return;
    }

    if (staza === "dogadaji") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      /** @param {any} stanje */
      const salji = (stanje) => res.write("data: " + JSON.stringify(stanje) + "\n\n");
      /* Najprije zatečeno stanje, da stranica koja se upravo otvorila
         sustigne ono što je propustila. */
      for (const posao of p.poslovi.values()) salji(p.snimak(posao));
      const otkucaj = setInterval(() => res.write(": kuc\n\n"), 15000);
      if (otkucaj.unref) otkucaj.unref();
      p.glasnik.on("promjena", salji);
      req.on("close", () => {
        clearInterval(otkucaj);
        p.glasnik.off("promjena", salji);
      });
      return;
    }

    if (staza === "pretvori" && req.method === "POST") {
      const zahtjev = /** @type {any} */ (await tijelo(req));
      const procitano = procitajVeze(String(zahtjev.veze || ""));

      if (procitano.prihvacene.length === 0) {
        posalji(res, 400, {
          greska: {
            oznaka: "LOŠA_VEZA",
            poruka: procitano.greske[0]
              ? procitano.greske[0].razlog
              : "Zalijepi barem jednu poveznicu s YouTubea.",
          },
          odbijene: procitano.greske.map((/** @type {any} */ g) => ({
            upisano: g.upisano,
            razlog: g.razlog,
          })),
        });
        return;
      }

      if (procitano.prihvacene.length > NAJVISE_ODJEDNOM_POSLANO) {
        posalji(res, 400, {
          greska: {
            oznaka: "PREVIŠE",
            poruka:
              "To je " +
              procitano.prihvacene.length +
              " poveznica, a odjednom ih ide najviše " +
              NAJVISE_ODJEDNOM_POSLANO +
              ".",
          },
        });
        return;
      }

      const izbor = String(zahtjev.kakvoca || ZADANA_KAKVOCA);
      if (!kakvoca(izbor)) {
        posalji(res, 400, {
          greska: { oznaka: "KAKVOĆA", poruka: "Takve kakvoće nema među ponuđenima." },
        });
        return;
      }

      const alati = await provjeriAlate(korijen);
      if (!alati.ytDlp.ima || !alati.ffmpeg.ima) {
        const fali = [!alati.ytDlp.ima && "yt-dlp", !alati.ffmpeg.ima && "ffmpeg"].filter(Boolean);
        posalji(res, 503, {
          greska: {
            oznaka: "NEMA_ALATA",
            poruka: "Nedostaje " + fali.join(" i ") + ".",
            detalj: [alati.ytDlp.savjet, alati.ffmpeg.savjet].filter(Boolean).join(" | "),
          },
        });
        return;
      }

      const { zbirka } = putovi(korijen);
      const napravljeni = procitano.prihvacene.map((/** @type {any} */ v) => {
        const posao = p.novi(v.adresa, v.oznaka, izbor);
        /* Ista snimka drugi put ne preuzima se iznova: ime datoteke je
           oznaka snimke, pa se odmah vidi da je već ovdje. */
        const vec = p.izPopisa(v.oznaka);
        const datoteka = vec && vec.datoteka ? vec.datoteka : v.oznaka + ".mp3";
        if (existsSync(join(zbirka, datoteka))) {
          p.javi(posao, {
            stanje: "vec",
            korak: "Već u zbirci",
            posto: 100,
            naslov: vec ? vec.naslov : null,
            kanal: vec ? vec.izvodac : null,
            trajanje: vec ? vec.trajanje : null,
            pjesma: vec,
          });
          return posao;
        }
        p.red.push(posao);
        return posao;
      });
      p.guraj();

      posalji(res, 202, {
        poslovi: napravljeni.map(p.snimak),
        odbijene: procitano.greske.map((/** @type {any} */ g) => ({
          upisano: g.upisano,
          razlog: g.razlog,
        })),
        ponovljene: procitano.ponovljene,
      });
      return;
    }

    if (staza === "odustani" && req.method === "POST") {
      const posao = p.poslovi.get(upit.get("id") || "");
      if (!posao) {
        posalji(res, 404, { greska: { oznaka: "NEMA_POSLA", poruka: "Toga posla više nema." } });
        return;
      }
      if (posao.stanje !== "gotovo" && posao.stanje !== "vec" && posao.stanje !== "greska") {
        posao.prekidac.abort();
        p.javi(posao, { stanje: "prekinuto", korak: "Prekinuto" });
        p.pospremi(posao);
        p.guraj();
      }
      posalji(res, 200, p.snimak(posao));
      return;
    }

    /* Pjesma van iz zbirke, s diska. Stoji uz preuzimač, a ne uz posluživanje,
       jer je njegov par: što se ovdje ukloni, vraća se samo ponovnim dodavanjem
       poveznice. */
    if (staza === "ukloni" && req.method === "POST") {
      const id = upit.get("id") || "";
      const uTijeku = [...p.poslovi.values()].some(
        (x) => x.oznaka === id && ["ceka", "citam", "preuzimam", "pretvaram"].includes(x.stanje),
      );
      if (uTijeku) {
        posalji(res, 409, {
          greska: { oznaka: "U_TIJEKU", poruka: "Ta se pjesma upravo preuzima." },
        });
        return;
      }
      try {
        const uklonjena = ukloniIzPopisa(korijen, id);
        if (!uklonjena) {
          posalji(res, 404, { greska: { oznaka: "NEMA_PJESME", poruka: "Te pjesme nema u zbirci." } });
          return;
        }
        /* Redak u okviru „Dodaj pjesmu” više ne govori istinu, pa odlazi. */
        for (const x of [...p.poslovi.values()]) {
          if (x.oznaka === id || (uklonjena.yt && x.oznaka === uklonjena.yt)) p.poslovi.delete(x.id);
        }
        posalji(res, 200, { ok: true, id });
      } catch (e) {
        posalji(res, 500, {
          greska: {
            oznaka: "NE_BRISE_SE",
            poruka: "Pjesma se nije dala ukloniti.",
            detalj: e && e.message ? String(e.message).slice(0, 300) : "",
          },
        });
      }
      return;
    }

    if (staza === "zaboravi" && req.method === "POST") {
      const posao = p.poslovi.get(upit.get("id") || "");
      /* Zaboravlja se samo redak u okviru. Datoteka u zbirci ostaje. */
      if (posao && posao.stanje !== "citam" && posao.stanje !== "preuzimam" && posao.stanje !== "pretvaram") {
        p.poslovi.delete(posao.id);
      }
      posalji(res, 200, { ok: true });
      return;
    }

    next();
  };
}

/**
 * Isti rukovatelj, zapakiran kao dodatak za Vite. Uz `apply: "serve"` živi samo
 * na `npm run dev`: u objavljenom buildu iza njega nema ni yt-dlpa ni ffmpega,
 * pa ondje tipke „Dodaj pjesmu” ni nema. Namjenska aplikacija je iznimka: ona
 * oba programa ima uza se, pa isti rukovatelj ondje vrti vlastiti poslužitelj.
 *
 * @param {string} korijen
 */
export function preuzimacNaRazvoju(korijen) {
  return {
    name: "preuzimac-na-razvoju",
    apply: /** @type {"serve"} */ ("serve"),
    configureServer(/** @type {any} */ server) {
      server.middlewares.use(preuzimacRukovatelj(korijen));
    },
  };
}
