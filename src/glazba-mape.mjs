/**
 * Dvije glavne mape zbirke: „Hrvatske pjesme” i „Sve ostale pjesme”.
 *
 * Stoji u `src/`, a ne uz `scripts/glazba-zbirka.mjs`, jer istu odluku donose
 * dvoje: poslužitelj, kad pjesmu upisuje u popis, i sam Lucify, kad dobije
 * popis složen prije nego što su mape postojale. Kao i `glazba-veze.mjs`, ova
 * datoteka zato ne smije ništa ni od Nodea ni od preglednika.
 */

/**
 * Slova kojih u engleskom nema, a u hrvatskom ima. Naslov hrvatske pjesme s
 * YouTubea gotovo ih uvijek nosi, u imenu pjesme ili izvođača.
 */
const KVACICE = /[čćžšđ]/i;

/** Prvi izvođač iz potpisa, bez kvačica i velikih slova. @param {any} p */
function glavniIzvodac(p) {
  return String((p && p.izvodac) || "")
    .split(",")[0]
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Zbirka se dijeli po jeziku kojim se pjeva: u „Hrvatske pjesme” ide i ono što
 * je s istoga govornoga područja (Balašević, Dino Merlin), a u „Sve ostale” sve
 * drugo, pa i instrumentali.
 *
 * Odluka se zapisuje u popis kao `jezik`, jednom, pa se ovdje pogađa samo za
 * pjesmu koja ga još nema — onu koja je upravo stigla. Pogađa se po dvoje: je li
 * isti izvođač već među hrvatskima, i ima li u naslovu naših kvačica. Promašaj
 * se ispravlja u samom Lucifyju, izbornikom uz pjesmu.
 *
 * Mijenja predane zapise i vraća isto polje.
 *
 * @param {any[]} pjesme
 */
export function odrediJezike(pjesme) {
  const hrvatski = new Set(pjesme.filter((p) => p.jezik === "hr").map(glavniIzvodac));
  hrvatski.delete("");
  for (const p of pjesme) {
    if (p.jezik) continue;
    const tekst = [p.naslov, p.izvodac, p.izvorniNaslov].join(" ");
    p.jezik = hrvatski.has(glavniIzvodac(p)) || KVACICE.test(tekst) ? "hr" : "drugi";
  }
  return pjesme;
}
