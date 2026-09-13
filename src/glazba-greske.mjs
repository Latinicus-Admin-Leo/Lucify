/**
 * Od yt-dlpova ispisa jedna rečenica s kojom se može nešto poduzeti.
 *
 * Stoji u `src/`, a ne uz `scripts/preuzimac-posao.mjs`, jer isti ispis čitaju
 * dvoje: preuzimač na poslužitelju i Lucify na Androidu, gdje yt-dlp radi u
 * samom mobitelu. Kao i `glazba-veze.mjs`, ova datoteka zato ne smije ništa ni
 * od Nodea ni od preglednika.
 *
 * Uzorci ostaju engleski, jer je engleski i ono što yt-dlp ispisuje.
 */

/** @type {[RegExp, string, string][]} */
const PRAVILA = [
  [/Private video/i, "PRIVATNO", "Ova je snimka privatna."],
  [/members[- ]only|join this channel/i, "ZA_ČLANOVE", "Ova je snimka samo za članove kanala."],
  [
    /video (is )?unavailable|has been removed|no longer available|does not exist/i,
    "NEMA_JE",
    "Ove snimke više nema ili je uklonjena.",
  ],
  [
    /confirm your age|age[- ]restricted|inappropriate for some users/i,
    "DOB",
    "Ova snimka traži potvrdu dobi, pa se ne može pročitati bez prijave.",
  ],
  [
    /not a bot|Sign in to confirm|cookies/i,
    "PRIJAVA",
    "YouTube za ovaj zahtjev traži prijavu. Pokušaj poslije.",
  ],
  [/not available in your country|blocked it .*country|geo/i, "DRŽAVA", "Ova je snimka zaključana za ovu zemlju."],
  [/HTTP Error 429|Too Many Requests/i, "PREVIŠE", "YouTube usporava ovaj uređaj. Pričekaj pa pokušaj opet."],
  [/Requested format is not available/i, "BEZ_ZAPISA", "Za ovu snimku nije ponuđen nijedan zvučni zapis."],
  [/Unsupported URL/i, "NEPOZNATA", "yt-dlp ne prepoznaje tu poveznicu."],
  [
    /getaddrinfo|Failed to resolve|Temporary failure|Connection refused|Network is unreachable|urlopen error/i,
    "MREŽA",
    "Ne mogu doći do YouTubea. Provjeri internet.",
  ],
  [
    /nsig extraction failed|Signature extraction failed|update .*yt-dlp|player .* not found/i,
    "STARI_YTDLP",
    "yt-dlp je zastario za današnji YouTube. Osvježi ga i pokušaj opet.",
  ],
];

/**
 * Oznaka, poruka i zadnji redak greške iz ispisa. Kad nijedno pravilo ne
 * pogodi, poruka je ona zadana.
 *
 * @param {string} rep ispis yt-dlpa
 * @param {string} zadano
 * @returns {{ oznaka: string, poruka: string, detalj: string }}
 */
export function procitajGresku(rep, zadano) {
  const tekst = String(rep || "");
  for (const [uzorak, oznaka, poruka] of PRAVILA) {
    if (uzorak.test(tekst)) return { oznaka, poruka, detalj: zadnjaGreska(tekst) };
  }
  return { oznaka: "NEUSPJEH", poruka: zadano, detalj: zadnjaGreska(tekst) };
}

/** @param {string} rep */
function zadnjaGreska(rep) {
  const redci = String(rep)
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const greska = [...redci].reverse().find((r) => /^error/i.test(r));
  return (greska || redci[redci.length - 1] || "").slice(0, 300);
}
