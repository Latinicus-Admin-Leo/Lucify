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
