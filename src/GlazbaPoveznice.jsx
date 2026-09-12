import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import { adresaSnimke } from "./glazba-veze.mjs";
import { KORIJEN } from "./glazba-svirac.mjs";

/**
 * Okvir „Poveznice”: cijela zbirka ispisana kao gole YouTube adrese, u
 * stranicama, da se mogu prenijeti na mobitel.
 *
 * Glazbe u objavljenom Lucifyju nema i neće je biti: snimke su tuđe autorsko
 * djelo, pa `Glazba/Zvuk/` ne ulazi ni u git ni u `dist/`. Adresa snimke,
 * međutim, nije snimka. Nju `npm run glazba` zapisuje u
 * `public/poveznice.json`, ta datoteka smije u git, i tako popis zbirke stigne
 * i onamo gdje same zbirke nema.
 *
 * Otkad se zbirka na uređaj može i unijeti, ovo više nije jedini način da se do
 * nje dođe, ali jest jedini način da se iz nje izađe: ovdje stoje gole adrese,
 * pa se zbirka može predati dalje ili posložiti drugdje.
 *
 * Poveznice dolaze iz dvaju izvora. Ondje gdje zbirka postoji, uzimaju se ravno
 * iz nje, jer je ona uvijek svježija: pjesma preuzeta prije minute u njoj već
 * jest, a u `poveznice.json` ulazi tek pri idućem `npm run glazba`. Na uređaju
 * na koji zbirka još nije unesena dohvaća se ta datoteka.
 */

/* Stranica nosi dvadeset sedam poveznica. Broj je odabran, a ne izračunat: toliko
   ih stane u jedan prijenos a da se ne izgubi mjesto na kojem si stao. */
const PO_STRANICI = 27;

/**
 * @param {{ pjesme: any[], naZatvori: () => void }} props
 */
export default function GlazbaPoveznice({ pjesme, naZatvori }) {
  const [preuzeto, setPreuzeto] = useState(/** @type {any[] | null} */ (null));
  const [stranica, setStranica] = useState(0);
  const [kopirano, setKopirano] = useState(false);
  const poljeRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

  /* Datoteka se dohvaća samo ondje gdje zbirke nema, jer je zbirka, kad
     postoji, i točnija. */
  const trebaDohvatiti = !pjesme.length;
  useEffect(() => {
    if (!trebaDohvatiti) return undefined;
    let ziv = true;
    fetch(KORIJEN + "poveznice.json", { cache: "no-cache" })
      .then((o) => (o.ok ? o.json() : Promise.reject(new Error(String(o.status)))))
      .then((p) => {
        if (ziv) setPreuzeto((p && p.pjesme) || []);
      })
      .catch(() => {
        if (ziv) setPreuzeto([]);
      });
    return () => {
      ziv = false;
    };
  }, [trebaDohvatiti]);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const naTipku = (e) => {
      if (e.key === "Escape") naZatvori();
    };
    document.addEventListener("keydown", naTipku);
    return () => document.removeEventListener("keydown", naTipku);
  }, [naZatvori]);

  /* Oba se izvora svode na isti oblik. Zbirka nosi golu oznaku snimke, a
     zapisana datoteka već punu adresu, jer se ona piše jednom, a čita na
     mobitelu, gdje ništa ne treba računati. */
  const veze = useMemo(() => {
    const izvor = pjesme.length ? pjesme : preuzeto || [];
    return izvor
      .filter((p) => p.adresa || p.yt)
      .map((p) => ({
        naslov: p.naslov,
        izvodac: p.izvodac,
        adresa: p.adresa || adresaSnimke(p.yt),
      }));
  }, [pjesme, preuzeto]);

  const ukupno = Math.max(1, Math.ceil(veze.length / PO_STRANICI));
  /* Stranica se ne pamti u stanju nego se svaki put pritegne na ono što
     zbirka trenutačno ima: popis se pod rukom može smanjiti. */
  const sada = Math.min(stranica, ukupno - 1);
  const od = sada * PO_STRANICI;
  const ovdje = veze.slice(od, od + PO_STRANICI);
  const tekst = ovdje.map((v) => v.adresa).join("\n");

  /* Znak „kopirano” gasne sam, pa se ne mora gasiti rukom. */
  useEffect(() => {
    if (!kopirano) return undefined;
    const sat = setTimeout(() => setKopirano(false), 1800);
    return () => clearTimeout(sat);
  }, [kopirano]);

  const kopiraj = useCallback(() => {
    /* `navigator.clipboard` traži sigurnu vezu. Na `localhost` i na objavljenoj
       stranici je ima, ali ako je nema, ostaje označavanje samoga polja: ono
       radi svugdje, a na mobitelu je ionako uobičajen način. */
    const rezerva = () => {
      const polje = poljeRef.current;
      if (!polje) return false;
      polje.focus();
      polje.select();
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(tekst)
        .then(() => setKopirano(true))
        .catch(() => setKopirano(rezerva()));
      return;
    }
    setKopirano(rezerva());
  }, [tekst]);

  /** @param {number} smjer */
  const pomakni = (smjer) => {
    setStranica(Math.max(0, Math.min(ukupno - 1, sada + smjer)));
    setKopirano(false);
  };

  const ucitava = trebaDohvatiti && preuzeto === null;

  return (
    <div className="gokvir" onClick={naZatvori}>
      <div
        className="gkutija gpploca"
        role="dialog"
        aria-label="Poveznice"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gdglava">
          <h2>Poveznice</h2>
          <button type="button" className="gikona" aria-label="Zatvori" onClick={naZatvori}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="uz">
          Cijela zbirka kao gole YouTube adrese, po {PO_STRANICI} odjednom. Kopiraj stranicu,
          prijeđi na sljedeću, i zbirka je na mobitelu — bez ijednog megabajta glazbe na
          objavljenoj stranici.
        </p>

        {ucitava ? (
          <p className="gpprazno">Otvaram popis…</p>
        ) : !veze.length ? (
          <p className="gpprazno">
            Poveznica još nema. Zapisuju se u <code>public/poveznice.json</code> čim u zbirku
            uđe pjesma, a ta datoteka smije u git.
          </p>
        ) : (
          <>
            <div className="gpbroj">
              <span>
                <b>
                  {od + 1}–{od + ovdje.length}
                </b>{" "}
                od {veze.length}
              </span>
              <span className="gpstr">
                <button
                  type="button"
                  className="gikona gplist"
                  aria-label="Prethodna stranica"
                  disabled={sada === 0}
                  onClick={() => pomakni(-1)}
                >
                  <ChevronLeft size={17} aria-hidden="true" />
                </button>
                <span className="gpbrojstr">
                  stranica {sada + 1} od {ukupno}
                </span>
                <button
                  type="button"
                  className="gikona gplist"
                  aria-label="Sljedeća stranica"
                  disabled={sada >= ukupno - 1}
                  onClick={() => pomakni(1)}
                >
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              </span>
            </div>

            <textarea
              ref={poljeRef}
              className="gppolje"
              value={tekst}
              rows={9}
              readOnly
              spellCheck={false}
              aria-label={"Poveznice, stranica " + (sada + 1)}
              onFocus={(e) => e.currentTarget.select()}
            />

            {/* Naslovi stoje ispod polja, a ne u njemu: kopira se ono što
                YouTube prima, dakle sama adresa, ali se mora vidjeti i što je u
                stranici, inače je to dvadeset sedam jednakih redaka. */}
            <ol className="gpnaslovi" start={od + 1}>
              {ovdje.map((v) => (
                <li key={v.adresa}>
                  <span className="gpn">{v.naslov}</span>
                  {v.izvodac ? <span className="gpi">{v.izvodac}</span> : null}
                </li>
              ))}
            </ol>

            <div className="gpno">
              <button type="button" className="glavna gpkopiraj" onClick={kopiraj}>
                {kopirano ? (
                  <>
                    <Check size={16} aria-hidden="true" /> Kopirano
                  </>
                ) : (
                  <>
                    <Copy size={16} aria-hidden="true" /> Kopiraj stranicu
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
