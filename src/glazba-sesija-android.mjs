/**
 * Svirač na Androidu: obavijest, zaključan zaslon i tipke na slušalicama.
 *
 * U pregledniku to radi `navigator.mediaSession`, a Chrome od toga sam složi
 * obavijest i drži zvuk živim dok je zaslon ugašen. Android WebView ne radi
 * ni jedno ni drugo, pa bi glazba stala čim se Lucify skloni. Zato ovdje
 * stoji dodatak `@capgo/capacitor-media-session`, koji pokrene uslugu u
 * prvom planu, s obaviješću, i u nju prenosi što svira i koje su tipke.
 *
 * Uvozi se samo uz `ANDROID`, iz `glazba-svirac.mjs`.
 */

import { MediaSession } from "@capgo/capacitor-media-session";

/**
 * Tipke iz obavijesti vežu se jednom, na funkcije svirača.
 *
 * @param {{ pusti: () => void, stani: () => void, pomakni: (smjer: number) => void,
 *           premotaj: (s: number) => void }} svirac
 */
export function vezi(svirac) {
  const tipke = /** @type {[any, (d: any) => void][]} */ ([
    ["play", () => svirac.pusti()],
    ["pause", () => svirac.stani()],
    ["previoustrack", () => svirac.pomakni(-1)],
    ["nexttrack", () => svirac.pomakni(1)],
    [
      "seekto",
      (d) => {
        if (d && Number.isFinite(d.seekTime)) svirac.premotaj(d.seekTime);
      },
    ],
  ]);
  for (const [action, rukovatelj] of tipke) {
    MediaSession.setActionHandler({ action }, rukovatelj).catch(() => {});
  }
}

/**
 * Omot kao `data:` adresa. Na uređaju je omot `blob:`, a ta adresa vrijedi
 * samo unutar stranice, pa je Java ne bi mogla otvoriti.
 *
 * @param {string} adresa
 * @returns {Promise<string>}
 */
async function uTekst(adresa) {
  if (!adresa || adresa.slice(0, 5) !== "blob:") return adresa;
  const slika = await (await fetch(adresa)).blob();
  return new Promise((vrati) => {
    const citac = new FileReader();
    citac.onload = () => vrati(String(citac.result || ""));
    citac.onerror = () => vrati("");
    citac.readAsDataURL(slika);
  });
}

/**
 * Što svira, za obavijest.
 * @param {{ naslov: string, izvodac: string, omot: string }} p
 */
export async function objavi(p) {
  const src = await uTekst(p.omot).catch(() => "");
  await MediaSession.setMetadata({
    title: p.naslov,
    artist: p.izvodac,
    album: "Lucify",
    artwork: src ? [{ src, sizes: "512x512", type: "image/jpeg" }] : [],
  }).catch(() => {});
}

/**
 * Svira li i gdje je. Obavijest iz ovoga crta i traku, a usluga po stanju zna
 * smije li zaslon ugasiti zvuk.
 *
 * @param {"playing" | "paused" | "none"} stanje
 * @param {number} vrijeme @param {number} ukupno
 */
export function javi(stanje, vrijeme, ukupno) {
  MediaSession.setPlaybackState({ playbackState: stanje }).catch(() => {});
  if (ukupno > 0) {
    MediaSession.setPositionState({
      duration: ukupno,
      position: Math.max(0, Math.min(vrijeme, ukupno)),
      playbackRate: 1,
    }).catch(() => {});
  }
}
