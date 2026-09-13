/*
 * Ikone iz znaka: `public/lucify.svg` → `build/icon.png` i `build/icon.ico` za namjenski program,
 * i `public/lucify-*.png` za prečac koji objavljeni Lucify ostavlja na početnom
 * zaslonu.
 *
 * Pokreće se Electronom (`npm run ikona`), a ne Nodeom, zato što PNG treba
 * netko tko zna nacrtati SVG, a Electron to već ima uza se. Time projekt ne
 * dobiva još jednu ovisnost samo zbog jedne slike koja se mijenja jednom
 * godišnje. `.ico` se slaže ovdje, a ne u graditelju, jer graditelj mjere
 * za nj stišće iz jednoga PNG-a, a baš to stiskanje nazubi sitne mjere.
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
 * krug, kapljicu ili što god sustav nosi, a sigurno ostaje samo središnji krug
 * promjera četiri petine platna. Zato je ondje znak uvučen, na svojoj podlozi,
 * pa preživi svako rezanje. Ista slika u obje uloge znači ili odrezan znak ili
 * znak koji pliva u praznini, pa ih je dvije.
 *
 * Uvučen je na 0,73 platna, a ne na tri petine kao prije: na tri petine je na
 * Samsungovu početnom zaslonu crveni krug zauzimao dvije trećine ikone, a
 * Spotifyjev zeleni odmah do njega četiri petine, pa je Lucify izgledao sitno.
 * Na 0,73 su jednaki, a krug (promjera 0,66 platna) i dalje stoji unutar
 * sigurnoga.
 */
const MJERE = [
  { mjera: 1024, pun: 1, kamo: path.join("build", "icon.png") },
  { mjera: 192, pun: 1, kamo: path.join("public", "lucify-192.png") },
  { mjera: 512, pun: 1, kamo: path.join("public", "lucify-512.png") },
  { mjera: 512, pun: 0.73, kamo: path.join("public", "lucify-maska.png") },
];

/**
 * Mjere u `build/icon.ico`, za Windows.
 *
 * Prozor je dosad dobivao `icon.png` od 1024 točke, a Windows ga za traku
 * zadataka sam stisne na 32 ili 40 točaka, i to grubo, pa su tanki lukovi
 * ispadali nazubljeni. U `.ico` svaka mjera stoji zasebno i crta se iz SVG-a
 * ravno na svoju veličinu, pa sustav samo uzme onu koju treba. Tu su i mjere
 * za uvećanja zaslona od 125 i 150 %: 20, 24, 40 i 48.
 */
const MJERE_ICO = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

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
        vrati(${JSON.stringify([
          ...MJERE.map((m) => ({ mjera: m.mjera, pun: m.pun })),
          ...MJERE_ICO.map((mjera) => ({ mjera, pun: 1 })),
        ])}.map((m) => nacrtaj(m.mjera, m.pun)));
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

  const ico = path.join("build", "icon.ico");
  writeFileSync(
    path.join(korijen, ico),
    slozIco(MJERE_ICO.map((mjera, i) => ({ mjera, png: Buffer.from(base64[MJERE.length + i], "base64") }))),
  );
  console.log("ikona: " + ico + " (" + MJERE_ICO.join(", ") + ")");
  app.exit(0);
}

/**
 * `.ico` od gotovih PNG-ova: zaglavlje, pa po jedan redak za svaku mjeru, pa
 * same slike. Windows od Viste nadalje u `.ico` prima PNG izravno, pa se ništa
 * ne pretvara u bitmapu.
 *
 * @param {{ mjera: number, png: Buffer }[]} slike
 */
function slozIco(slike) {
  const glava = Buffer.alloc(6 + 16 * slike.length);
  glava.writeUInt16LE(0, 0);
  glava.writeUInt16LE(1, 2);
  glava.writeUInt16LE(slike.length, 4);
  let pomak = glava.length;
  slike.forEach(({ mjera, png }, i) => {
    const r = 6 + 16 * i;
    /* 256 se u jedan bajt ne da upisati, pa ga oblik bilježi kao 0. */
    glava.writeUInt8(mjera >= 256 ? 0 : mjera, r);
    glava.writeUInt8(mjera >= 256 ? 0 : mjera, r + 1);
    glava.writeUInt16LE(1, r + 4);
    glava.writeUInt16LE(32, r + 6);
    glava.writeUInt32LE(png.length, r + 8);
    glava.writeUInt32LE(pomak, r + 12);
    pomak += png.length;
  });
  return Buffer.concat([glava, ...slike.map((s) => s.png)]);
}

/** @param {unknown} greska */
function pukni(greska) {
  console.error(greska);
  app.exit(1);
}
