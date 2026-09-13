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
 * @param {{ srca?: string[], liste?: Lista[], jezici?: Record<string, string>, nazivi?: Record<string, string> } | null} disk
 * @param {{ srca: string[], liste: Lista[], jezici: Record<string, string>, nazivi: Record<string, string> }} ovdje
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
  };
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
