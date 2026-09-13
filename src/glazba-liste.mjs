/**
 * Vlastiti popisi koji stignu s računala, spojeni s onima koje uređaj ima.
 *
 * Uvoz zbirke **samo dodaje**, pa tako i ovo: s uređaja se ne miče ništa.
 * Popis kojega ovdje nema dođe cijel. Popis koji je već stigao prije (ista
 * oznaka) uzme naslov s računala i pjesme redom kojim ih računalo ima, a iza
 * njih ostanu one koje su mu dodane ovdje. Pjesma maknuta s popisa na računalu
 * zato ovdje ostaje; maknuti je se može i ovdje.
 *
 * @typedef {{ id: string, naslov: string, pjesme: string[] }} Lista
 * @param {Lista[]} ovdje
 * @param {Lista[]} stigle
 * @returns {Lista[]}
 */
export function spojiListe(ovdje, stigle) {
  if (!stigle.length) return ovdje;
  const poId = new Map(stigle.map((l) => [l.id, l]));
  const spojene = ovdje.map((l) => {
    const s = poId.get(l.id);
    if (!s) return l;
    poId.delete(l.id);
    const sRacunala = new Set(s.pjesme);
    return { ...l, naslov: s.naslov, pjesme: [...s.pjesme, ...l.pjesme.filter((p) => !sRacunala.has(p))] };
  });
  return [...spojene, ...poId.values()];
}

/**
 * Stanje s diska spojeno s onim što stranica ima u `localStorage`.
 *
 * Ništa se ne gubi: što ima disk, vrijedi, a iza toga dođe ono što ima samo
 * stranica. Tako ni prazan `localStorage` (Chromium ga zna obrisati sam) ne
 * isprazni datoteku, ni prazna datoteka (prvo pokretanje) ne isprazni stranicu.
 * Cijena je da se ono obrisano na jednoj strani, a ostalo na drugoj, vrati; to
 * se događa samo kad se njih dvoje raziđu, a stranica ih inače drži jednakima.
 *
 * Redoslijed polica ne zbraja se nego bira: dva reda ne daju treći. Vrijedi
 * onaj s diska, osim kad ga ondje još nema.
 *
 * @param {{ srca?: string[], liste?: Lista[], jezici?: Record<string, string>, nazivi?: Record<string, string>, poredak?: string[] } | null} disk
 * @param {{ srca: string[], liste: Lista[], jezici: Record<string, string>, nazivi: Record<string, string>, poredak: string[] }} ovdje
 */
export function spojiStanje(disk, ovdje) {
  if (!disk) return ovdje;
  const srca = disk.srca || [];
  const liste = disk.liste || [];
  const naDisku = new Set(liste.map((l) => l.id));
  const srcaNaDisku = new Set(srca);
  return {
    srca: [...srca, ...ovdje.srca.filter((s) => !srcaNaDisku.has(s))],
    liste: [...liste, ...ovdje.liste.filter((l) => !naDisku.has(l.id))],
    jezici: { ...ovdje.jezici, ...(disk.jezici || {}) },
    nazivi: { ...ovdje.nazivi, ...(disk.nazivi || {}) },
    poredak: disk.poredak && disk.poredak.length ? disk.poredak : ovdje.poredak,
  };
}

/**
 * Police složene redom koji je čovjek sam složio povlačenjem.
 *
 * Polica koje u tom redu nema (novi popis, izvođač koji je tek stigao) stoji
 * odmah iza police koja joj je u zadanom redu prethodila. Tako novi popis dođe
 * među popise, a ne na vrh ili na dno svega.
 *
 * @template {{ id: string }} T
 * @param {T[]} zadano
 * @param {string[]} poredak
 * @returns {T[]}
 */
export function slozi(zadano, poredak) {
  if (!poredak.length) return zadano;
  const poId = new Map(zadano.map((p) => [p.id, p]));
  const red = [...new Set(poredak)].filter((id) => poId.has(id));
  const u = new Set(red);
  zadano.forEach((p, i) => {
    if (u.has(p.id)) return;
    let mjesto = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = red.indexOf(zadano[j].id);
      if (k >= 0) {
        mjesto = k + 1;
        break;
      }
    }
    red.splice(mjesto, 0, p.id);
    u.add(p.id);
  });
  return red.map((id) => /** @type {T} */ (poId.get(id)));
}

/**
 * Novi red polica kad se jedna spusti na drugu.
 *
 * @param {string[]} red sve police, redom kojim sada stoje
 * @param {string} id polica koja se pomiče
 * @param {string} cilj polica na koju je spuštena
 * @param {boolean} iza ide li iza nje, a ne ispred
 * @returns {string[]}
 */
export function premjestiPolicu(red, id, cilj, iza) {
  if (id === cilj) return red;
  const bez = red.filter((x) => x !== id);
  const k = bez.indexOf(cilj);
  if (k < 0) return red;
  bez.splice(iza ? k + 1 : k, 0, id);
  return bez;
}

/**
 * Što odlazi iz zbirke kad se polica briše ili prazni.
 *
 * Pjesma ostaje ako je i u nekom drugom vlastitom popisu ili u srcima, jer je
 * ondje čovjek još hoće. Glavne mape se pritom ne broje: u jednoj od njih stoji
 * svaka pjesma, pa se inače ne bi dalo obrisati ništa.
 *
 * @param {{ id: string, vrsta: string, pjesme: string[] }} polica
 * @param {Lista[]} liste
 * @param {string[]} srca
 * @returns {{ odlaze: string[], ostaju: string[] }}
 */
export function stoOdlazi(polica, liste, srca) {
  /** @type {Set<string>} */
  const drugdje = new Set();
  for (const l of liste) if (!(polica.vrsta === "lista" && l.id === polica.id)) l.pjesme.forEach((p) => drugdje.add(p));
  if (polica.vrsta !== "srca") srca.forEach((p) => drugdje.add(p));
  const pjesme = [...new Set(polica.pjesme)];
  return {
    odlaze: pjesme.filter((p) => !drugdje.has(p)),
    ostaju: pjesme.filter((p) => drugdje.has(p)),
  };
}
