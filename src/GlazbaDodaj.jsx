import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Play, X } from "lucide-react";
import { jezikStanje, prevoditelj } from "./jezik.mjs";
import { dajPreuzimac } from "./glazba-preuzimac.mjs";
import { procitajVeze } from "./glazba-veze.mjs";

/**
 * Okvir „Dodaj pjesmu”: iz poveznice s YouTubea ravno u zbirku.
 *
 * Sav posao radi preuzimač: na računalu onaj u `scripts/preuzimac.mjs`, a na
 * Androidu onaj iz `glazba-preuzimac-android.mjs`. Okvir s njima razgovara kroz
 * `glazba-preuzimac.mjs` i ne zna koji je iza njega. Na objavljenoj stranici
 * okvira nema: ondje nema ni yt-dlpa, ni ffmpega, ni mape u koju bi se spremilo.
 *
 * Napredovanje svih poslova dolazi **jednim** tokom, a ne jednim po poslu, jer
 * preglednik na isto ime domaćina drži najviše šest veza. Uz to taj tok pri
 * spajanju najprije pošalje zatečeno stanje, pa okvir koji se zatvori i
 * ponovno otvori zatekne svoje poslove ondje gdje su i bili.
 *
 * `pocetneVeze` stiže kad je poveznica podijeljena iz druge aplikacije, pa je
 * polje već popunjeno kad se okvir otvori.
 *
 * @param {{ naZatvori: () => void, naDodano: () => void, naPusti?: (id: string) => void,
 *           pocetneVeze?: string }} props
 */
export default function GlazbaDodaj({ naZatvori, naDodano, naPusti, pocetneVeze }) {
  const jezik = useSyncExternalStore(jezikStanje.prati, jezikStanje.stanje, jezikStanje.stanje);
  const t = useMemo(() => prevoditelj(jezik), [jezik]);

  const [preuzimac, setPreuzimac] = useState(
    /** @type {import("./glazba-preuzimac.mjs").Preuzimac | null} */ (null),
  );
  const [veze, setVeze] = useState(pocetneVeze || "");
  const [stanje, setStanje] = useState(/** @type {any} */ (null));
  const [kakvoca, setKakvoca] = useState("visoka");
  const [poslovi, setPoslovi] = useState(/** @type {any[]} */ ([]));
  const [greska, setGreska] = useState(/** @type {any} */ (null));
  const [salje, setSalje] = useState(false);
  const [osvjezava, setOsvjezava] = useState(false);

  /* Zbirka se osvježava kad koji posao završi. Pamti se koji su već javljeni,
     jer isti posao stigne kroz tok događaja više puta, a popis se ne treba
     dohvaćati po deset puta za istu pjesmu. */
  const javljeni = useRef(/** @type {Set<string>} */ (new Set()));
  const naDodanoRef = useRef(naDodano);
  naDodanoRef.current = naDodano;

  /* Nova podijeljena poveznica dok je okvir već otvoren ide u polje, uz ono
     što ondje već piše. */
  useEffect(() => {
    if (!pocetneVeze) return;
    setVeze((prije) => (prije.includes(pocetneVeze) ? prije : [prije, pocetneVeze].filter(Boolean).join("\n")));
  }, [pocetneVeze]);

  useEffect(() => {
    let ziv = true;
    dajPreuzimac()
      .then(async (p) => {
        if (!ziv) return;
        setPreuzimac(p);
        const s = await p.stanje();
        if (!ziv) return;
        setStanje(s);
        if (s && s.zadana) setKakvoca(s.zadana);
      })
      .catch(() => {
        if (ziv) setStanje({ ima: false, nedostupan: true });
      });
    return () => {
      ziv = false;
    };
  }, []);

  /*
   * Noviji yt-dlp, bez izlaska iz Lucifyja.
   *
   * yt-dlp prestane raditi čim YouTube promijeni svirač, a to biva svakih
   * nekoliko tjedana. Prije se to popravljalo izvana, pa je zapakirani program
   * s vremenom prestajao raditi i nije se imalo čime pomoći iznutra. Sada se
   * novi spušta uz zbirku, u korisnikovu mapu, jer se u `Program Files` ne
   * piše.
   */
  const naOsvjezi = useCallback(async () => {
    if (!preuzimac) return;
    setOsvjezava(true);
    setGreska(null);
    try {
      const tijelo = await preuzimac.osvjeziAlate();
      /* Stanje dolazi i kad padne, jer i tada treba pokazati što se ima: ako
         yt-dlpa nema nikako, to je druga poruka nego ako stari još radi. */
      if (tijelo.alati) {
        setStanje((/** @type {any} */ prije) => ({
          ...prije,
          ima: tijelo.alati.ytDlp.ima && tijelo.alati.ffmpeg.ima,
          alati: tijelo.alati,
        }));
      }
      if (!tijelo.ok) setGreska(tijelo.greska || { poruka: t("Nov yt-dlp nije stigao.") });
    } catch (e) {
      setGreska({
        poruka: t("Nov yt-dlp nije stigao."),
        detalj: e && /** @type {any} */ (e).message ? String(/** @type {any} */ (e).message) : "",
      });
    } finally {
      setOsvjezava(false);
    }
  }, [preuzimac]);

  useEffect(() => {
    if (!preuzimac) return undefined;
    return preuzimac.prati((p) => {
      setPoslovi((prije) => {
        const gdje = prije.findIndex((x) => x.id === p.id);
        if (gdje === -1) return [...prije, p];
        const kopija = [...prije];
        kopija[gdje] = p;
        return kopija;
      });
      if ((p.stanje === "gotovo" || p.stanje === "vec") && !javljeni.current.has(p.id)) {
        javljeni.current.add(p.id);
        naDodanoRef.current();
      }
    });
  }, [preuzimac]);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const naTipku = (e) => {
      if (e.key === "Escape") naZatvori();
    };
    document.addEventListener("keydown", naTipku);
    return () => document.removeEventListener("keydown", naTipku);
  }, [naZatvori]);

  const procitano = useMemo(() => procitajVeze(veze), [veze]);

  const posalji = useCallback(async () => {
    if (!procitano.prihvacene.length || !preuzimac) return;
    setGreska(null);
    setSalje(true);
    try {
      const podatci = await preuzimac.pretvori({
        veze: procitano.prihvacene.map((/** @type {any} */ v) => v.adresa).join("\n"),
        kakvoca,
      });
      if (!podatci.ok) {
        setGreska(podatci.greska || { poruka: t("Preuzimač je odbio taj zahtjev.") });
        return;
      }
      /* Prihvaćeno odlazi iz polja, a odbijeno ostaje, da se vidi što nije prošlo. */
      setVeze(procitano.greske.map((/** @type {any} */ g) => g.upisano).join("\n"));
      setPoslovi((prije) => {
        const kopija = [...prije];
        for (const p of podatci.poslovi) {
          const gdje = kopija.findIndex((x) => x.id === p.id);
          if (gdje === -1) kopija.push(p);
          else kopija[gdje] = p;
        }
        return kopija;
      });
    } catch {
      setGreska({ poruka: t(preuzimac.poruke.nedohvatljiv) });
    } finally {
      setSalje(false);
    }
  }, [procitano, kakvoca, preuzimac]);

  /** @param {string} id */
  const odustani = (id) => {
    if (preuzimac) preuzimac.odustani(id);
  };

  const ocisti = () => {
    for (const p of poslovi) {
      if (GOTOVI.includes(p.stanje) && preuzimac) preuzimac.zaboravi(p.id);
    }
    setPoslovi((prije) => prije.filter((p) => !GOTOVI.includes(p.stanje)));
  };

  const uTijeku = poslovi.filter((p) => !GOTOVI.includes(p.stanje)).length;
  const gotovih = poslovi.filter((p) => GOTOVI.includes(p.stanje)).length;

  return (
    <div className="gokvir" onClick={naZatvori}>
      <div
        className="gkutija gdploca"
        role="dialog"
        aria-label={t("Dodaj pjesmu")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gdglava">
          <h2>{t("Dodaj pjesmu")}</h2>
          <button type="button" className="gikona" aria-label={t("Zatvori")} onClick={naZatvori}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="uz">
          {t(
            "Zalijepi poveznicu s YouTubea, jednu ili cijeli popis. Zvuk se preuzme, pretvori u mp3 i odmah uđe u zbirku, pa je nađeš pod",
          )}{" "}
          <b>{t("Sve pjesme")}</b>.
        </p>

        <label className="gdoznaka" htmlFor="gdveze">
          {t("Poveznice")}
        </label>
        <textarea
          id="gdveze"
          className="gdpolje"
          value={veze}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=..."
          onChange={(e) => setVeze(e.target.value)}
        />

        <p className="gdmjera">{mjera(procitano, jezik)}</p>

        {procitano.greske.length ? (
          <ul className="gdodbijene">
            {procitano.greske.slice(0, 5).map((/** @type {any} */ g, i) => (
              <li key={i}>
                <code>{skrati(g.upisano, 44)}</code> {t(g.razlog)}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="gdkakvoca">
          {(stanje && stanje.kakvoce ? stanje.kakvoce : []).map((/** @type {any} */ k) => (
            <button
              key={k.id}
              type="button"
              className="gcip"
              aria-pressed={kakvoca === k.id}
              title={t(k.opis)}
              onClick={() => setKakvoca(k.id)}
            >
              {t(k.ime)}
            </button>
          ))}
        </div>

        {greska ? (
          <p className="gdgreska">
            {greska.poruka}
            {greska.detalj ? <span> {greska.detalj}</span> : null}
          </p>
        ) : null}

        {stanje && !stanje.ima ? (
          <p className="gdgreska">
            {stanje.nedostupan
              ? t(preuzimac ? preuzimac.poruke.nedostupan : "Preuzimač se ne javlja.")
              : t("Nedostaje ") +
                [
                  stanje.alati && !stanje.alati.ytDlp.ima ? "yt-dlp" : null,
                  stanje.alati && !stanje.alati.ffmpeg.ima ? "ffmpeg" : null,
                ]
                  .filter(Boolean)
                  .join(jezik === "en" ? " and " : " i ") +
                t(". Bez toga se ne može preuzimati.")}
          </p>
        ) : null}

        <div className="gdno">
          <button type="button" className="blijedo" onClick={naZatvori}>
            {t("Zatvori")}
          </button>
          <button
            type="button"
            className="glavna"
            disabled={salje || !procitano.prihvacene.length || !(stanje && stanje.ima)}
            onClick={posalji}
          >
            {salje ? t("Šaljem…") : t("Preuzmi")}
          </button>
        </div>

        {poslovi.length ? (
          <div className="gdposlovi">
            <div className="gdvrhpopisa">
              <h3>
                {uTijeku ? uTijeku + (jezik === "en" ? " running" : " u tijeku") : t("Ništa se ne preuzima")}
                {gotovih ? " · " + gotovih + (jezik === "en" ? " done" : " gotovo") : ""}
              </h3>
              {gotovih ? (
                <button type="button" className="gdveza" onClick={ocisti}>
                  {t("Očisti gotove")}
                </button>
              ) : null}
            </div>
            <ul>
              {poslovi.map((p) => (
                <li key={p.id} className="gdposao">
                  <div className="gdredaknaslov">
                    <span className="gdime">{p.naslov || t("Čitam podatke…")}</span>
                    <span className="gdstanje" data-stanje={p.stanje}>
                      {t(OPIS[p.stanje] || p.stanje)}
                    </span>
                  </div>
                  <div className="gdsitno">
                    {[p.kanal, p.trajanje ? mmss(p.trajanje) : null].filter(Boolean).join(" · ")}
                  </div>
                  {GOTOVI.includes(p.stanje) ? null : (
                    <div className="gdtraka">
                      <i style={{ width: p.posto + "%" }} />
                    </div>
                  )}
                  {p.greska ? <p className="gdgreska">{p.greska.poruka}</p> : null}
                  <div className="gdredakgumbi">
                    {GOTOVI.includes(p.stanje) ? null : (
                      <button type="button" className="gdveza" onClick={() => odustani(p.id)}>
                        {t("Odustani")}
                      </button>
                    )}
                    {p.pjesma && naPusti ? (
                      <button
                        type="button"
                        className="gdveza gdpusti"
                        onClick={() => naPusti(p.pjesma.id)}
                      >
                        <Play size={12} aria-hidden="true" /> {t("Pusti")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="gdalati">
          {stanje && stanje.alati && stanje.ima
            ? /* Na Androidu ffmpeg nema inačice koju bi se dalo ispisati. */
              [
                "yt-dlp " + stanje.alati.ytDlp.inacica,
                stanje.alati.ffmpeg.inacica ? "ffmpeg " + stanje.alati.ffmpeg.inacica : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : ""}
          {/* Tipka stoji i kad yt-dlpa uopće nema: tada je ona jedini način da
              stigne, a ne samo način da se osvježi. Nema je jedino ondje gdje
              iza Lucifyja ne stoji poslužitelj, jer ondje nema ni kamo. */}
          {stanje && !stanje.nedostupan ? (
            <button type="button" className="gdosvjezi" onClick={naOsvjezi} disabled={osvjezava}>
              {osvjezava
                ? t("dohvaćam…")
                : stanje.alati && stanje.alati.ytDlp.ima
                  ? t("osvježi yt-dlp")
                  : t("dohvati yt-dlp")}
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** Stanja iza kojih se više ništa ne događa. */
const GOTOVI = ["gotovo", "vec", "greska", "prekinuto"];

/* Ovdje stoji hrvatski, a ne prijevod: rječnik se otvara tek u prikazu, jer
   ovo je vani iz komponente, gdje jezika još nema. Isti su nizovi i ključevi u
   `jezik.mjs`, pa se prevode na mjestu na kojem se ispisuju. */
/** @type {Record<string, string>} */
const OPIS = {
  ceka: "Čeka red",
  citam: "Čitam",
  preuzimam: "Preuzimam",
  pretvaram: "Pretvaram",
  gotovo: "U zbirci",
  vec: "Već u zbirci",
  greska: "Nije uspjelo",
  prekinuto: "Prekinuto",
};

/**
 * Rečenica ispod polja: koliko je poveznica prepoznato dok se tipka.
 * @param {any} procitano
 */
function mjera(procitano, jezik) {
  const dijelovi = [];
  const n = procitano.prihvacene.length;
  if (n)
    dijelovi.push(
      jezik === "en"
        ? n + (n === 1 ? " link ready" : " links ready")
        : n + " " + (n === 1 ? "poveznica" : n < 5 ? "poveznice" : "poveznica") + " spremno",
    );
  if (procitano.ponovljene)
    dijelovi.push(
      procitano.ponovljene +
        (jezik === "en" ? " repeated, counted once" : " ponovljeno, broji se jednom"),
    );
  if (procitano.greske.length)
    dijelovi.push(procitano.greske.length + (jezik === "en" ? " unusable" : " neupotrebljivo"));
  return (
    dijelovi.join(" · ") ||
    (jezik === "en"
      ? "Paste one link, or a whole list of them."
      : "Zalijepi jednu poveznicu ili cijeli popis.")
  );
}

/**
 * Sekunde u „3:41”. Ista je funkcija i u `Glazba.jsx`, a ovdje stoji zasebno
 * zato što bi uvoz odande bio kružan: Lucify ovaj okvir dovlači tek kad se
 * otvori.
 * @param {number} s
 */
function mmss(s) {
  if (!s || !isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

/** @param {string} t @param {number} najvise */
function skrati(t, najvise) {
  return t.length > najvise ? t.slice(0, najvise - 1) + "…" : t;
}
