import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { procitajVeze } from "./glazba-veze.mjs";

/**
 * Okvir „Dodaj pjesmu”: iz poveznice s YouTubea ravno u zbirku.
 *
 * Sav posao radi preuzimač u `scripts/preuzimac.mjs`, koji stoji samo na
 * razvojnom poslužitelju. Zato se ovaj okvir i otvara samo ondje: na objavljenoj
 * stranici nema ni yt-dlpa, ni ffmpega, ni mape u koju bi se spremilo.
 *
 * Napredovanje svih poslova dolazi **jednim** tokom događaja
 * (`/preuzmi/dogadaji`), a ne jednim po poslu, jer preglednik na isto ime
 * domaćina drži najviše šest veza. Uz to taj tok pri spajanju najprije pošalje
 * zatečeno stanje, pa okvir koji se zatvori i ponovno otvori zatekne svoje
 * poslove ondje gdje su i bili.
 *
 * @param {{ naZatvori: () => void, naDodano: () => void, naPusti?: (id: string) => void }} props
 */
export default function GlazbaDodaj({ naZatvori, naDodano, naPusti }) {
  const [veze, setVeze] = useState("");
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

  useEffect(() => {
    let ziv = true;
    fetch("/preuzmi/stanje")
      .then((o) => o.json())
      .then((s) => {
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
    setOsvjezava(true);
    setGreska(null);
    try {
      const odgovor = await fetch("/preuzmi/alati", { method: "POST" });
      const tijelo = await odgovor.json();
      /* Stanje dolazi i kad padne, jer i tada treba pokazati što se ima: ako
         yt-dlpa nema nikako, to je druga poruka nego ako stari još radi. */
      if (tijelo.alati) {
        setStanje((/** @type {any} */ prije) => ({
          ...prije,
          ima: tijelo.alati.ytDlp.ima && tijelo.alati.ffmpeg.ima,
          alati: tijelo.alati,
        }));
      }
      if (!odgovor.ok) setGreska(tijelo.greska || { poruka: "Nov yt-dlp nije stigao." });
    } catch (e) {
      setGreska({
        poruka: "Nov yt-dlp nije stigao.",
        detalj: e && /** @type {any} */ (e).message ? String(/** @type {any} */ (e).message) : "",
      });
    } finally {
      setOsvjezava(false);
    }
  }, []);

  useEffect(() => {
    const tok = new EventSource("/preuzmi/dogadaji");
    tok.onmessage = (dogadaj) => {
      const p = JSON.parse(dogadaj.data);
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
    };
    /* Tok koji pukne ne zatvara se rukom: `EventSource` se sam ponovno spaja, a
       dulje preuzimanje mora nadživjeti i ponovno pokretanje poslužitelja. */
    return () => tok.close();
  }, []);

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
    if (!procitano.prihvacene.length) return;
    setGreska(null);
    setSalje(true);
    try {
      const odgovor = await fetch("/preuzmi/pretvori", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veze: procitano.prihvacene.map((/** @type {any} */ v) => v.adresa).join("\n"),
          kakvoca,
        }),
      });
      const podatci = await odgovor.json();
      if (!odgovor.ok) {
        setGreska(podatci.greska || { poruka: "Preuzimač je odbio taj zahtjev." });
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
      setGreska({ poruka: "Ne mogu doći do preuzimača. Radi li još `npm run dev`?" });
    } finally {
      setSalje(false);
    }
  }, [procitano, kakvoca]);

  /** @param {string} id */
  const odustani = (id) => {
    fetch("/preuzmi/odustani?id=" + encodeURIComponent(id), { method: "POST" }).catch(() => {});
  };

  const ocisti = () => {
    for (const p of poslovi) {
      if (GOTOVI.includes(p.stanje)) {
        fetch("/preuzmi/zaboravi?id=" + encodeURIComponent(p.id), { method: "POST" }).catch(() => {});
      }
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
        aria-label="Dodaj pjesmu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gdglava">
          <h2>Dodaj pjesmu</h2>
          <button type="button" className="gikona" aria-label="Zatvori" onClick={naZatvori}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="uz">
          Zalijepi poveznicu s YouTubea, jednu ili cijeli popis. Zvuk se preuzme, pretvori u
          mp3 i odmah uđe u zbirku, pa je nađeš pod <b>Sve pjesme</b>.
        </p>

        <label className="gdoznaka" htmlFor="gdveze">
          Poveznice
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

        <p className="gdmjera">{mjera(procitano)}</p>

        {procitano.greske.length ? (
          <ul className="gdodbijene">
            {procitano.greske.slice(0, 5).map((/** @type {any} */ g, i) => (
              <li key={i}>
                <code>{skrati(g.upisano, 44)}</code> {g.razlog}
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
              title={k.opis}
              onClick={() => setKakvoca(k.id)}
            >
              {k.ime}
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
              ? "Preuzimač se ne javlja. On radi samo uz `npm run dev`."
              : "Nedostaje " +
                [
                  stanje.alati && !stanje.alati.ytDlp.ima ? "yt-dlp" : null,
                  stanje.alati && !stanje.alati.ffmpeg.ima ? "ffmpeg" : null,
                ]
                  .filter(Boolean)
                  .join(" i ") +
                ". Bez toga se ne može preuzimati."}
          </p>
        ) : null}

        <div className="gdno">
          <button type="button" className="blijedo" onClick={naZatvori}>
            Zatvori
          </button>
          <button
            type="button"
            className="glavna"
            disabled={salje || !procitano.prihvacene.length || !(stanje && stanje.ima)}
            onClick={posalji}
          >
            {salje ? "Šaljem…" : "Preuzmi"}
          </button>
        </div>

        {poslovi.length ? (
          <div className="gdposlovi">
            <div className="gdvrhpopisa">
              <h3>
                {uTijeku ? uTijeku + " u tijeku" : "Ništa se ne preuzima"}
                {gotovih ? " · " + gotovih + " gotovo" : ""}
              </h3>
              {gotovih ? (
                <button type="button" className="gdveza" onClick={ocisti}>
                  Očisti gotove
                </button>
              ) : null}
            </div>
            <ul>
              {poslovi.map((p) => (
                <li key={p.id} className="gdposao">
                  <div className="gdredaknaslov">
                    <span className="gdime">{p.naslov || "Čitam podatke…"}</span>
                    <span className="gdstanje" data-stanje={p.stanje}>
                      {OPIS[p.stanje] || p.stanje}
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
                        Odustani
                      </button>
                    )}
                    {p.pjesma && naPusti ? (
                      <button
                        type="button"
                        className="gdveza gdpusti"
                        onClick={() => naPusti(p.pjesma.id)}
                      >
                        <Play size={12} aria-hidden="true" /> Pusti
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
            ? "yt-dlp " + stanje.alati.ytDlp.inacica + " · ffmpeg " + stanje.alati.ffmpeg.inacica
            : ""}
          {/* Tipka stoji i kad yt-dlpa uopće nema: tada je ona jedini način da
              stigne, a ne samo način da se osvježi. Nema je jedino ondje gdje
              iza Lucifyja ne stoji poslužitelj, jer ondje nema ni kamo. */}
          {stanje && !stanje.nedostupan ? (
            <button type="button" className="gdosvjezi" onClick={naOsvjezi} disabled={osvjezava}>
              {osvjezava ? "dohvaćam…" : stanje.alati && stanje.alati.ytDlp.ima ? "osvježi yt-dlp" : "dohvati yt-dlp"}
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** Stanja iza kojih se više ništa ne događa. */
const GOTOVI = ["gotovo", "vec", "greska", "prekinuto"];

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
function mjera(procitano) {
  const dijelovi = [];
  const n = procitano.prihvacene.length;
  if (n) dijelovi.push(n + " " + (n === 1 ? "poveznica" : n < 5 ? "poveznice" : "poveznica") + " spremno");
  if (procitano.ponovljene) dijelovi.push(procitano.ponovljene + " ponovljeno, broji se jednom");
  if (procitano.greske.length) dijelovi.push(procitano.greske.length + " neupotrebljivo");
  return dijelovi.join(" · ") || "Zalijepi jednu poveznicu ili cijeli popis.";
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
