import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import { jezikStanje, prevoditelj } from "./jezik.mjs";
import { adresaSnimke } from "./glazba-veze.mjs";
import { KORIJEN } from "./glazba-svirac.mjs";
import { omotAdresa } from "./glazba-izvor.mjs";

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
 *
 * Izgled: prije su adrese stajale u polju za tekst, a naslovi ispod njega, u
 * dva stupca s vlastitim klizačem, pa je isti popis bio ispisan dvaput, s tri
 * klizača u jednom okviru. Sada je popis jedan — omot, naslov, izvođač i
 * oznaka snimke u istom retku — a kopira se isto što i prije, gole adrese.
 */

/* Stranica nosi dvadeset sedam poveznica. Broj je odabran, a ne izračunat: toliko
   ih stane u jedan prijenos a da se ne izgubi mjesto na kojem si stao. */
const PO_STRANICI = 27;

/**
 * Imenica ženskoga roda na -a uz broj: „1 stranica”, „3 stranice”, „12 stranica”.
 * Jednina i množina od pet naviše ovdje su isti oblik, pa trebaju samo dva.
 * @param {number} n @param {string} jedna @param {string} dvije
 */
function oblik(n, jedna, dvije) {
  const z = n % 100;
  const j = n % 10;
  return j >= 2 && j <= 4 && !(z > 10 && z < 20) ? dvije : jedna;
}

/**
 * @param {{ pjesme: any[], naZatvori: () => void }} props
 */
export default function GlazbaPoveznice({ pjesme, naZatvori }) {
  const jezik = useSyncExternalStore(jezikStanje.prati, jezikStanje.stanje, jezikStanje.stanje);
  const t = useMemo(() => prevoditelj(jezik), [jezik]);

  const [preuzeto, setPreuzeto] = useState(/** @type {any[] | null} */ (null));
  const [stranica, setStranica] = useState(0);
  const [kopirano, setKopirano] = useState(false);
  /* Koje su stranice već kopirane, dok je okvir otvoren. Po tome se u nizu
     stranica vidi dokle se stiglo, pa se ne kopira ista dvaput. */
  const [gotove, setGotove] = useState(/** @type {() => Set<number>} */ (() => new Set()));
  const poljeRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const popisRef = useRef(/** @type {HTMLOListElement | null} */ (null));

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
      .map((p) => {
        const adresa = p.adresa || adresaSnimke(p.yt);
        const oznaka = (String(adresa).match(/[?&]v=([A-Za-z0-9_-]{11})/) || [])[1] || "";
        return { naslov: p.naslov, izvodac: p.izvodac, omot: p.omot || "", adresa, oznaka };
      });
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
    const uspjelo = () => {
      setKopirano(true);
      setGotove((g) => new Set(g).add(sada));
    };
    /* `navigator.clipboard` traži sigurnu vezu. Na `localhost` i na objavljenoj
       stranici je ima, ali ako je nema, ostaje skriveno polje s istim tekstom:
       označi se i kopira starim putem, koji radi svugdje. */
    const rezerva = () => {
      const polje = poljeRef.current;
      if (!polje) return;
      polje.focus();
      polje.select();
      try {
        if (document.execCommand("copy")) uspjelo();
      } catch {
        /* ne da se ni tako; gumb ostaje kakav je bio */
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tekst).then(uspjelo).catch(rezerva);
      return;
    }
    rezerva();
  }, [tekst, sada]);

  /** @param {number} broj */
  const idiNa = (broj) => {
    setStranica(Math.max(0, Math.min(ukupno - 1, broj)));
    setKopirano(false);
    if (popisRef.current) popisRef.current.scrollTop = 0;
  };

  const ucitava = trebaDohvatiti && preuzeto === null;

  return (
    <div className="gokvir" onClick={naZatvori}>
      <div
        className="gkutija gpploca"
        role="dialog"
        aria-label={t("Poveznice")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gpglava">
          <div className="gpnatpis">
            <h2>{t("Poveznice")}</h2>
            {veze.length ? (
              <span>
                {veze.length}{" "}
                {jezik === "en" ? (veze.length === 1 ? "link" : "links") : oblik(veze.length, "poveznica", "poveznice")}{" "}
                &middot; {ukupno}{" "}
                {jezik === "en" ? (ukupno === 1 ? "page" : "pages") : oblik(ukupno, "stranica", "stranice")}
              </span>
            ) : null}
          </div>
          <button type="button" className="gikona" aria-label={t("Zatvori")} onClick={naZatvori}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="gpuz">
          {jezik === "en"
            ? "The whole collection as bare YouTube links, " +
              PO_STRANICI +
              " per page. Copy a page, move on to the next, and the collection is on your phone."
            : "Cijela zbirka kao gole YouTube poveznice, po " +
              PO_STRANICI +
              " na stranici. Kopiraj stranicu, prijeđi na sljedeću, i zbirka je na mobitelu."}
        </p>

        {ucitava ? (
          <p className="gpprazno">{t("Otvaram popis…")}</p>
        ) : !veze.length ? (
          <p className="gpprazno">
            Poveznica još nema. Zapisuju se u <code>public/poveznice.json</code> čim u zbirku
            uđe pjesma, a ta datoteka smije u git.
          </p>
        ) : (
          <>
            {/* Sve stranice odjednom, kao brojevi: kopirane su označene, pa se
                odmah vidi koja je sljedeća. */}
            {ukupno > 1 ? (
              <div className="gpstranice" role="tablist" aria-label={t("Stranice")}>
                {Array.from({ length: ukupno }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    role="tab"
                    aria-selected={n === sada}
                    className={"gpstr" + (gotove.has(n) ? " gotova" : "")}
                    onClick={() => idiNa(n)}
                  >
                    {n + 1}
                  </button>
                ))}
              </div>
            ) : null}

            <ol className="gppopis" ref={popisRef} start={od + 1}>
              {ovdje.map((v, i) => (
                <li key={v.adresa + i}>
                  <span className="gpbr">{od + i + 1}</span>
                  <span className="gpomot">
                    {v.omot && omotAdresa(v.omot) ? (
                      <img src={omotAdresa(v.omot)} alt="" loading="lazy" />
                    ) : (
                      <span>{String(v.naslov || "?").trim().charAt(0).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="gptekst">
                    <b>{v.naslov}</b>
                    {v.izvodac ? <span>{v.izvodac}</span> : null}
                  </span>
                  <code className="gpoznaka" title={v.adresa}>
                    {v.oznaka}
                  </code>
                </li>
              ))}
            </ol>

            {/* Kopira se odavde. Skriveno je, a ne izostavljeno, jer bez
                sigurne veze drugoga puta do međuspremnika nema. */}
            <textarea
              ref={poljeRef}
              className="gpskriveno"
              value={tekst}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />

            <div className="gpno">
              <div className="gplistaj">
                <button
                  type="button"
                  className="gikona"
                  aria-label={t("Prethodna stranica")}
                  disabled={sada === 0}
                  onClick={() => idiNa(sada - 1)}
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <span>
                  <b>
                    {od + 1}–{od + ovdje.length}
                  </b>{" "}
                  {jezik === "en" ? "of" : "od"} {veze.length}
                </span>
                <button
                  type="button"
                  className="gikona"
                  aria-label={t("Sljedeća stranica")}
                  disabled={sada >= ukupno - 1}
                  onClick={() => idiNa(sada + 1)}
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className={"glavna gpkopiraj" + (kopirano ? " kopirano" : "")}
                onClick={kopiraj}
              >
                {kopirano ? (
                  <>
                    <Check size={16} aria-hidden="true" /> {t("Kopirano")}
                  </>
                ) : (
                  <>
                    <Copy size={16} aria-hidden="true" /> {t("Kopiraj stranicu")}
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
