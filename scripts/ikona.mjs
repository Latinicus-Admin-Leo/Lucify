/*
 * Ikona programa iz znaka: `public/lucify.svg` → `build/icon.png`.
 *
 * Pokreće se Electronom (`npm run ikona`), a ne Nodeom, zato što PNG treba
 * netko tko zna nacrtati SVG, a Electron to već ima uza se. Time projekt ne
 * dobiva još jednu ovisnost samo zbog jedne slike koja se mijenja jednom
 * godišnje. Graditelj iz te jedne datoteke sam složi sve mjere za `.ico`.
 */

import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const korijen = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MJERA = 1024;

/* `app.whenReady()` se ovdje **ne smije** čekati vrhovnim `await`-om: Electron
   događaj „ready” javlja tek kad se ulazni modul do kraja izvrši, pa bi se
   program zaglavio čekajući sam sebe, i to bez ijedne poruke. */
app.whenReady().then(napravi).catch(pukni);

async function napravi() {
  const svg = readFileSync(path.join(korijen, "public", "lucify.svg"), "utf8");

  /* Prozor je sitan i skriven jer se ne snima on. Slika se crta na `<canvas>`
     zadane mjere, pa izlazi točno 1024 × 1024, bez obzira na zaslon.
     `capturePage()` bi ovdje bio zamka: on vraća ono što je prozor doista
     nacrtao, a prozor od 1024 točke na zaslonu sa 125 % uvećanja traži 1280
     piksela, pa ga sustav stisne na visinu zaslona i znak ispadne jajolik. */
  const prozor = new BrowserWindow({ width: 64, height: 64, show: false });
  await prozor.loadURL("data:text/html;charset=utf-8,<body></body>");

  const base64 = await prozor.webContents.executeJavaScript(
    `new Promise((vrati, pukni) => {
      const platno = document.createElement("canvas");
      platno.width = platno.height = ${MJERA};
      const slika = new Image();
      slika.onload = () => {
        platno.getContext("2d").drawImage(slika, 0, 0, ${MJERA}, ${MJERA});
        vrati(platno.toDataURL("image/png").split(",")[1]);
      };
      slika.onerror = () => pukni(new Error("znak se ne da nacrtati"));
      slika.src = "data:image/svg+xml;base64," + ${JSON.stringify(
        Buffer.from(svg, "utf8").toString("base64"),
      )};
    })`,
  );

  mkdirSync(path.join(korijen, "build"), { recursive: true });
  const kamo = path.join(korijen, "build", "icon.png");
  writeFileSync(kamo, Buffer.from(base64, "base64"));
  console.log("ikona: " + kamo + " (" + MJERA + " × " + MJERA + ")");
  app.exit(0);
}

/** @param {unknown} greska */
function pukni(greska) {
  console.error(greska);
  app.exit(1);
}
