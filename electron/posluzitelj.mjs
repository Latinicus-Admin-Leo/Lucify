/*
 * Mali poslužitelj namjenske aplikacije.
 *
 * Prozor ne otvara `dist/index.html` s `file://` nego stranicu s ovoga
 * poslužitelja, i to zato što zvuk traži `Range`: s `file://` preglednik ne
 * može zatražiti dio datoteke, pa se u pjesmi ne da skočiti na sredinu, a
 * svaka bi se skočena sekunda preuzela iznova. Uz to `fetch` na `file://` ne
 * radi, a upravo njime Lucify dohvaća popis.
 *
 * Sluša samo na `127.0.0.1`, i to na luci koju mu dodijeli sustav: aplikacija
 * ne otvara ništa prema mreži.
 */

import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { zbirkaRukovatelj } from "../scripts/posluga.mjs";
import { preuzimacRukovatelj } from "../scripts/preuzimac.mjs";

/** Vrste sadržaja za ono što izađe iz `vite build`. */
const VRSTE = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/**
 * @param {object} opcije
 * @param {string} opcije.dist mapa s gotovim buildom
 * @param {string} opcije.zbirka mapa u kojoj stoji `Glazba/Zvuk` i `alati/`
 * @returns {Promise<{ adresa: string, zatvori: () => void }>}
 */
export function pokreniPosluzitelj({ dist, zbirka }) {
  const glazba = zbirkaRukovatelj(zbirka);
  const preuzmi = preuzimacRukovatelj(zbirka);

  const posluzitelj = http.createServer((req, res) => {
    /* Redom: zbirka, preuzimač, pa gotov build. Prva dvojica sama proslijede
       dalje ono što nije njihovo, istim `next()` dogovorom kao u Viteu. */
    glazba(req, res, () => {
      Promise.resolve(preuzmi(req, res, () => posluziBuild(dist, req, res))).catch((greska) => {
        res.statusCode = 500;
        res.end(String((greska && greska.message) || greska));
      });
    });
  });

  return new Promise((vrati, odbij) => {
    posluzitelj.on("error", odbij);
    /* Luka 0 znači „daj bilo koju slobodnu”: tako se dva otvorena Lucifyja ne
       sudaraju, a ni s bilo čime drugim na računalu. */
    posluzitelj.listen(0, "127.0.0.1", () => {
      const na = /** @type {any} */ (posluzitelj.address());
      vrati({
        adresa: "http://127.0.0.1:" + na.port + "/",
        zatvori: () => posluzitelj.close(),
      });
    });
  });
}

/**
 * Datoteka iz `dist/`. Sve što ne postoji vraća se kao `index.html`, jer je
 * Lucify jedna stranica.
 *
 * @param {string} dist @param {any} req @param {any} res
 */
function posluziBuild(dist, req, res) {
  const puna = decodeURIComponent((req.url || "/").split("?")[0]);
  const trazeno = path.normalize(puna === "/" ? "/index.html" : puna).replace(/^[/\\]+/, "");
  let put = path.join(dist, trazeno);
  /* `startsWith` čuva od `../`, kao i kod zbirke. */
  if (!put.startsWith(dist) || !existsSync(put) || !statSync(put).isFile()) {
    put = path.join(dist, "index.html");
  }
  if (!existsSync(put)) {
    res.statusCode = 404;
    res.end("Nema gotovoga builda. Pokreni `npm run build:namjenska`.");
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", VRSTE[path.extname(put).toLowerCase()] || "application/octet-stream");
  createReadStream(put).pipe(res);
}
