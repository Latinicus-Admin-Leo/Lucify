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
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { putovi } from "./glazba-zbirka.mjs";
import { nadiFfmpeg, pokreni } from "./preuzimac-alati.mjs";
import { zipPisac } from "./zip.mjs";

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

/**
 * Argumenti kojima ffmpeg prepisuje snimku s upisanim oznakama i omotom.
 *
 * `-map 0:a` uzima samo zvuk, pa ispada omot koji je u snimci možda već bio, a
 * `-c copy` znači da se zvuk prepisuje, a ne pretvara iznova: izlaz je bajt po
 * bajt istovjetan izvorniku.
 *
 * Isti posao traže oba izvoza — i onaj u mapu i onaj u jednu datoteku — pa
 * stoji ovdje, da se oznake ne mogu razići.
 *
 * @param {object} o
 * @param {string} o.ulaz @param {string} o.omot prazno ako ga nema
 * @param {any} o.p pjesma iz popisa @param {string} o.izlaz
 */
function argumentiOznake({ ulaz, omot, p, izlaz }) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    ulaz,
    ...(omot ? ["-i", omot] : []),
    "-map",
    "0:a",
    ...(omot ? ["-map", "1:v"] : []),
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
    ...(omot
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

    const args = argumentiOznake({ ulaz, omot: imaOmot ? omot : "", p, izlaz });

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

/* ---------- izvoz u jednu datoteku ---------- */

/**
 * Gdje stoji zapis o tome što je već otišlo na mobitel.
 *
 * Stoji uz zbirku, a ne uz program, i zato ga dijele naredba i jelovnik: izvozi
 * se jedna zbirka, pa i pamćenje o njoj mora biti jedno. U korijenu je, a ne u
 * `Glazba/Zvuk`, da ne stoji čovjeku pred očima svaki put kad otvori mapu sa
 * snimkama.
 *
 * @param {string} korijen
 */
const zapisPut = (korijen) => join(korijen, ".lucify-izvoz.json");

/** @param {string} korijen @returns {Record<string, number>} */
function procitajZapis(korijen) {
  try {
    const z = JSON.parse(readFileSync(zapisPut(korijen), "utf8"));
    return z && z.poslano && typeof z.poslano === "object" ? z.poslano : {};
  } catch {
    /* Zapisa nema ili je pokvaren: tada je novo sve, što je prvi izvoz i jest. */
    return {};
  }
}

/** @param {string} korijen @param {Record<string, number>} poslano */
function zapisiZapis(korijen, poslano) {
  try {
    writeFileSync(zapisPut(korijen), JSON.stringify({ poslano }, null, 1) + "\n", "utf8");
  } catch {
    /* Zapis je samo za brzinu. Bez njega sljedeći izvoz iznese cijelu zbirku:
       neugodno, jer je datoteka onda velika, ali ne i pogrešno. */
  }
}

/**
 * Izvoz u **jednu datoteku**, za Lucify na mobitelu.
 *
 * Izvoz u mapu ostaje za tuđe svirače, gdje mapa i treba biti mapa. Ovo je za
 * Lucify, i rješava ono što je u tom putu bilo najgore: mapu od sto pedeset
 * datoteka trebalo je prenijeti na mobitel i ondje je **cijelu** predati
 * Lucifyju. Na iPhoneu, koji za mape ne zna, to je značilo označiti sto pedeset
 * datoteka u Datotekama, i pripaziti da je `popis.json` među njima.
 *
 * Sada putuje jedna datoteka, i u njoj **samo ono što mobitel još nema**. Što je
 * već otišlo, zapisano je uz zbirku, pa drugi izvoz nosi one dvije nove pjesme,
 * a ne svih šesto pedeset megabajta. Uređaj se time ne pretrpava dvaput: manje
 * dođe, manje i ostane ležati pokraj Lucifyjeve zbirke.
 *
 * `popis.json` je pritom uvijek cijel, i to je važno: uvoz po njemu zna što na
 * uređaju smije stajati, pa bi popis od tri pjesme ostale sto četrdeset i četiri
 * proglasio viškom.
 *
 * Arhiva je bez stiskanja: mp3 i jpg su već stisnuti, pa bi drugo stiskanje
 * samo trošilo vrijeme. Zbog toga ni raspakiravanje na mobitelu ništa ne
 * prepisuje — snimka se čita ravno iz arhive, s mjesta na kojem leži.
 *
 * @param {object} o
 * @param {string} o.korijen mapa u kojoj stoji `Glazba/Zvuk`
 * @param {string} o.kamo put do datoteke koja će nastati
 * @param {boolean} [o.sve] ne gledaj zapis, iznesi cijelu zbirku
 * @param {(n: { gotovo: number, ukupno: number, ime: string, greska?: boolean }) => void} [o.naNapredak]
 */
export async function izveziZip({ korijen, kamo, sve = false, naNapredak }) {
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

  /* Imena se slažu za **cijelu** zbirku, u redu u kojem popis stoji, pa su
     jednaka u svakom izvozu: po imenu uvoz spaja snimku s njezinim retkom, a
     `jedinstveno()` broji samo kad se dva naslova poklope. */
  /** @type {Set<string>} */
  const zauzeta = new Set();
  /** @type {{ p: any, ulaz: string, omot: string, ime: string, vrijeme: number }[]} */
  const redom = [];
  /** @type {string[]} */
  const greske = [];

  for (const p of pjesme) {
    const ulaz = join(zbirka, p.datoteka);
    if (!existsSync(ulaz)) {
      greske.push(p.datoteka + ": snimke nema u zbirci");
      continue;
    }
    const omotPut = p.omot ? join(zbirka, p.omot) : "";
    const omot = omotPut && existsSync(omotPut) ? omotPut : "";
    const osnova =
      imeZaDatoteku([p.izvodac, p.naslov].filter(Boolean).join(" - ")) ||
      imeZaDatoteku(p.naslov) ||
      p.id;
    /* Novija od snimke i omota: kad se omot promijeni, snimka mora izaći
       iznova, jer je omot u njoj. */
    const vrijeme = Math.max(
      statSync(ulaz).mtimeMs,
      omot ? statSync(omot).mtimeMs : 0,
    );
    redom.push({ p, ulaz, omot, ime: jedinstveno(zauzeta, osnova), vrijeme });
  }

  const poslano = sve ? {} : procitajZapis(korijen);
  const putuju = redom.filter((s) => !(poslano[s.p.id] >= s.vrijeme));

  /* Popis kakav ide uz izvoz: cijela zbirka, ali s imenima datoteka iz arhive.
     Pjesma kojoj snimke nema u njemu ne stoji, jer je ni uvoz ne bi našao. */
  const izvezene = redom.map((s) => ({ ...s.p, datoteka: s.ime }));
  const izvezeni = new Set(izvezene.map((p) => p.id));
  const police = (popis.police || [])
    .map((/** @type {any} */ p) => ({
      ...p,
      pjesme: (p.pjesme || []).filter((/** @type {string} */ id) => izvezeni.has(id)),
    }))
    .filter((/** @type {any} */ p) => p.pjesme.length);

  const radna = mkdtempSync(join(tmpdir(), "lucify-izvoz-"));
  const privremena = join(radna, "snimka.mp3");
  const z = zipPisac(kamo);
  /** @type {Record<string, number>} */
  const novoPoslano = { ...(sve ? {} : poslano) };
  /** @type {Set<string>} */
  const omotiUArhivi = new Set();
  let bajtova = 0;
  let sOmotom = 0;
  let napisano = 0;

  try {
    await z.dodaj(
      "popis.json",
      Buffer.from(JSON.stringify({ ...popis, pjesme: izvezene, police }, null, 1), "utf8"),
    );

    for (const [i, s] of putuju.entries()) {
      if (naNapredak) naNapredak({ gotovo: i, ukupno: putuju.length, ime: s.ime });
      try {
        await pokreni({
          cmd: alat.cmd,
          args: [...alat.args, ...argumentiOznake({ ulaz: s.ulaz, omot: s.omot, p: s.p, izlaz: privremena })],
        });
        await z.dodajDatoteku(s.ime, privremena, new Date(s.vrijeme));
        bajtova += statSync(privremena).size;
        /* Omot ide i zasebno, uz onaj ugrađen u snimku: Lucify na uređaju crta
           popis od sto pedeset redaka i treba sliku bez raspakiravanja svake
           snimke. */
        if (s.omot) {
          const ime = "omoti/" + basename(s.p.omot);
          if (!omotiUArhivi.has(ime)) {
            await z.dodajDatoteku(ime, s.omot);
            omotiUArhivi.add(ime);
          }
          sOmotom += 1;
        }
        novoPoslano[s.p.id] = s.vrijeme;
        napisano += 1;
      } catch (e) {
        greske.push(s.ime + ": " + (e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e)));
        if (naNapredak) naNapredak({ gotovo: i + 1, ukupno: putuju.length, ime: s.ime, greska: true });
      } finally {
        rmSync(privremena, { force: true });
      }
    }

    const kraj = await z.gotovo();
    zapisiZapis(korijen, novoPoslano);
    return {
      kamo,
      ukupno: redom.length,
      napisano,
      preskoceno: redom.length - putuju.length,
      bajtova,
      arhiva: kraj.bajtova,
      sOmotom,
      greske,
    };
  } catch (e) {
    /* Nedovršena arhiva nikomu ne koristi, a izgleda kao gotova. */
    z.prekini();
    rmSync(kamo, { force: true });
    throw e;
  } finally {
    rmSync(radna, { recursive: true, force: true });
  }
}

/* ---------- iz naredbenoga retka ---------- */

/* Pokrenuto kao naredba, a ne uvezeno iz aplikacije: samo tada ispisuje i samo
   tada uzima mapu iz `process.argv`. */
const ovaDatoteka = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(ovaDatoteka)) {
  const korijen = join(dirname(ovaDatoteka), "..");
  const zastavice = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const putanja = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const uZip = zastavice.includes("--zip");
  const sve = zastavice.includes("--sve");

  if (uZip) {
    const danas = new Date().toISOString().slice(0, 10);
    const kamo = putanja || join(korijen, "Lucify za mobitel " + danas + ".zip");
    console.log("Izvozim u: " + kamo + (sve ? " (cijela zbirka)" : ""));
    try {
      const r = await izveziZip({
        korijen,
        kamo,
        sve,
        naNapredak: (n) => {
          const broj = String(n.gotovo + 1).padStart(String(n.ukupno).length, " ");
          console.log("[" + broj + "/" + n.ukupno + "] " + (n.greska ? "⚠ " : "") + n.ime);
        },
      });
      console.log("");
      console.log(
        "U arhivi: " + r.napisano + " od " + r.ukupno + ", " + koliko(r.arhiva) + " na disku",
      );
      if (r.preskoceno) console.log("Mobitel već ima: " + r.preskoceno);
      if (!r.napisano) console.log("Novih pjesama nema, pa je u arhivi samo osvježen popis.");
      console.log("Omoti: " + r.sOmotom);
      r.greske.forEach((g) => console.log("  ⚠ " + g));
      console.log("");
      console.log("Prenesi ovu datoteku na mobitel, pa u Lucifyju: Zbirka → Odaberi datoteku.");
    } catch (e) {
      console.error(e && e.message ? e.message : String(e));
      process.exit(1);
    }
    process.exit(0);
  }

  const kamo = putanja || join(korijen, "Lucify za mobitel");
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
