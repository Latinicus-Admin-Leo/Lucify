/**
 * Lucify na dva jezika.
 *
 * Ključ je **sam hrvatski tekst**, a ne izmišljena oznaka (`popis.naslov` i
 * slično). Time se dobiva dvoje: u izvoru i dalje piše ono što se na zaslonu
 * vidi, pa se čita bez skakanja u rječnik; i ono što se zaboravi prevesti
 * ostane hrvatsko umjesto da ispadne prazno ili da pukne. Engleski je izbor,
 * hrvatski je zadano.
 *
 * Jezik stoji izvan Reacta, kao i svirač, jer ga traže sva četiri okvira, a
 * mijenja se rijetko: prikaz ga gleda kroz `useSyncExternalStore`.
 *
 * Broj se ne da prevesti riječ po riječ. Hrvatski uz broj mijenja i imenicu i
 * glagol i odnosnu zamjenicu („stoji 1 pjesma koje nema”, „stoje 2 pjesme
 * kojih nema”), a engleski samo imenicu, i to jednom. Zato su takve rečenice
 * ovdje cijele, a ne složene od komada.
 */

/** Pod ovim ključem stoji izbor, uz srca i popise. */
const KLJUC = "lucijanka.glazba.jezik";

export const JEZICI = ["hr", "en"];

/**
 * Rječnik. Lijevo je ono što piše u izvoru, desno engleski.
 *
 * @type {Record<string, string>}
 */
const EN = {
  /* ---------- gornja traka i kretanje ---------- */
  "Što želiš slušati?": "What do you want to listen to?",
  "Traži po zbirci": "Search the collection",
  "Traži u zbirci": "Search in the collection",
  Poveznice: "Links",
  "Otvori poveznice": "Open links",
  Jelovnik: "Menu",
  "Glavno kretanje": "Main navigation",
  "Tvoja zbirka": "Your collection",
  Zbirka: "Collection",
  "Zbirka na uređaju": "Collection on this device",
  "Dodaj pjesmu": "Add a song",
  Jezik: "Language",
  "Na engleski": "In English",
  "Na hrvatski": "In Croatian",

  /* ---------- police i popisi ---------- */
  Sve: "All",
  Popisi: "Playlists",
  Izvođači: "Artists",
  "Sve pjesme": "All songs",
  "Označeno srcem": "Favourites",
  Popis: "Playlist",
  "Novi popis": "New playlist",
  "Novi popis…": "New playlist…",
  "Moj popis": "My playlist",
  "Kako se zove?": "What should it be called?",
  Napravi: "Create",
  Odustani: "Cancel",
  "Dodaj u popis": "Add to playlist",
  "Makni iz ovog popisa": "Remove from this playlist",
  "Označi srcem": "Add to favourites",
  "Makni iz srca": "Remove from favourites",
  "U ovom popisu još nema ničega.": "There is nothing in this playlist yet.",
  "Ništa pod tim imenom.": "Nothing by that name.",
  "Ništa za „": "Nothing for “",

  /* ---------- stupci i poredak ---------- */
  Naslov: "Title",
  Izvođač: "Artist",
  "Razdoblje i izvor": "Period and source",
  Dodano: "Added",
  Trajanje: "Duration",
  "Poredaj po: ": "Sort by: ",
  Datoteka: "File",

  /* ---------- svirač ---------- */
  "Sad svira": "Now playing",
  Pusti: "Play",
  "Pusti ": "Play ",
  Zaustavi: "Pause",
  Prethodna: "Previous",
  Sljedeća: "Next",
  Nasumično: "Shuffle",
  "Ponavljaj popis": "Repeat playlist",
  "Ponavljaj pjesmu": "Repeat song",
  "Ponavljanje isključeno": "Repeat off",
  Glasnoća: "Volume",
  Utišaj: "Mute",
  "Uključi zvuk": "Unmute",
  "Mjesto u pjesmi": "Position in the song",
  "Otvori svirač": "Open the player",
  "Zatvori svirač": "Close the player",
  "Ploča sa strane": "Side panel",
  "Više o pjesmi": "More about the song",
  "Ništa ne svira. Odaberi pjesmu s popisa.": "Nothing is playing. Pick a song from the list.",
  "Uz slušanje": "While listening",
  Zapis: "Recording",
  "Otvori izvornik na YouTubeu": "Open the original on YouTube",
  "Otvori na YouTubeu": "Open on YouTube",

  /* ---------- mjerač vremena ---------- */
  "Mjerač vremena": "Sleep timer",
  "Mjerač vremena, još ": "Sleep timer, ",
  "Zaustavi glazbu nakon": "Stop the music after",
  "Zaustavi glazbu nakon zadanog vremena": "Stop the music after a set time",
  "Do kraja pjesme": "Until the song ends",
  "do kraja pjesme": "until the song ends",
  "Isključi mjerač": "Turn the timer off",
  "Vlastito vrijeme u minutama": "Custom time, in minutes",
  Postavi: "Set",
  min: "min",
  " min": " min",
  " h ": " h ",
  minuta: "minutes",
  sat: "hour",
  sata: "hours",
  sati: "hours",
  "1 sat": "1 hour",

  /* ---------- prazna zbirka ---------- */
  "Otvaram zbirku…": "Opening the collection…",
  "Zbirka je prazna. Snimke stoje u": "The collection is empty. Recordings live in",
  "Zbirka je prazna. Snimke stoje u mapi zbirke, koja se otvara iz jelovnika:":
    "The collection is empty. Recordings live in the collection folder, which opens from the menu:",
  "Lucify → Otvori mapu zbirke": "Lucify → Open collection folder",
  ", a ta mapa nije u gitu, jer je glazba tuđe autorsko djelo.":
    ", and that folder is not in git, because the music is someone else’s work.",
  ". Ondje se mogu i samo prekopirati, a Lucify ih pokupi pri idućem otvaranju.":
    ". You can simply copy them there, and Lucify picks them up next time it opens.",
  "Najlakše ide poveznicom s YouTubea, tipkom": "Easiest with a YouTube link, using",
  "Ili jednu po jednu, tipkom": "Or one at a time, with",
  "Mapu slaže Lucify za računalo, naredbom": "The folder is made by Lucify for desktop, with",
  ". Prenesi je na ovaj uređaj i otvori": ". Move it to this device and open",
  "Lucify za računalo": "Lucify for desktop",
  "Za računalo": "For desktop",
  "Zbirka je prazna, jer je na ovom uređaju još nema. Glazba ne dolazi odavde: snimke su tuđe autorsko djelo, pa ne idu ni u git ni na objavljenu stranicu. Zbirku nosi sam uređaj, i unese se jednom.":
    "The collection is empty, because this device does not have it yet. The music does not come from here: the recordings are someone else’s work, so they go neither into git nor onto the published site. The device carries the collection itself, and it is brought in once.",

  /* ---------- okvir „Dodaj pjesmu” ---------- */
  "Ništa se ne preuzima": "Nothing is downloading",
  "Očisti gotove": "Clear finished",
  Preuzimam: "Downloading",
  Pretvaram: "Converting",
  Prekinuto: "Stopped",
  "Nije uspjelo": "Failed",
  "Nedostaje ": "Missing ",
  "Nov yt-dlp nije stigao.": "The newer yt-dlp did not arrive.",
  "Preuzimač je odbio taj zahtjev.": "The downloader refused that request.",
  "Ne mogu doći do preuzimača. Radi li još `npm run dev`?":
    "Cannot reach the downloader. Is `npm run dev` still running?",
  "U zbirci": "In the collection",
  "Slažem u zbirku": "Filing into the collection",
  "Preuzimam zvuk": "Downloading audio",
  "Pretvaram u mp3": "Converting to mp3",

  /* ---------- okvir „Zbirka” ---------- */
  Zatvori: "Close",
  "Odaberi datoteku": "Choose a file",
  "Odaberi mapu": "Choose a folder",
  "Uvoz nije uspio.": "The import failed.",
  "Čišćenje nije uspjelo.": "The cleanup failed.",
  Počisti: "Clean up",
  "Obriši zbirku s uređaja": "Delete the collection from this device",
  "ne zatvaraj dok traje": "do not close while this runs",
  "Nije doneseno ništa novo": "Nothing new was brought in",
  Doneseno: "Brought in",
  "već bilo ovdje": "already here",

  /* ---------- okvir „Poveznice” ---------- */
  "Otvaram popis…": "Opening the list…",
  "Prethodna stranica": "Previous page",
  "Sljedeća stranica": "Next page",

  /* ---------- kakvoća zvuka ---------- */
  /* Imena dolaze s poslužitelja, iz `KAKVOCE`, pa se prevode pri ispisu. */
  Manja: "Lower",
  Srednja: "Medium",
  Visoka: "High",
  Najveća: "Highest",
  "oko 115 kbps": "about 115 kbps",
  "oko 165 kbps": "about 165 kbps",
  "oko 190 kbps": "about 190 kbps",

  /* ---------- zašto poveznica nije prošla ---------- */
  "Oznaka snimke u toj poveznici ne valja.": "The video id in that link is not valid.",
  "Zalijepi poveznicu s YouTubea.": "Paste a YouTube link.",
  "To nije valjana mrežna adresa.": "That is not a valid web address.",
  "Prima se samo http i https.": "Only http and https are accepted.",
  "Prima se samo poveznica s YouTubea.": "Only YouTube links are accepted.",
  "U toj kratkoj poveznici nema oznake snimke.": "That short link has no video id in it.",
  "Toj poveznici nedostaje dio `v=`.": "That link is missing the `v=` part.",
  "U toj poveznici nema oznake snimke.": "That link has no video id in it.",
  "Popisi se ne primaju. Zalijepi jednu snimku.": "Playlists are not accepted. Paste a single video.",
  "Ta poveznica ne pokazuje na jednu snimku.": "That link does not point at a single video.",

  /* ---------- rečenice okvira „Dodaj pjesmu” ---------- */
  "Zalijepi jednu poveznicu ili cijeli popis.": "Paste one link, or a whole list of them.",
  "Preuzimač se ne javlja. On radi samo uz `npm run dev`.":
    "The downloader does not answer. It only runs under `npm run dev`.",
  ". Bez toga se ne može preuzimati.": ". Without it, nothing can be downloaded.",
  "Zalijepi poveznicu s YouTubea, jednu ili cijeli popis. Zvuk se preuzme, pretvori u mp3 i odmah uđe u zbirku, pa je nađeš pod":
    "Paste a YouTube link, one or a whole list. The audio is downloaded, turned into mp3 and goes straight into the collection, where you will find it under",
  "osvježi yt-dlp": "refresh yt-dlp",
  "dohvati yt-dlp": "fetch yt-dlp",
  "dohvaćam…": "fetching…",

  /* ---------- rečenice okvira „Zbirka” ---------- */
  "Zbirka stoji na ovom uređaju i nigdje drugdje. Mapu slaže Lucify za računalo, naredbom":
    "The collection lives on this device and nowhere else. The folder is made by Lucify for desktop, with",
  "; prenesi je ovamo i odaberi je ovdje. Poslije toga glazba svira i bez mreže.":
    "; bring it over and choose it here. After that the music plays with no network at all.",
  zauzeto: "in use",
  "Slažem zbirku…": "Filing the collection…",
};

/** @param {string} jezik @param {string} tekst */
export function prevedi(jezik, tekst) {
  if (jezik !== "en") return tekst;
  return Object.prototype.hasOwnProperty.call(EN, tekst) ? EN[tekst] : tekst;
}

/** Prevoditelj za jedan jezik, da se ne traži jezik pri svakoj riječi. */
export function prevoditelj(jezik) {
  return (/** @type {string} */ tekst) => prevedi(jezik, tekst);
}

/**
 * Imenica uz broj. Hrvatski ima tri oblika, engleski dva.
 *
 * @param {number} n @param {string} jezik
 */
export function pjesama(n, jezik) {
  if (jezik === "en") return n === 1 ? "song" : "songs";
  const z = n % 100;
  if (z > 10 && z < 20) return "pjesama";
  const j = n % 10;
  if (j === 1) return "pjesma";
  if (j >= 2 && j <= 4) return "pjesme";
  return "pjesama";
}

/**
 * Cijela rečenica o višku, jer se po komadima ne da složiti: hrvatski uz broj
 * mijenja i glagol i imenicu i zamjenicu, a engleski samo imenicu.
 *
 * @param {number} n @param {string} jezik
 */
export function recenicaViska(n, jezik) {
  if (jezik === "en") {
    return n === 1 ? "1 song that is not on the list" : n + " songs that are not on the list";
  }
  const z = n % 100;
  const naest = z > 10 && z < 20;
  const j = n % 10;
  const stoji = !naest && j >= 2 && j <= 4 ? "stoje" : "stoji";
  const koje = !naest && j === 1 ? "koje" : "kojih";
  return stoji + " " + n + " " + pjesama(n, "hr") + " " + koje + " nema";
}

/* ---------- pamćenje izbora ---------- */

function citaj() {
  try {
    const j = localStorage.getItem(KLJUC);
    return j && JEZICI.includes(j) ? j : "hr";
  } catch {
    return "hr";
  }
}

let jezik = typeof localStorage === "undefined" ? "hr" : citaj();
/** @type {Set<() => void>} */
const slusatelji = new Set();

export const jezikStanje = {
  /** @param {() => void} f */
  prati(f) {
    slusatelji.add(f);
    return () => slusatelji.delete(f);
  },
  stanje() {
    return jezik;
  },
  /** @param {string} novi */
  postavi(novi) {
    if (!JEZICI.includes(novi) || novi === jezik) return;
    jezik = novi;
    try {
      localStorage.setItem(KLJUC, novi);
    } catch {
      /* Bez pamćenja jezik vrijedi do zatvaranja: bolje nego ne raditi. */
    }
    /* Pismo se mijenja i izvan Reacta: čitači zaslona i preglednik po ovome
       biraju izgovor i rastavljanje na kraju retka. */
    if (typeof document !== "undefined") document.documentElement.lang = novi;
    for (const f of slusatelji) f();
  },
  /** Drugi od dvaju jezika, za tipku koja ih izmjenjuje. */
  drugi() {
    return jezik === "hr" ? "en" : "hr";
  },
};

if (typeof document !== "undefined") document.documentElement.lang = jezik;
