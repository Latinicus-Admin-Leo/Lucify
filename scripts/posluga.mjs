/*
 * Posluživanje glazbene zbirke s adrese `/glazba/`.
 *
 * Stoji ovdje, a ne u `vite.config.js`, jer istu zbirku poslužuju dvoje: Vite
 * na `npm run dev` i mali poslužitelj namjenske aplikacije u `electron/`.
 * Raspon (`Range`) ispod nije sitnica, pa se ne smije prepisivati dvaput.
 */

import path from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";

/** Vrsta sadržaja po nastavku. Zbirka ima samo tri vrste datoteka. */
const VRSTE = {
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
};

/**
 * Zbirka stoji u `Glazba/Zvuk/`, izvan `public/`, jer Vite sve iz `public/`
 * prepisuje u `dist/`, pa bi svaki build uzalud kopirao šest stotina megabajta
 * glazbe koja je tuđe autorsko djelo i nikamo se ne objavljuje.
 *
 * Zahtjev s rasponom (`Range`) mora se poštovati, inače se u pjesmi ne može
 * skočiti na sredinu: preglednik za pomak traži samo dio datoteke, a poslužitelj
 * koji uvijek vrati cijelu prisili ga da je preuzme iznova.
 *
 * @param {string} korijen mapa u kojoj stoji `Glazba/Zvuk`
 */
export function zbirkaRukovatelj(korijen) {
  const zvuk = path.resolve(korijen, "Glazba", "Zvuk");

  /** @param {any} req @param {any} res @param {() => void} dalje */
  return function posluzi(req, res, dalje) {
    /* Putanja se uspoređuje ovdje, a ne kroz `use("/glazba", ...)`, jer
       connect uspoređuje **ne razlikujući velika i mala slova**, pa bi
       `/glazba` uhvatio i svaku drugu putanju koja tako počinje. U
       Lucijankici je upravo to jednom srušilo cijelu stranicu. */
    const puna = decodeURIComponent((req.url || "").split("?")[0]);
    if (puna.slice(0, 8) !== "/glazba/") {
      dalje();
      return;
    }
    const trazeno = puna.slice(7);
    /* Bez ovoga bi `/glazba/../../..` izašao iz mape. */
    const put = path.join(zvuk, path.normalize(trazeno).replace(/^[/\\]+/, ""));
    if (!put.startsWith(zvuk) || !existsSync(put) || !statSync(put).isFile()) {
      dalje();
      return;
    }

    const velicina = statSync(put).size;
    const vrsta = VRSTE[path.extname(put).toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", vrsta);
    res.setHeader("Accept-Ranges", "bytes");

    const raspon = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (raspon) {
      const od = raspon[1] ? Number(raspon[1]) : 0;
      const doKle = raspon[2] ? Math.min(Number(raspon[2]), velicina - 1) : velicina - 1;
      if (od >= velicina || od > doKle) {
        res.statusCode = 416;
        res.setHeader("Content-Range", "bytes */" + velicina);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", "bytes " + od + "-" + doKle + "/" + velicina);
      res.setHeader("Content-Length", doKle - od + 1);
      createReadStream(put, { start: od, end: doKle }).pipe(res);
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Length", velicina);
    createReadStream(put).pipe(res);
  };
}

/**
 * Isti rukovatelj, ali zapakiran kao dodatak za Vite. `apply: "serve"` znači
 * samo `npm run dev`: u `dist/` zbirke nema i ne smije je biti.
 *
 * @param {string} korijen
 */
export function zbirkaNaRazvoju(korijen) {
  return {
    name: "zbirka-na-razvoju",
    apply: /** @type {"serve"} */ ("serve"),
    /** @param {any} server */
    configureServer(server) {
      server.middlewares.use(zbirkaRukovatelj(korijen));
    },
  };
}
