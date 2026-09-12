/*
 * Ikone iz znaka: `public/lucify.svg` → `build/icon.png` za namjenski program,
 * i `public/lucify-*.png` za prečac koji objavljeni Lucify ostavlja na početnom
 * zaslonu.
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

/* Boja pozadine ispod uvučenoga znaka, ista kao u `index.html`. */
const PODLOGA = "#0a0a0b";

/**
 * Što se sve crta iz jednoga znaka.
 *
 * Prve tri su za **namjenski program i za prečac na početnom zaslonu**, i
 * ondje znak pokriva cijelo platno, jer mu sustav sam zaokruži rubove.
 *
 * Zadnja je **maskirna** (`purpose: "maskable"`): Android je smije izrezati u
 * krug, kapljicu ili što god sustav nosi, a reže do petine sa svake strane.
 * Zato je ondje znak uvučen na tri petine platna, na svojoj podlozi, pa
 * preživi svako rezanje. Ista slika u obje uloge znači ili odrezan znak ili
 * znak koji pliva u praznini, pa ih je dvije.
 */
const MJERE = [
  { mjera: 1024, pun: 1, kamo: path.join("build", "icon.png") },
  { mjera: 192, pun: 1, kamo: path.join("public", "lucify-192.png") },
  { mjera: 512, pun: 1, kamo: path.join("public", "lucify-512.png") },
  { mjera: 512, pun: 0.6, kamo: path.join("public", "lucify-maska.png") },
];

/* `app.whenReady()` se ovdje **ne smije** čekati vrhovnim `await`-om: Electron
   događaj „ready” javlja tek kad se ulazni modul do kraja izvrši, pa bi se
   program zaglavio čekajući sam sebe, i to bez ijedne poruke. */
app.whenReady().then(napravi).catch(pukni);

async function napravi() {
  const svg = readFileSync(path.join(korijen, "public", "lucify.svg"), "utf8");

  /* Prozor je sitan i skriven jer se ne snima on. Slika se crta na `<canvas>`
     zadane mjere, pa izlazi točno onolika kolika je tražena, bez obzira na zaslon.
     `capturePage()` bi ovdje bio zamka: on vraća ono što je prozor doista
     nacrtao, a prozor od 1024 točke na zaslonu sa 125 % uvećanja traži 1280
     piksela, pa ga sustav stisne na visinu zaslona i znak ispadne jajolik. */
  const prozor = new BrowserWindow({ width: 64, height: 64, show: false });
  await prozor.loadURL("data:text/html;charset=utf-8,<body></body>");

  const base64 = await prozor.webContents.executeJavaScript(
    `new Promise((vrati, pukni) => {
      const slika = new Image();
      slika.onload = () => {
        /* Jedna učitana slika, više mjera: svaka se crta na svoje platno, pa
           se sve vraćaju odjednom. \`pun\` je udio platna koji znak zauzima. */
        const nacrtaj = (mjera, pun) => {
          const platno = document.createElement("canvas");
          platno.width = platno.height = mjera;
          const c = platno.getContext("2d");
          const w = Math.round(mjera * pun);
          const o = Math.round((mjera - w) / 2);
          if (pun < 1) {
            /* Podloga ide samo pod uvučeni znak: ondje gdje znak pokriva sve,
               nje se ionako ne bi vidjelo, a prozirnost je korisnija. */
            c.fillStyle = ${JSON.stringify(PODLOGA)};
            c.fillRect(0, 0, mjera, mjera);
          }
          c.drawImage(slika, o, o, w, w);
          return platno.toDataURL("image/png").split(",")[1];
        };
        vrati(${JSON.stringify(
          MJERE.map((m) => ({ mjera: m.mjera, pun: m.pun })),
        )}.map((m) => nacrtaj(m.mjera, m.pun)));
      };
      slika.onerror = () => pukni(new Error("znak se ne da nacrtati"));
      slika.src = "data:image/svg+xml;base64," + ${JSON.stringify(
        Buffer.from(svg, "utf8").toString("base64"),
      )};
    })`,
  );

  mkdirSync(path.join(korijen, "build"), { recursive: true });
  mkdirSync(path.join(korijen, "public"), { recursive: true });
  MJERE.forEach((m, i) => {
    const kamo = path.join(korijen, m.kamo);
    writeFileSync(kamo, Buffer.from(base64[i], "base64"));
    console.log("ikona: " + m.kamo + " (" + m.mjera + " × " + m.mjera + ")");
  });
  app.exit(0);
}

/** @param {unknown} greska */
function pukni(greska) {
  console.error(greska);
  app.exit(1);
}
