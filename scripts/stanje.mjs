/*
 * Srca, vlastiti popisi i premještene pjesme, u datoteci uz zbirku.
 *
 * Dosad su stajali samo u `localStorage` stranice, a to se u namjenskoj
 * aplikaciji pokazalo krhkim: Chromium svoju bazu zna obrisati i složiti
 * iznova, a s njom odu i popisi. Nadogradnja 1.0.8 odnijela je tako sve
 * popise, iako na njih nitko nije ni pipnuo.
 *
 * Datoteka stoji uz zbirku, kao i `.lucify-izvoz.json`, jer popisi pokazuju
 * na pjesme **te** zbirke: promijeni li se mapa zbirke, s njom se mijenjaju i
 * pjesme, pa i popisi. Tako je dijele i `.exe` i `npm run dev`, koji gledaju
 * istu zbirku.
 *
 * `localStorage` ostaje, i dalje brz i prvi pri otvaranju. Stranica ga po
 * dolasku datoteke spoji s njom (vidi `spojiStanje` u `src/glazba-liste.mjs`),
 * pa prazan `localStorage` datoteku ne može isprazniti.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Ime datoteke u korijenu zbirke. */
const IME = ".lucify-stanje.json";

/** Gornja mjera tijela zahtjeva. Tisuću popisa po sto pjesama stane u pola ove mjere. */
const NAJVISE = 4 * 1024 * 1024;

/**
 * Stanje s diska, ili `null` kad ga još nema ili se ne da pročitati.
 *
 * @param {string} korijen mapa u kojoj stoji `Glazba/Zvuk`
 * @returns {{ srca?: string[], liste?: { id: string, naslov: string, pjesme: string[] }[], jezici?: Record<string, string> } | null}
 */
export function procitajStanje(korijen) {
  const put = join(korijen, IME);
  if (!existsSync(put)) return null;
  try {
    return ocisti(JSON.parse(readFileSync(put, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Zadrži samo ono što stanje smije nositi, i u obliku koji stranica očekuje.
 *
 * @param {any} s
 */
function ocisti(s) {
  if (!s || typeof s !== "object") return null;
  /** @type {{ srca?: string[], liste?: { id: string, naslov: string, pjesme: string[] }[], jezici?: Record<string, string> }} */
  const van = {};
  if (Array.isArray(s.srca)) van.srca = s.srca.filter((/** @type {any} */ x) => typeof x === "string");
  if (Array.isArray(s.liste)) {
    van.liste = s.liste
      .filter(
        (/** @type {any} */ l) =>
          l && typeof l.id === "string" && typeof l.naslov === "string" && Array.isArray(l.pjesme),
      )
      .map((/** @type {any} */ l) => ({
        id: l.id,
        naslov: l.naslov,
        pjesme: l.pjesme.filter((/** @type {any} */ p) => typeof p === "string"),
      }));
  }
  if (s.jezici && typeof s.jezici === "object" && !Array.isArray(s.jezici)) {
    van.jezici = Object.fromEntries(
      Object.entries(s.jezici).filter(([, v]) => typeof v === "string"),
    );
  }
  return van;
}

/**
 * Traži li to naša stranica, a ne neka tuđa.
 *
 * Poslužitelj sluša samo na `127.0.0.1`, ali do njega dopire i svaka stranica
 * otvorena u pregledniku na istom računalu. `Host` čuva od podmetnute adrese
 * (DNS rebinding), a `Origin`, kad ga ima, od tuđe stranice koja šalje ovamo.
 *
 * @param {any} req
 */
function nasZahtjev(req) {
  const lokalno = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
  if (!lokalno.test(String(req.headers.host || ""))) return false;
  const odakle = req.headers.origin;
  return !odakle || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(odakle));
}

/**
 * Rukovatelj za `/stanje`: `GET` ga čita, `PUT` zapisuje cijelo.
 *
 * Zapisuje se u privremenu datoteku pa preimenuje, a ne ravno preko stare:
 * prekine li se pisanje na pola, stara ostaje cijela.
 *
 * @param {string} korijen
 */
export function stanjeRukovatelj(korijen) {
  const put = join(korijen, IME);

  return function stanje(/** @type {any} */ req, /** @type {any} */ res, /** @type {() => void} */ dalje) {
    if ((req.url || "").split("?")[0] !== "/stanje") {
      dalje();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    if (!nasZahtjev(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }

    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ stanje: procitajStanje(korijen) }));
      return;
    }

    if (req.method === "PUT") {
      /* Samo JSON: preglednik tuđoj stranici takav zahtjev ne pusti bez
         pitanja unaprijed, a na to pitanje ovaj poslužitelj ne odgovara. */
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) {
        res.statusCode = 415;
        res.end();
        return;
      }
      /** @type {Buffer[]} */
      const komadi = [];
      let duljina = 0;
      req.on("data", (/** @type {Buffer} */ k) => {
        duljina += k.length;
        if (duljina > NAJVISE) {
          res.statusCode = 413;
          res.end();
          req.destroy();
          return;
        }
        komadi.push(k);
      });
      req.on("end", () => {
        if (res.writableEnded) return;
        let novo;
        try {
          novo = ocisti(JSON.parse(Buffer.concat(komadi).toString("utf8")));
        } catch {
          novo = null;
        }
        if (!novo) {
          res.statusCode = 400;
          res.end();
          return;
        }
        try {
          const staro = procitajStanje(korijen);
          /* Datoteka koja postoji, a ne da se pročitati, ne prepisuje se nego
             makne u stranu: u njoj su možda nečiji popisi, a pisanje ide preko
             privremene datoteke, pa se ovo ne bi smjelo dogoditi samo od sebe. */
          if (!staro && existsSync(put)) renameSync(put, put + ".pokvareno-" + Date.now());
          /* Ključ koji zahtjev ne nosi ostaje kakav je bio. */
          const spojeno = { ...(staro || {}), ...novo };
          const privremena = put + ".novo";
          writeFileSync(privremena, JSON.stringify(spojeno, null, 1) + "\n", "utf8");
          renameSync(privremena, put);
          res.statusCode = 204;
          res.end();
        } catch (e) {
          res.statusCode = 500;
          res.end(String((e && /** @type {any} */ (e).message) || e));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end();
  };
}

/**
 * Isti rukovatelj kao dodatak za Vite, samo za `npm run dev`.
 *
 * @param {string} korijen
 */
export function stanjeNaRazvoju(korijen) {
  return {
    name: "stanje-na-razvoju",
    apply: /** @type {"serve"} */ ("serve"),
    /** @param {any} server */
    configureServer(server) {
      server.middlewares.use(stanjeRukovatelj(korijen));
    },
  };
}
