/**
 * Izvoz zbirke za mobitel.
 *
 *   node scripts/izvezi.mjs                  u „Lucify za mobitel/” uz projekt
 *   node scripts/izvezi.mjs "D:/Glazba"      u zadanu mapu
 *
 * Zašto ovo uopće postoji: snimka u zbirci u svojoj oznaci nosi **sirovi**
 * naslov s YouTubea, jer joj ga ondje upiše `uMp3`, s onim što je dao yt-dlp.
 * Očišćeni naslov i pravi izvođač nastaju tek pri čitanju zbirke, u `rastavi()`,
 * i žive samo u `popis.json`. Lucify čita popis, pa vidi „...Baby One More
 * Time” i „Britney Spears”, ali svirač na mobitelu čita oznaku u datoteci, pa
 * bi vidio „Britney Spears - ...Baby One More Time (Official Video)”, a kao
 * izvođača ime kanala koji je snimku prenio.
 *
 * Zato se ovdje zbirka prepisuje van s onim što Lucify pokazuje upisanim u same
 * datoteke, uz omot iz `omoti/` ugrađen u snimku. Tako svaki svirač na
 * mobitelu, i na Androidu i na iPhoneu, pokaže isto što i Lucify, bez ijednoga
 * poslužitelja i bez mreže.
 *
 * **Zvuk se ne dira.** ffmpeg ga prepisuje s `-c copy`, dakle bajt po bajt, pa
 * je izvoz i istovjetan izvorniku i gotov u nekoliko sekunda. Mijenjaju se samo
 * oznake i omot.
 *
 * Ime datoteke ovdje **jest** naslov, obrnuto nego u zbirci. Ondje je oznaka
 * snimke, jer ono mora preživjeti i URL i poslužitelja; ovdje ništa od toga ne
 * stoji između datoteke i svirača, a čovjek koji mapu otvori na mobitelu treba
 * vidjeti naslove.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { putovi } from "./glazba-zbirka.mjs";
import { nadiFfmpeg, pokreni } from "./preuzimac-alati.mjs";

/* Imena koja Windows ne da datoteci ni s nastavkom. Pjesma se tako ne zove
   gotovo nikad, ali kad se zove, ne da se ni spremiti ni objasniti. */
const ZABRANJENA = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Koliko znakova ime smije nositi, da stane i na starijim datotečnim sustavima. */
const NAJDULJE_IME = 120;

/**
 * Naslov u ime datoteke. Kvačice, emoji, japansko i ćirilica ostaju: njih
 * Android, iOS i Windows danas nose bez muke. Miču se samo znakovi koji su
 * datotečnom sustavu naredba, a ne slovo.
 *
 * @param {string} s
 */
function imeZaDatoteku(s) {
  let n = String(s || "")
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAJDULJE_IME)
    /* Windows tiho briše točku i razmak s kraja imena, pa bolje da ih nema. */
    .replace(/[. ]+$/, "");
  if (ZABRANJENA.test(n)) n = n + "_";
  return n;
}

/**
 * Isto ime dvaput ne ide u istu mapu, a dvije pjesme istoga naslova nisu
 * greška: znaju biti dvije izvedbe.
 *
 * @param {Set<string>} zauzeta @param {string} osnova
 */
function jedinstveno(zauzeta, osnova) {
  let ime = osnova + ".mp3";
  let broj = 2;
  while (zauzeta.has(ime.toLowerCase())) {
    ime = osnova + " (" + broj + ").mp3";
    broj += 1;
  }
  zauzeta.add(ime.toLowerCase());
  return ime;
}

/** @param {number} bajtova */
function koliko(bajtova) {
  const mb = bajtova / (1024 * 1024);
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
}

/* ---------- glavni posao ---------- */

/**
 * Je li izlaz noviji od svega iz čega nastaje.
 *
 * Gleda se vrijeme, a ne veličina: izlaz je premotan i nosi omot, pa mu
 * veličina ionako nije ista kao ulazu.
 *
 * @param {string} izlaz @param {string} ulaz @param {string} omot
 */
function svjezije(izlaz, ulaz, omot) {
  if (!existsSync(izlaz)) return false;
  const t = statSync(izlaz).mtimeMs;
  if (t < statSync(ulaz).mtimeMs) return false;
  if (omot && existsSync(omot) && t < statSync(omot).mtimeMs) return false;
  return true;
}

/**
 * Izvoz zbirke u mapu `kamo`.
 *
 * Odvojeno od naredbenoga retka zato što isti posao sada radi i namjenska
 * aplikacija, iz jelovnika: ondje nema ni `npm`-a ni mape projekta, a bez izvoza
 * mobitel nema odakle dobiti glazbu.
 *
 * @param {object} o
 * @param {string} o.korijen mapa u kojoj stoji `Glazba/Zvuk`
 * @param {string} o.kamo mapa u koju se izvozi
 * @param {(n: { gotovo: number, ukupno: number, ime: string, presla?: boolean, greska?: boolean }) => void} [o.naNapredak]
 */
export async function izvezi({ korijen, kamo, naNapredak }) {
  const { zbirka, popisPut } = putovi(korijen);

  if (!existsSync(popisPut)) {
    throw new Error("Popisa nema: " + popisPut + "\nPokreni najprije `npm run glazba`.");
  }

  const popis = JSON.parse(readFileSync(popisPut, "utf8"));
  const pjesme = popis.pjesme || [];
  if (!pjesme.length) throw new Error("Zbirka je prazna, nema se što izvesti.");

  const alat = await nadiFfmpeg(korijen);
  if (!alat) {
    throw new Error(
      "ffmpeg se ne nalazi, a bez njega se oznake ne mogu upisati.\n" +
        "Dolazi uz `npm install`, kao neobavezna ovisnost `ffmpeg-static`.",
    );
  }

  mkdirSync(kamo, { recursive: true });

  /* Omoti idu i zasebno, uz ugrađene: svirač na mobitelu čita one iz snimke, ali
     sam Lucify, kad se zbirka u njega uveze, crta popis od sto pedeset redaka i
     treba sliku bez raspakiravanja svake snimke. */
  const omotiKamo = join(kamo, "omoti");
  if (pjesme.some((/** @type {any} */ p) => p.omot)) {
    mkdirSync(omotiKamo, { recursive: true });
    /* Android inače pokupi ove slike u Galeriju, među fotografije. */
    writeFileSync(join(omotiKamo, ".nomedia"), "");
  }

  /** @type {Set<string>} */
  const zauzeta = new Set();
  /** @type {Set<string>} */
  const napisana = new Set();
  /** Popis kakav ide uz izvoz: isti, ali s imenima datoteka iz ove mape. @type {any[]} */
  const izvezene = [];
  /** @type {string[]} */
  const greske = [];
  let bajtova = 0;
  let sOmotom = 0;
  let napisano = 0;
  let preskoceno = 0;

  for (const [i, p] of pjesme.entries()) {
    const ulaz = join(zbirka, p.datoteka);
    if (!existsSync(ulaz)) {
      greske.push(p.datoteka + ": snimke nema u zbirci");
      continue;
    }

    const omot = p.omot ? join(zbirka, p.omot) : "";
    const imaOmot = Boolean(omot) && existsSync(omot);

    /* Bez izvođača ostaje sam naslov, a bez oboje oznaka snimke: prazno ime
       datoteka ne može nositi. */
    const osnova =
      imeZaDatoteku([p.izvodac, p.naslov].filter(Boolean).join(" - ")) ||
      imeZaDatoteku(p.naslov) ||
      p.id;
    const ime = jedinstveno(zauzeta, osnova);
    const izlaz = join(kamo, ime);

    /* Već izvezeno, i otad se nije mijenjalo: ffmpeg se ne pokreće drugi put.
       Prvi izvoz traje minutama, svaki sljedeći sekundama, pa se preko žice
       poslije nosi samo ono što je doista novo. */
    if (svjezije(izlaz, ulaz, imaOmot ? omot : "")) {
      bajtova += statSync(izlaz).size;
      napisana.add(ime.toLowerCase());
      if (imaOmot) {
        const cilj = join(omotiKamo, basename(p.omot));
        if (!existsSync(cilj)) copyFileSync(omot, cilj);
        sOmotom += 1;
      }
      izvezene.push({ ...p, datoteka: ime });
      preskoceno += 1;
      if (naNapredak) naNapredak({ gotovo: i + 1, ukupno: pjesme.length, ime, presla: true });
      continue;
    }

    /* `-map 0:a` uzima samo zvuk, pa ispada omot koji je u snimci možda već bio,
       a `-c copy` znači da se zvuk prepisuje, a ne pretvara iznova. */
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      ulaz,
      ...(imaOmot ? ["-i", omot] : []),
      "-map",
      "0:a",
      ...(imaOmot ? ["-map", "1:v"] : []),
      "-c",
      "copy",
      /* Inačica 3, a ne 4: stariji svirači i Windows Explorer čitaju samo nju. */
      "-id3v2_version",
      "3",
      "-write_id3v1",
      "1",
      "-metadata",
      "title=" + (p.naslov || ""),
      "-metadata",
      "artist=" + (p.izvodac || ""),
      /* Jedan album za cijelu zbirku: svirači slažu po albumu, pa se ovako drži
         na okupu umjesto da se raspe u sto pedeset „Nepoznatih albuma”. */
      "-metadata",
      "album=Lucify",
      ...(imaOmot
        ? [
            "-disposition:v",
            "attached_pic",
            "-metadata:s:v",
            "title=Album cover",
            "-metadata:s:v",
            "comment=Cover (front)",
          ]
        : []),
      izlaz,
    ];

    try {
      await pokreni({ cmd: alat.cmd, args: [...alat.args, ...args] });
      bajtova += statSync(izlaz).size;
      napisana.add(ime.toLowerCase());
      if (imaOmot) {
        copyFileSync(omot, join(omotiKamo, basename(p.omot)));
        sOmotom += 1;
      }
      /* Ime datoteke se izvozom promijenilo, pa se mijenja i u popisu: po njemu
         uvoz na uređaju spaja snimku s njezinim retkom. */
      izvezene.push({ ...p, datoteka: ime });
      napisano += 1;
      if (naNapredak) naNapredak({ gotovo: i + 1, ukupno: pjesme.length, ime });
    } catch (e) {
      greske.push(ime + ": " + (e && e.message ? e.message : String(e)));
      if (naNapredak) naNapredak({ gotovo: i + 1, ukupno: pjesme.length, ime, greska: true });
    }
  }

  /* Popis ide uz snimke, i to nije privjesak nego drugi dio izvoza. Sviraču na
     mobitelu ne znači ništa i preskočit će ga, ali sam Lucify, uvezen na uređaj,
     iz njega dobiva sve što oznaka u datoteci ne nosi: police, `razdoblje`,
     `biljeska` i poveznicu na izvornu snimku. Bez njega uvoz ne zna početi.

     Zato se ne prepisuje nego slaže iznova: imena datoteka su ovdje drukčija, a
     pjesma koja nije izašla ne smije u njemu stajati. */
  try {
    const izvezeni = new Set(izvezene.map((p) => p.id));
    const police = (popis.police || [])
      .map((/** @type {any} */ p) => ({
        ...p,
        pjesme: (p.pjesme || []).filter((/** @type {string} */ id) => izvezeni.has(id)),
      }))
      .filter((/** @type {any} */ p) => p.pjesme.length);
    writeFileSync(
      join(kamo, "popis.json"),
      JSON.stringify({ ...popis, pjesme: izvezene, police }, null, 1),
    );
  } catch (e) {
    greske.push("popis.json: " + (e && e.message ? e.message : String(e)));
  }

  /* Ono što je ostalo od prošloga izvoza. Pjesma kojoj se u međuvremenu ispravio
     naslov ovdje leži pod starim imenom, pa bi se na mobitelu pojavila dvaput.
     Ne briše se samo od sebe: mapa je čovjekova, a u njoj može stajati i glazba
     koja s Lucifyjem nema veze. */
  const ostatci = readdirSync(kamo).filter(
    (f) => /\.mp3$/i.test(f) && !napisana.has(f.toLowerCase()),
  );

  return { kamo, ukupno: pjesme.length, napisano, preskoceno, bajtova, sOmotom, greske, ostatci };
}

/* ---------- iz naredbenoga retka ---------- */

/* Pokrenuto kao naredba, a ne uvezeno iz aplikacije: samo tada ispisuje i samo
   tada uzima mapu iz `process.argv`. */
const ovaDatoteka = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(ovaDatoteka)) {
  const korijen = join(dirname(ovaDatoteka), "..");
  const kamo = process.argv[2] || join(korijen, "Lucify za mobitel");
  console.log("Izvozim u: " + kamo);
  try {
    const r = await izvezi({
      korijen,
      kamo,
      naNapredak: (n) => {
        const broj = String(n.gotovo).padStart(String(n.ukupno).length, " ");
        const znak = n.greska ? "\u26a0 " : n.presla ? "\u00b7 " : "";
        console.log("[" + broj + "/" + n.ukupno + "] " + znak + n.ime);
      },
    });
    console.log("");
    console.log(
      "Izvezeno: " + (r.napisano + r.preskoceno) + " od " + r.ukupno + ", " + koliko(r.bajtova),
    );
    if (r.preskoceno) console.log("Već bilo ondje: " + r.preskoceno);
    console.log("Omoti: " + r.sOmotom);
    r.greske.forEach((g) => console.log("  \u26a0 " + g));
    if (r.ostatci.length) {
      console.log("");
      console.log("U mapi je i " + r.ostatci.length + " mp3 koje ovaj izvoz nije napisao:");
      r.ostatci.slice(0, 10).forEach((f) => console.log("  \u00b7 " + f));
      if (r.ostatci.length > 10) console.log("  \u00b7 … i još " + (r.ostatci.length - 10));
      console.log("Ostatci prošloga izvoza ili tuđa glazba. Ne diram ih, pogledaj sam.");
    }
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }
}
