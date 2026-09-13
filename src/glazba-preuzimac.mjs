/**
 * S kim okvir „Dodaj pjesmu” razgovara.
 *
 * Na `npm run dev` i u namjenskoj aplikaciji iza Lucifyja stoji poslužitelj, pa
 * se poslovi šalju na `/preuzmi/`, a napredak stiže tokom događaja. Na Androidu
 * poslužitelja nema: yt-dlp radi u samom mobitelu, a red čekanja drži
 * `glazba-preuzimac-android.mjs`.
 *
 * Okvir ne zna koji je od njih dvaju iza njega. Oba daju isto: isto stanje,
 * iste poslove, istoga oblika, i iste greške. Zato se okvir nije mijenjao kad
 * je stigao Android, osim što sada zove ovo umjesto `fetch`.
 */

import { ANDROID } from "./glazba-izvor.mjs";

/**
 * @typedef {object} Preuzimac
 * @property {() => Promise<any>} stanje alati, kakvoće i zadana kakvoća; pukne ako se preuzimač ne javlja
 * @property {() => Promise<any>} osvjeziAlate nov yt-dlp; vraća `{ ok, alati, greska }`
 * @property {(zahtjev: { veze: string, kakvoca: string }) => Promise<any>} pretvori vraća `{ ok, poslovi, greska }`
 * @property {(naPromjenu: (posao: any) => void) => () => void} prati vraća odjavu
 * @property {(id: string) => void} odustani
 * @property {(id: string) => void} zaboravi
 * @property {{ nedostupan: string, nedohvatljiv: string }} poruke
 */

/** @type {Preuzimac} */
const posluzitelj = {
  async stanje() {
    const odgovor = await fetch("/preuzmi/stanje");
    return odgovor.json();
  },

  async osvjeziAlate() {
    const odgovor = await fetch("/preuzmi/alati", { method: "POST" });
    return { ok: odgovor.ok, ...(await odgovor.json()) };
  },

  async pretvori(zahtjev) {
    const odgovor = await fetch("/preuzmi/pretvori", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zahtjev),
    });
    return { ok: odgovor.ok, ...(await odgovor.json()) };
  },

  prati(naPromjenu) {
    const tok = new EventSource("/preuzmi/dogadaji");
    tok.onmessage = (dogadaj) => naPromjenu(JSON.parse(dogadaj.data));
    /* Tok koji pukne ne zatvara se rukom: `EventSource` se sam ponovno spaja, a
       dulje preuzimanje mora nadživjeti i ponovno pokretanje poslužitelja. */
    return () => tok.close();
  },

  odustani(id) {
    fetch("/preuzmi/odustani?id=" + encodeURIComponent(id), { method: "POST" }).catch(() => {});
  },

  zaboravi(id) {
    fetch("/preuzmi/zaboravi?id=" + encodeURIComponent(id), { method: "POST" }).catch(() => {});
  },

  poruke: {
    nedostupan: "Preuzimač se ne javlja. On radi samo uz `npm run dev`.",
    nedohvatljiv: "Ne mogu doći do preuzimača. Radi li još `npm run dev`?",
  },
};

/**
 * Preuzimač za ovo mjesto. Androidov se uvozi tek ovdje, i samo uz
 * `ANDROID`, pa u objavljenoj stranici i u namjenskoj aplikaciji ispada iz
 * izlaza zajedno s Capacitorom.
 *
 * @returns {Promise<Preuzimac>}
 */
export async function dajPreuzimac() {
  if (ANDROID) return (await import("./glazba-preuzimac-android.mjs")).preuzimac;
  return posluzitelj;
}
