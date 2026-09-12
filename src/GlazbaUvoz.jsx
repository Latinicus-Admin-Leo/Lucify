import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Eraser, FileArchive, FolderInput, Trash2, X } from "lucide-react";
import {
  dajPopis,
  obrisiSve,
  oznakeSnimaka,
  pocisti,
  procjena,
  trajno,
  uvezi,
  visak,
} from "./glazba-spremiste.mjs";
import { zatvoriOmote } from "./glazba-izvor.mjs";
import { jezikStanje, pjesama, prevoditelj, recenicaViska } from "./jezik.mjs";

/**
 * Okvir „Zbirka”: mapa s računala u zbirku ovoga uređaja.
 *
 * Ovo je par okviru „Dodaj pjesmu”, ali za drugu stranu. Ondje gdje iza Lucifyja
 * stoji poslužitelj, pjesma se dohvaća poveznicom i sprema na disk; ovdje
 * poslužitelja nema, pa zbirka dolazi gotova, iz mape koju je složio
 * `npm run izvezi`, i ostaje u samom uređaju.
 *
 * Uvozi se **jednom**, i onda više nikad: poslije toga Lucify radi bez mreže i
 * bez upaljenog računala.
 *
 * @param {{ naZatvori: () => void, naUvezeno: () => void }} props
 */
export default function GlazbaUvoz({ naZatvori, naUvezeno }) {
  const jezik = useSyncExternalStore(jezikStanje.prati, jezikStanje.stanje, jezikStanje.stanje);
  const t = useMemo(() => prevoditelj(jezik), [jezik]);

  const [stanje, setStanje] = useState(/** @type {any} */ (null));
  const [radi, setRadi] = useState(false);
  const [napredak, setNapredak] = useState(/** @type {any} */ (null));
  const [ishod, setIshod] = useState(/** @type {any} */ (null));
  const [greska, setGreska] = useState("");
  const [brisem, setBrisem] = useState(false);
  const mapaRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const datotekeRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  const osvjezi = useCallback(async () => {
    const [oznake, popis, mjesto, suvisno] = await Promise.all([
      oznakeSnimaka(),
      dajPopis(),
      procjena(),
      visak(),
    ]);
    setStanje({
      uZbirci: oznake.size,
      uPopisu: popis && popis.pjesme ? popis.pjesme.length : 0,
      mjesto,
      suvisno,
      /* Pita se samo, ne i traži: odgovor je na pregledniku. */
      trajno: await trajno(),
    });
  }, []);

  useEffect(() => {
    osvjezi();
  }, [osvjezi]);

  /* Odabir mape, a ne pojedinih datoteka. Atribut je nestandardan i nose ga
     samo preglednici na računalu i Chrome na Androidu; gdje ga nema, polje se
     ponaša kao obično, pa je tipka i dalje upotrebljiva. */
  useEffect(() => {
    const polje = mapaRef.current;
    if (!polje) return;
    polje.setAttribute("webkitdirectory", "");
    polje.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const naTipku = (e) => {
      /* Dok uvoz traje, okvir se ne zatvara: zatvoren bi nastavio raditi, a
         ne bi imao gdje javiti dokle je stigao. */
      if (e.key === "Escape" && !radi) naZatvori();
    };
    document.addEventListener("keydown", naTipku);
    return () => document.removeEventListener("keydown", naTipku);
  }, [naZatvori, radi]);

  /** @param {any} e */
  const naOdabir = async (e) => {
    const odabrane = Array.from(e.target.files || []);
    /* Polje se prazni odmah, da odabir iste mape drugi put opet javi promjenu. */
    e.target.value = "";
    if (!odabrane.length) return;

    setGreska("");
    setIshod(null);
    setRadi(true);
    setNapredak({ gotovo: 0, ukupno: odabrane.length, ime: "" });
    try {
      const r = await uvezi(/** @type {File[]} */ (odabrane), setNapredak);
      /* Stare adrese omota vrijede za stare slike, a upravo su stigle nove. */
      zatvoriOmote();
      setIshod(r);
      await osvjezi();
      naUvezeno();
    } catch (g) {
      setGreska((g && g.message) || t("Uvoz nije uspio."));
    } finally {
      setRadi(false);
      setNapredak(null);
    }
  };

  /**
   * Počisti ono čega u popisu više nema.
   *
   * Ide kroz isti `radi` kao i uvoz, pa se okvir dotad ne da zatvoriti: to je
   * brisanje, i mora se vidjeti dokle je stiglo. Popis se poslije čita iznova
   * jer su stare adrese omota upravo prestale vrijediti.
   */
  const ocisti = async () => {
    if (!stanje || !stanje.suvisno || !stanje.suvisno.snimke.length) return;
    setRadi(true);
    setGreska("");
    try {
      await pocisti(stanje.suvisno);
      zatvoriOmote();
      await osvjezi();
      naUvezeno();
    } catch (g) {
      setGreska((g && g.message) || t("Čišćenje nije uspjelo."));
    } finally {
      setRadi(false);
    }
  };

  const obrisi = async () => {
    setRadi(true);
    try {
      await obrisiSve();
      zatvoriOmote();
      setIshod(null);
      setBrisem(false);
      await osvjezi();
      naUvezeno();
    } finally {
      setRadi(false);
    }
  };

  const mjesto = stanje && stanje.mjesto;
  const suvisno = stanje && stanje.suvisno;
  const oVisku = suvisno && suvisno.snimke.length ? recenicaViska(suvisno.snimke.length, jezik) : null;
  const ugradena =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(display-mode: standalone)").matches;

  return (
    <div className="gokvir" onClick={() => (radi ? null : naZatvori())}>
      <div
        className="gkutija gdploca"
        role="dialog"
        aria-label={t("Zbirka na uređaju")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gdglava">
          <h2>{t("Zbirka")}</h2>
          <button
            type="button"
            className="gikona"
            aria-label={t("Zatvori")}
            disabled={radi}
            onClick={naZatvori}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="uz">
          {t(
            "Zbirka stoji na ovom uređaju i nigdje drugdje. Mapu slaže Lucify za računalo, naredbom",
          )}{" "}
          <code>npm run izvezi</code>
          {t("; prenesi je ovamo i odaberi je ovdje. Poslije toga glazba svira i bez mreže.")}
        </p>

        {/* Što uređaj trenutačno ima. Dvije mjere, jer odgovaraju na dva
            različita pitanja: koliko je pjesama došlo i koliko je mjesta
            ostalo. */}
        <div className="guredaj">
          <div className="guredajmjera">
            <b>{stanje ? stanje.uZbirci : "—"}</b>
            <span>
              {stanje && stanje.uPopisu && stanje.uZbirci < stanje.uPopisu
                ? (jezik === "en" ? "of " + stanje.uPopisu + " on the list" : "od " + stanje.uPopisu + " iz popisa")
                : (stanje ? pjesama(stanje.uZbirci, jezik) : pjesama(0, jezik)) + (jezik === "en" ? " on this device" : " na uređaju")}
            </span>
          </div>
          <div className="guredajmjera">
            <b>{mjesto ? koliko(mjesto.koristeno) : "—"}</b>
            <span>{mjesto && mjesto.ukupno
                ? (jezik === "en" ? "of " : "od ") + koliko(mjesto.ukupno)
                : t("zauzeto")}</span>
          </div>
        </div>

        {stanje && stanje.uPopisu > stanje.uZbirci ? (
          <p className="gdsitno">
            {jezik === "en"
              ? "The list knows of " +
                stanje.uPopisu +
                " songs, and " +
                stanje.uZbirci +
                " are here. The rest come with the next selection; the import continues rather than starting over."
              : "Popis zna za " +
                stanje.uPopisu +
                " pjesama, a ovdje ih je " +
                stanje.uZbirci +
                ". Ostale se dodaju sljedećim odabirom; uvoz se nastavlja, ne počinje ispočetka."}
          </p>
        ) : null}

        {radi ? (
          <div className="guredajradi">
            <p className="gdoznaka">
              {napredak && napredak.ime ? napredak.ime : t("Slažem zbirku…")}
            </p>
            <div className="gdtraka">
              <i
                style={{
                  width:
                    napredak && napredak.ukupno
                      ? Math.round((napredak.gotovo / napredak.ukupno) * 100) + "%"
                      : "0%",
                }}
              />
            </div>
            <p className="gdsitno">
              {napredak ? napredak.gotovo + " od " + napredak.ukupno : ""} · ne zatvaraj dok
              traje
            </p>
          </div>
        ) : (
          <>
            {/* Datoteka je prva, jer je jedna i jednaka na svakom sustavu:
                izvoz je složi, a ovdje je dosta jedan pritisak — i na iPhoneu,
                koji za mape ne zna. Mapa ostaje za onoga koji je izvezao mapu. */}
            <div className="gpno guredajtipke">
              <button
                type="button"
                className="glavna"
                onClick={() => datotekeRef.current && datotekeRef.current.click()}
              >
                <FileArchive size={16} aria-hidden="true" /> {t("Odaberi datoteku")}
              </button>
              <button
                type="button"
                className="gdodajtipka"
                onClick={() => mapaRef.current && mapaRef.current.click()}
              >
                <FolderInput size={16} aria-hidden="true" /> {t("Odaberi mapu")}
              </button>
            </div>
            <p className="gdsitno">
              Izvoz za mobitel složi <b>jednu datoteku</b>, i nju je dosta odabrati; u njoj je
              samo ono što ovaj uređaj još nema. Mapa i pojedine snimke i dalje prolaze: tada
              označi sve u mapi, zajedno s <code>popis.json</code>. Na iPhoneu mapa se ne da
              odabrati.
            </p>
          </>
        )}

        {/* Polja su skrivena, a ne stilizirana: preglednik ih crta svaki na
            svoj način, a tipka iznad je ista svugdje. `webkitdirectory` se
            postavlja kroz `ref`, a ne ovdje: nestandardan je, pa ga React ne
            poznaje, a prešutjeti to oznakom značilo bi lagati provjeri tipova
            umjesto zaobići rupu u njoj. */}
        <input ref={mapaRef} type="file" multiple hidden onChange={naOdabir} />
        <input ref={datotekeRef} type="file" multiple hidden onChange={naOdabir} />

        {greska ? <p className="gdgreska">{greska}</p> : null}

        {ishod ? (
          <div className="gdposlovi">
            <p className="gdstanje" data-stanje={ishod.greske.length ? "greska" : "gotovo"}>
              {ishod.doneseno
                ? (jezik === "en" ? "Brought in " : "Doneseno ") + ishod.doneseno + " " + pjesama(ishod.doneseno, jezik)
                : t("Nije doneseno ništa novo")}
              {ishod.preskoceno ? ", " + ishod.preskoceno + (jezik === "en" ? " already here" : " već bilo ovdje") : ""}
            </p>
            {ishod.greske.length ? (
              <div className="gdodbijene">
                {ishod.greske.slice(0, 8).map((/** @type {string} */ g, /** @type {number} */ i) => (
                  <span key={i}>{g}</span>
                ))}
                {ishod.greske.length > 8 ? (
                  <span>… i još {ishod.greske.length - 8}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Druga strana one mjere gore: ondje piše da popis zna za više nego što
            je ovdje došlo, a ovdje da je ovdje ostalo više nego što popis zna.
            Uvoz samo dodaje, pa pjesma izbačena na računalu ostaje ovdje, a
            `samoDostupno()` je sakrije iz popisa — mjesto svejedno drži. */}
        {oVisku && !radi ? (
          <div className="guredajvisak">
            <span className="gdsitno">
              {jezik === "en" ? "Here " : "Ovdje "}
              {oVisku}
              {suvisno.bajtova ? ", " + koliko(suvisno.bajtova) : ""}.{" "}
              {jezik === "en"
                ? "That does not play and is not shown, but it takes up room."
                : "To se ne svira i ne vidi, a mjesto drži."}
            </span>
            <button type="button" className="gdodajtipka" onClick={ocisti} disabled={radi}>
              <Eraser size={15} aria-hidden="true" /> {t("Počisti")}
            </button>
          </div>
        ) : null}

        {/* Zbirka koju preglednik smije počistiti nije zbirka. Na Androidu
            dodavanje na početni zaslon obično presudi, a na iPhoneu je to
            jedino što uopće pomaže. */}
        {stanje && !stanje.trajno && !ugradena ? (
          <p className="gdsitno guredajsavjet">
            Dodaj Lucify na početni zaslon. Preglednik tada zbirku drži trajnom; inače je
            smije počistiti sam, ako se dugo ne otvori.
          </p>
        ) : null}

        {stanje && stanje.uZbirci ? (
          <div className="guredajbrisi">
            {brisem ? (
              <>
                <span className="gdsitno">
                  Briše se svih {stanje.uZbirci} s ovoga uređaja. Srca i popisi ostaju.
                </span>
                <button type="button" className="gdodajtipka" onClick={obrisi} disabled={radi}>
                  Briši
                </button>
                <button type="button" className="gdodajtipka" onClick={() => setBrisem(false)}>
                  {t("Odustani")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="gdodajtipka"
                onClick={() => setBrisem(true)}
                disabled={radi}
              >
                <Trash2 size={15} aria-hidden="true" /> {t("Obriši zbirku s uređaja")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Bajtovi u „657 MB”. Ista mjera kao u `scripts/izvezi.mjs`, a ovdje stoji
 * zasebno zato što se odande ne uvozi: to je Node, a ovo preglednik.
 *
 * @param {number} bajtova
 */
function koliko(bajtova) {
  const mb = bajtova / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
  if (mb < 1) return Math.round(bajtova / 1024) + " kB";
  return Math.round(mb) + " MB";
}

