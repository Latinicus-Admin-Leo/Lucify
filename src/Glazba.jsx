import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronDown,
  Clock,
  Disc3,
  Download,
  FolderInput,
  Heart,
  Globe,
  Library,
  ListPlus,
  Link2,
  ListMusic,
  MoreHorizontal,
  PanelRight,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as svirac from "./glazba-svirac.mjs";
import { KORIJEN, mmss, odbroj } from "./glazba-svirac.mjs";
import { NA_UREDAJU, omotAdresa, ukloniPjesmu, zbirkaUredaja } from "./glazba-izvor.mjs";
import { odrediJezike } from "./glazba-mape.mjs";
import { adresaSnimke } from "./glazba-veze.mjs";
import Znak from "./Znak.jsx";
import { jezikStanje, pjesama, prevoditelj } from "./jezik.mjs";
import "./glazba.css";

/**
 * Okvir za dodavanje pjesme dolazi tek kad zatreba, i samo ondje gdje iza
 * njega stoji preuzimač iz `scripts/preuzimac.mjs`: na razvojnom poslužitelju i
 * u namjenskoj aplikaciji, koja yt-dlp i ffmpeg nosi uza se. Na objavljenoj
 * stranici toga nema, ni programa ni mape u koju bi se snimka spremila, pa
 * ondje nema ni tipke.
 */
/* Namjenska aplikacija ima zbirku u mapi koju čovjek bira, a ne uz projekt,
   pa joj savjeti o `npm` naredbama ne znače ništa. */
const NAMJENSKA = import.meta.env.MODE === "namjenska";

/* Razred stoji na korijenu, a ne na samom Lucifyju, i upisuje se odmah, a ne
   iz prikaza: traka mora biti povlačna i dok se zbirka tek otvara, jer se
   inače prozor dotad ne bi dao pomaknuti. */
if (NAMJENSKA && typeof document !== "undefined") {
  document.documentElement.classList.add("uprozoru");
}
/* Ista provjera kao `NA_UREDAJU`, samo okrenuta, i zato izvedena odande a ne
   napisana drugi put: gdje god ima poslužitelja koji zna preuzeti pjesmu, ima i
   poslužitelja koji je zna poslužiti. */
const PREUZIMAC = !NA_UREDAJU;

/* Namjenska aplikacija za Windows. Sam program ne može stajati uz objavljenu
   stranicu: instalacija je stotinjak megabajta, a Vercel na besplatnom računu
   prima najviše sto, pa `izdanje/` nije ni u gitu. Izdanja zato stoje na
   GitHubu, gdje te granice nema, a odavde vodi samo poveznica. Gradi se s
   `npm run pakiraj`, a objavljuje kao GitHub Release. */
const IZDANJA = "https://github.com/Latinicus-Admin-Leo/Lucify/releases/latest";

/* Uvoz stoji iza te provjere, a ne samo prikaz, jer Vite i `import.meta.env.DEV`
   i `import.meta.env.MODE` u buildu zamijeni doslovnim vrijednostima, pa u
   objavljenom buildu cijela grana i s njom sam `import()` ispadnu van. Tako se
   u `dist/` ne pojavi ni datoteka koja se ondje nikad ne bi otvorila. `any` je
   zato što TypeScript inače prigovara na komponentu koja može biti `null`, a u
   toj se grani nikad ne prikazuje. */
const Dodaj = /** @type {any} */ (
  PREUZIMAC ? lazy(() => import("./GlazbaDodaj.jsx")) : null
);

/* Okvir s poveznicama stoji svugdje, i na objavljenom Lucifyju. Nastao je kad
   ondje zbirke još nije bilo, kao jedini način da popis stigne na mobitel;
   otkad je zbirka ondje, on je i dalje jedini način da se iz nje izađe van, na
   sam YouTube. */
const Poveznice = lazy(() => import("./GlazbaPoveznice.jsx"));

/* Uvoz zbirke s uređaja, obrnuto od preuzimača: stoji **samo** ondje gdje
   poslužitelja nema, jer se ondje zbirka ne dohvaća nego nosi. Uz `npm run dev`
   i u namjenskoj aplikaciji uvoziti nema što, pa i ovaj `import()` ispada iz
   izlaza. */
const Uvoz = /** @type {any} */ (
  NA_UREDAJU ? lazy(() => import("./GlazbaUvoz.jsx")) : null
);

/**
 * Lucify: zbirka snimaka i svirač, u izgledu posuđenom od glazbenih
 * programa. Prije je bila alat unutar školske mape Lucijankice i ondje je imala
 * tipku „Natrag na bilješke”; ovdje je sama sebi stranica, pa te tipke nema.
 *
 * Zbirka dolazi s dvaju mjesta, a odluka o tome stoji u `glazba-izvor.mjs`.
 * Ondje gdje iza Lucifyja stoji poslužitelj, dolazi s adrese `/glazba/`, iz
 * mape `Glazba/Zvuk/`; ondje gdje ga nema, dakle na mobitelu, iz IndexedDB, u
 * koji ju je ostavio uvoz.
 *
 * Ta mapa nije u gitu, jer su snimke tuđe autorsko djelo. Zato se popis
 * **dohvaća**, a ne uvozi: da ga se uvozilo, build bi pao ondje gdje zbirke
 * nema, umjesto da Lucify jednostavno kaže da je prazna.
 */

/* Ključevi nose staro ime namjerno, kao i u Lucijankici: preimenovati ih
   značilo bi izgubiti srca i vlastite popise onima koji ih ondje već imaju. */
const KLJUC_SRCA = "lucijanka.glazba.srca";
const KLJUC_LISTE = "lucijanka.glazba.liste";
/* Mape iz kojih je popis već jednom složen. Bez ovoga bi se obrisan popis
   vratio sam od sebe pri sljedećem otvaranju, a i uređen bi se vratio na
   početno stanje. */
const KLJUC_MAPE = "lucijanka.glazba.mape";
/* Pjesme koje je čovjek premjestio iz jedne glavne mape u drugu. Pamte se po
   uređaju, kao i srca, a pobjeđuju ono što piše u popisu. */
const KLJUC_JEZICI = "lucijanka.glazba.jezici";

/* Dvije glavne mape zbirke. Treća, „Sve pjesme”, ne stoji u zbirci nego samo
   iza gornje tražilice, jer se traži po svemu. */
const HRVATSKE = "hrvatske";
const OSTALE = "ostale";

/** @param {string} k @param {any} zadano */
function ucitaj(k, zadano) {
  try {
    const s = localStorage.getItem(k);
    return s ? JSON.parse(s) : zadano;
  } catch {
    return zadano;
  }
}

/** @param {string} k @param {any} v */
function spremi(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* privatni prozor */
  }
}

/** Ukupno trajanje, riječima. @param {number} s */
function koliko(s) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return (h ? h + " h " : "") + m + " min";
}

/** @param {number} n @param {string} jedan @param {string} dva @param {string} pet */
function padez(n, jedan, dva, pet) {
  const z = n % 100;
  if (z > 10 && z < 20) return pet;
  const j = n % 10;
  if (j === 1) return jedan;
  if (j >= 2 && j <= 4) return dva;
  return pet;
}

/** Ponuđena trajanja mjerača vremena, u minutama. */
const MJERILA = [5, 15, 30, 45, 60, 90];

/** Trajanje mjerača riječima: „30 minuta”, „1 sat i 30 minuta”. @param {number} m */
function trajanjeRijecju(m, jezik) {
  const h = Math.floor(m / 60);
  const o = m % 60;
  const sati = h ? h + " " + (jezik === "en" ? (h === 1 ? "hour" : "hours") : padez(h, "sat", "sata", "sati")) : "";
  const minute = o ? o + " " + (jezik === "en" ? (o === 1 ? "minute" : "minutes") : padez(o, "minuta", "minute", "minuta")) : "";
  if (sati && minute) return sati + (jezik === "en" ? " and " : " i ") + minute;
  return sati || minute;
}

/** Miče kvačice, da upisano „zlocin” pronađe „zločin”. @param {string} s */
function fold(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/** Ton boje iz imena, da svaka polica ima svoju, a uvijek istu. @param {string} s */
function ton(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/**
 * Inline stil s vlastitim CSS varijablama. TypeScript u `style` prima samo
 * poznata svojstva, a `--ton` i `--posto` to nisu, pa se prolazi kroz `any`.
 *
 * @param {Record<string, string | number>} v
 * @returns {import("react").CSSProperties}
 */
function stil(v) {
  return /** @type {any} */ (v);
}

/** @param {{ slika?: string, ime: string, mozaik?: string[], klasa?: string }} props */
function Omot({ slika, ime, mozaik, klasa }) {
  const boje = stil({ "--ton": ton(ime), "--ton2": (ton(ime) + 40) % 360 });
  if (slika) {
    return (
      <div className={"gomot " + (klasa || "")} style={boje}>
        <img src={omotAdresa(slika)} alt="" loading="lazy" />
      </div>
    );
  }
  if (mozaik && mozaik.length >= 4) {
    return (
      <div className={"gomot mozaik " + (klasa || "")} style={boje}>
        {mozaik.slice(0, 4).map((s, i) => (
          <img key={i} src={omotAdresa(s)} alt="" loading="lazy" />
        ))}
      </div>
    );
  }
  /* Za mozaik trebaju četiri omota. Popis s jednom ili dvjema pjesmama uzima
     prvi omot koji ima, jer je i to bolje od početnoga slova. */
  if (mozaik && mozaik.length) {
    return (
      <div className={"gomot " + (klasa || "")} style={boje}>
        <img src={omotAdresa(mozaik[0])} alt="" loading="lazy" />
      </div>
    );
  }
  return (
    <div className={"gomot slova " + (klasa || "")} style={boje}>
      {ime.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

/**
 * Klizač za vrijeme i za glasnoću. Postotak ispune ide kroz CSS varijablu, jer
 * se traka lijevo od ručice ne da obojiti samim CSS-om.
 *
 * @param {{ vrijednost: number, najvise: number, naPromjenu: (v: number) => void,
 *           oznaka: string, razred?: string, korak?: number }} props
 */
function Klizac({ vrijednost, najvise, naPromjenu, oznaka, razred, korak }) {
  const posto = najvise > 0 ? (vrijednost / najvise) * 100 : 0;
  return (
    <input
      type="range"
      className={"gklizac " + (razred || "")}
      min={0}
      max={najvise || 1}
      step={korak || 1}
      value={vrijednost}
      aria-label={oznaka}
      style={stil({ "--posto": posto + "%" })}
      onChange={(e) => naPromjenu(Number(e.target.value))}
      /* Pušten klizač ne zadržava fokus. Da ga zadrži, strelice i razmaknica
         poslije bi pomicale njega, a ne pjesmu, a preglednik bi mu na prvu
         tipku nacrtao obrub. */
      onPointerUp={(e) => e.currentTarget.blur()}
    />
  );
}

/* Tri sitna dijela koja otkucavaju. Svaki gleda puno stanje svirača za sebe, a
   Lucify samo `svirac.glavno()`, pa četiri otkucaja u sekundi crtaju dva broja
   i jednu traku, a ne cijeli popis. */

/** Vrijeme u pjesmi i traka po kojoj se premotava. @param {{ t: (s: string) => string }} props */
function Vrijeme({ t }) {
  const { vrijeme, trajanje } = useSyncExternalStore(svirac.prati, svirac.stanje, svirac.stanje);
  return (
    <div className="gcrta">
      <span>{mmss(vrijeme)}</span>
      <Klizac
        vrijednost={Math.min(vrijeme, trajanje)}
        najvise={trajanje}
        oznaka={t("Mjesto u pjesmi")}
        naPromjenu={(v) => svirac.premotaj(v)}
      />
      <span>{mmss(trajanje)}</span>
    </div>
  );
}

/** Utišavanje i glasnoća. @param {{ t: (s: string) => string }} props */
function Glasnoca({ t }) {
  const { glasnoca, tiho } = useSyncExternalStore(svirac.prati, svirac.stanje, svirac.stanje);
  return (
    <div className="gdesno">
      <button
        type="button"
        className="gikona"
        aria-label={tiho ? t("Uključi zvuk") : t("Utišaj")}
        onClick={() => svirac.prigusi()}
      >
        {tiho || glasnoca === 0 ? (
          <VolumeX size={18} aria-hidden="true" />
        ) : glasnoca < 0.5 ? (
          <Volume1 size={18} aria-hidden="true" />
        ) : (
          <Volume2 size={18} aria-hidden="true" />
        )}
      </button>
      <Klizac
        razred="gglasnoca"
        vrijednost={tiho ? 0 : glasnoca * 100}
        najvise={100}
        oznaka={t("Glasnoća")}
        naPromjenu={(v) => svirac.postaviGlasnocu(v / 100)}
      />
    </div>
  );
}

/** Koliko mjerač još daje, uz sat na alatkama. @param {{ t: (s: string) => string }} props */
function MjeracOdbroj({ t }) {
  const { mjerac } = useSyncExternalStore(svirac.prati, svirac.stanje, svirac.stanje);
  if (!mjerac) return null;
  return <span>{mjerac.kraj ? t("do kraja pjesme") : odbroj(mjerac.ostalo)}</span>;
}

/* Četiri stupca koja poskakuju dok nešto svira: u retku pjesme i uz popis u
   zbirci s kojega svira. */
function Stupci() {
  return (
    <span className="gsviraju" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Jedan redak popisa.
 *
 * Zaseban je i pamćen (`memo`) jer ih u zbirci ima pet stotina, a gotovo svaka
 * promjena u Lucifyju — otvoren izbornik, srce na jednoj pjesmi, sljedeća
 * pjesma — tiče se jednoga ili dvaju. Bez toga bi se svaki put crtali svi.
 * Zato su i sve funkcije koje prima stalne, a o retku samom govore mu brojevi i
 * zastavice, a ne cijelo stanje.
 *
 * @param {{ p: any, i: number, jeSada: boolean, tece: boolean, srcem: boolean,
 *           otvoren: boolean, mreza: boolean, t: (s: string) => string,
 *           naPusti: (i: number, jeSada: boolean) => void, naSrce: (id: string) => void,
 *           naJelovnik: (e: any, id: string) => void }} props
 */
function RedakPjesme({ p, i, jeSada, tece, srcem, otvoren, mreza, t, naPusti, naSrce, naJelovnik }) {
  return (
    <div
      data-pjesma={p.id}
      className={"gredak pjesma" + (jeSada ? " sada" : "") + (tece ? " gtece" : "")}
      onDoubleClick={() => naPusti(i, false)}
      /* Na dodir dvostrukoga klika nema, pa redak ondje pušta jednim dodirom,
         kako to na telefonu i inače ide. Pitamo `hover: none`, a ne širinu
         zaslona: dodir je ono što ovdje doista odlučuje. Dodir na tipku ili
         poveznicu u retku ostaje njihov, da srce i izbornik rade svoje. */
      onClick={(e) => {
        if (!window.matchMedia("(hover: none)").matches) return;
        if (/** @type {HTMLElement} */ (e.target).closest("button, a")) return;
        naPusti(i, false);
      }}
    >
      <button
        type="button"
        className="gbroj"
        aria-label={t("Pusti ") + p.naslov}
        onClick={() => naPusti(i, jeSada)}
      >
        <span className="gbrojka">{i + 1}</span>
        {tece ? <Stupci /> : null}
        <span className="gznak" aria-hidden="true">
          {tece ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
        </span>
      </button>

      <span className="naslov">
        <Omot ime={p.naslov} slika={p.omot} />
        <span>
          <b>{p.naslov}</b>
          <span>{p.izvodac}</span>
        </span>
      </span>

      <span className="stupac">
        {p.razdoblje ? (
          p.razdoblje
        ) : p.yt && mreza ? (
          <a
            className="gizvor"
            href={"https://www.youtube.com/watch?v=" + p.yt}
            target="_blank"
            rel="noreferrer noopener"
          >
            YouTube
          </a>
        ) : p.yt ? (
          /* Bez mreže ostaje natpis, ali ne i poveznica: pjesma i dalje svira,
             a klik bi vodio u prazan zaslon. */
          <span className="gizvor nema">YouTube</span>
        ) : p.mapa ? (
          /* Pjesma iz mape s računala, kojoj snimka na YouTubeu nije nađena.
             Prije je ovdje pisalo samo „Datoteka”, pa se nije znalo zašto. */
          t("Iz mape") + " " + p.mapa
        ) : (
          t("Datoteka")
        )}
      </span>

      <span className="dodano">{p.dodano}</span>

      <span className="kraj">
        <button
          type="button"
          className={"gsrce" + (srcem ? " puno" : "")}
          aria-label={srcem ? t("Makni iz srca") : t("Označi srcem")}
          aria-pressed={srcem}
          onClick={() => naSrce(p.id)}
        >
          <Heart size={15} fill={srcem ? "currentColor" : "none"} />
        </button>
        {mmss(p.trajanje)}
        <button
          type="button"
          className="gvise"
          aria-label={t("Više o pjesmi")}
          aria-expanded={otvoren ? "true" : "false"}
          onClick={(e) => naJelovnik(e, p.id)}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
const Redak = memo(RedakPjesme);

export default function Glazba() {
  /* Jezik stoji izvan Reacta, kao i svirač: traže ga i ostali okviri, a mijenja
     se rijetko. Odavde se samo gleda i prebacuje. */
  const jezik = useSyncExternalStore(jezikStanje.prati, jezikStanje.stanje, jezikStanje.stanje);
  const t = useMemo(() => prevoditelj(jezik), [jezik]);

  const [zbirka, setZbirka] = useState(/** @type {any} */ (null));
  const [ucitavam, setUcitavam] = useState(true);

  const [srca, setSrca] = useState(/** @type {() => string[]} */ (() => ucitaj(KLJUC_SRCA, [])));
  const [liste, setListe] = useState(
    /** @type {() => { id: string, naslov: string, pjesme: string[] }[]} */
    (() => ucitaj(KLJUC_LISTE, [])),
  );

  const [sijaneMape, setSijaneMape] = useState(
    /** @type {() => string[]} */ (() => ucitaj(KLJUC_MAPE, [])),
  );
  const [jezici, setJezici] = useState(
    /** @type {() => Record<string, string>} */ (() => ucitaj(KLJUC_JEZICI, {})),
  );

  const [otvoreno, setOtvoreno] = useState({ vrsta: "mapa", id: HRVATSKE });
  /* Polica koja je bila otvorena prije gornje tražilice. Traži se po cijeloj
     zbirci, a kad se tražilica isprazni, vraća se ondje gdje se bilo. */
  const prijeTrazenja = useRef(/** @type {{ vrsta: string, id: string } | null} */ (null));
  const glavnoRef = useRef(/** @type {HTMLElement | null} */ (null));
  /* Kad je čovjek zadnji put sam pomicao popis. Dok ga pomiče, sljedeća pjesma
     ne smije ga odvući natrag na sebe. */
  const rucnoPomaknuto = useRef(0);
  const [zaUkloniti, setZaUkloniti] = useState(/** @type {any} */ (null));
  const [uklanjam, setUklanjam] = useState(false);
  const [greskaUklanjanja, setGreskaUklanjanja] = useState("");
  /* Ima li mreže. Zbirka je na uređaju i svira bez nje, ali poveznica na
     YouTube bez mreže vodi u prazan zaslon preglednika, pa je onda nema.
     Sluša se i poslije, a ne samo pri otvaranju: mreža ode i vrati se, a
     Lucify ostaje otvoren. */
  const [mreza, setMreza] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  const [trazi, setTrazi] = useState("");
  const [traziZbirku, setTraziZbirku] = useState("");
  /* Zbirka se otvara na popisima, jer se odande i kreće u slušanje.
     Police po izvođačima nastaju same i ima ih desetak, pa bi na „Sve”
     vlastiti popisi bili zatrpani među njima. */
  const [filtar, setFiltar] = useState("liste");
  const [poredak, setPoredak] = useState("dodano");
  /* Smjer poretka. „Nedavno dodano” znači najnovije na vrhu, pa je početno silazno. */
  const [silazno, setSilazno] = useState(true);

  /* Sviranje ne stoji ovdje nego u `glazba-svirac.mjs`, izvan Reacta i izvan
     Lucifyja, jer glazba mora svirati i kad se Lucify zatvori, a React
     bi pri zatvaranju odnio i zvuk i red čekanja. Odavde se ono samo gleda i
     prebacuje, kao i mjerač vremena, koji inače ne bi imao tko otkucavati. */
  const { red, sada, svira, mijesaj, ponovi, imaMjerac, mjeracKraj, izvor } =
    useSyncExternalStore(svirac.prati, svirac.glavno, svirac.glavno);
  /* Ovdje stoji i mjesto na kojem se izbornik otvara, jer je `fixed`. `gore`
     znači da visi s gornje strane gumba, pa mu se mjesto zadaje odozdo. */
  const [mjeracOtvoren, setMjeracOtvoren] = useState(
    /** @type {{ x: number, y: number, visina: number, gore: boolean } | null} */ (null),
  );
  const [vlastito, setVlastito] = useState("20");

  /* Ploča „Sad svira” stoji otvorena samo ondje gdje za nju ima vlastiti
     stupac. Na užem zaslonu ona prekriva popis, pa se otvara tek na zahtjev. */
  const [panel, setPanel] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1280,
  );
  const [zbirkaOtvorena, setZbirkaOtvorena] = useState(false);
  const [dodajOtvoren, setDodajOtvoren] = useState(false);
  const [vezeOtvorene, setVezeOtvorene] = useState(false);
  const [uvozOtvoren, setUvozOtvoren] = useState(false);
  /* Na mobitelu je svirač skupljen u karticu nad donjom trakom, a dodirom se
     otvara preko cijeloga zaslona. Na stolnom računalu te razlike nema: ondje
     svirač uvijek stoji u traci pri dnu, pa se ovo stanje ne koristi. */
  const [puniSvirac, setPuniSvirac] = useState(false);
  const [jelovnik, setJelovnik] = useState(/** @type {any} */ (null));
  /* Kad se otvara novi popis, ovdje stoji ono što u njega odmah ide. */
  const [noviPopisZa, setNoviPopisZa] = useState(/** @type {string[] | null} */ (null));
  const [novoIme, setNovoIme] = useState("");

  /* Popis se dohvaća pri otvaranju, ali i nakon svakoga preuzimanja, pa stoji
     u zasebnoj funkciji. Tako nova pjesma uđe u „Sve pjesme” odmah, bez
     osvježavanja stranice. */
  const ucitajPopis = useCallback(
    () =>
      /* Dva izvora, ista dalja obrada. Gdje ima poslužitelja, popis je datoteka
         koja se dohvaća; gdje ga nema, popis je ono što je uvoz ostavio na
         uređaju, a uz njega se otvore i omoti, prije prvoga prikaza, da prvi
         prikaz ima što nacrtati. */
      (NA_UREDAJU
        ? zbirkaUredaja()
        : fetch(KORIJEN + "glazba/popis.json", { cache: "no-cache" }).then((o) =>
            o.ok ? o.json() : Promise.reject(new Error(String(o.status))),
          )
      )
        .then((p) => {
          /* Popis složen prije nego što su postojale dvije glavne mape nema
             `jezik`, pa se pogodi ovdje, istim pravilom kao na poslužitelju. */
          if (p && Array.isArray(p.pjesme)) odrediJezike(p.pjesme);
          setZbirka(p);
          /* Svirač dobiva isti popis, jer bez njega ne zna ni gdje je koja
             datoteka ni koja je sljedeća. Odatle se vraća i zadnja pjesma iz
             prošloga posjeta, jer se tek s popisom zna koja je. */
          svirac.postaviZbirku((p && p.pjesme) || []);
          setUcitavam(false);
        })
        .catch(() => setUcitavam(false)),
    [],
  );

  useEffect(() => {
    ucitajPopis();
  }, [ucitajPopis]);

  useEffect(() => spremi(KLJUC_SRCA, srca), [srca]);
  useEffect(() => spremi(KLJUC_LISTE, liste), [liste]);
  useEffect(() => spremi(KLJUC_MAPE, sijaneMape), [sijaneMape]);
  useEffect(() => spremi(KLJUC_JEZICI, jezici), [jezici]);

  /* Zeleni obrub fokusa pokazuje se samo onomu tko se kreće tipkom Tab. Prije
     se palio i mišem: klik na gumb ili klizač, pa razmaknica ili strelica, i
     preglednik bi zaključio da se radi tipkovnicom, pa oko gumba nacrtao
     obrub koji nitko nije tražio. */
  useEffect(() => {
    const korijen = document.documentElement;
    /** @param {KeyboardEvent} e */
    const naTipku = (e) => {
      if (e.key === "Tab") korijen.classList.add("gtipkovnica");
    };
    const naMis = () => korijen.classList.remove("gtipkovnica");
    document.addEventListener("keydown", naTipku, true);
    document.addEventListener("pointerdown", naMis, true);
    return () => {
      document.removeEventListener("keydown", naTipku, true);
      document.removeEventListener("pointerdown", naMis, true);
    };
  }, []);

  /**
   * Pjesma unesena iz mape nosi ime te mape, a od njega ovdje nastaje popis —
   * **jednom**, i dalje je čovjekov. Zato se sijanje pamti po imenu mape: tko
   * popis obriše ili prekroji, ne dobiva ga natrag pri sljedećem otvaranju.
   * Nove pjesme u istoj mapi zato ne ulaze same; ide ih se dodati rukom, kao i
   * u svaki drugi popis.
   */
  useEffect(() => {
    const pjesme = (zbirka && zbirka.pjesme) || [];
    if (!pjesme.length) return;
    /** @type {Map<string, string[]>} */
    const poMapi = new Map();
    for (const p of pjesme) {
      if (!p.mapa) continue;
      if (!poMapi.has(p.mapa)) poMapi.set(p.mapa, []);
      (poMapi.get(p.mapa) || []).push(p.id);
    }
    const nove = [...poMapi.entries()].filter(([ime]) => !sijaneMape.includes(ime));
    if (!nove.length) return;
    setListe((l) => [
      ...l,
      ...nove
        .filter(([ime]) => !l.some((x) => x.naslov === ime))
        .map(([ime, ids]) => ({ id: "lista-mapa-" + ime.toLowerCase(), naslov: ime, pjesme: ids })),
    ]);
    setSijaneMape((s) => [...s, ...nove.map(([ime]) => ime)]);
  }, [zbirka, sijaneMape]);
  /* Glasnoća, nasumično i ponavljanje pamte se u samom sviraču, jer se ondje i
     mijenjaju. */

  /* Dok je Lucify otvoren, stranica ispod njega ne smije se pomicati. */
  useEffect(() => {
    const osvjezi = () => setMreza(navigator.onLine !== false);
    window.addEventListener("online", osvjezi);
    window.addEventListener("offline", osvjezi);
    return () => {
      window.removeEventListener("online", osvjezi);
      window.removeEventListener("offline", osvjezi);
    };
  }, []);

  useEffect(() => {
    const prije = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prije;
    };
  }, []);

  /** @type {Map<string, any>} */
  const poId = useMemo(() => {
    const m = new Map();
    for (const p of (zbirka && zbirka.pjesme) || []) m.set(p.id, p);
    return m;
  }, [zbirka]);

  const sve = useMemo(() => (zbirka && zbirka.pjesme) || [], [zbirka]);
  /* Srca kao skup, jer ih pita svaki od pet stotina redaka. */
  const srcaSkup = useMemo(() => new Set(srca), [srca]);

  /* ---------- zbirka u lijevom stupcu ---------- */

  /** Kojoj glavnoj mapi pjesma pripada: što je čovjek premjestio, pa što piše u popisu. */
  const glavnaMapa = useCallback(
    (/** @type {any} */ p) => ((jezici[p.id] || p.jezik) === "hr" ? HRVATSKE : OSTALE),
    [jezici],
  );

  const police = useMemo(() => {
    /** @type {{ id: string, naslov: string, vrsta: string, pjesme: string[] }[]} */
    const out = [
      { id: "srca", naslov: t("Označeno srcem"), vrsta: "srca", pjesme: srca },
      {
        id: HRVATSKE,
        naslov: t("Hrvatske pjesme"),
        vrsta: "mapa",
        pjesme: sve.filter((p) => glavnaMapa(p) === HRVATSKE).map((p) => p.id),
      },
      {
        id: OSTALE,
        naslov: t("Sve ostale pjesme"),
        vrsta: "mapa",
        pjesme: sve.filter((p) => glavnaMapa(p) === OSTALE).map((p) => p.id),
      },
      { id: "sve", naslov: t("Sve pjesme"), vrsta: "sve", pjesme: sve.map((p) => p.id) },
    ];
    for (const l of liste) out.push({ ...l, vrsta: "lista" });
    for (const p of (zbirka && zbirka.police) || []) out.push({ ...p, vrsta: "izvodac" });
    return out;
  }, [srca, sve, liste, zbirka, t, glavnaMapa]);

  const viđene = useMemo(() => {
    const n = fold(traziZbirku.trim());
    return police.filter((p) => {
      /* „Sve pjesme” su samo ono što gornja tražilica pretražuje. U zbirci
         stoje dvije glavne mape, a ne i treća koja je obje zajedno. */
      if (p.vrsta === "sve") return false;
      if (filtar === "liste" && p.vrsta === "izvodac") return false;
      if (filtar === "izvodaci" && p.vrsta !== "izvodac") return false;
      return !n || fold(p.naslov).includes(n);
    });
  }, [police, traziZbirku, filtar]);

  /* Omoti za sličice u zbirci. Računaju se jednom po promjeni zbirke, a ne pri
     svakom prikazu: „Sve ostale pjesme” imaju tristo pjesama. */
  const omotiPolica = useMemo(() => {
    /** @type {Map<string, string[]>} */
    const m = new Map();
    for (const p of police) {
      /** @type {string[]} */
      const prve = [];
      for (const id of p.pjesme) {
        const x = poId.get(id);
        if (x && x.omot) prve.push(x.omot);
        if (prve.length >= 4) break;
      }
      m.set(p.id, prve);
    }
    return m;
  }, [police, poId]);

  const polica = useMemo(() => {
    const nadena = police.find((p) => p.id === otvoreno.id);
    if (nadena) return nadena;
    /* Nema li više te police, otvara se glavna mapa u kojoj ičega ima. */
    return police.find((p) => p.vrsta === "mapa" && p.pjesme.length) || police[1];
  }, [police, otvoreno]);

  /* Koji popis u zbirci svira: onaj s kojega je red pušten, a ako je pušten
     izvan zbirke (tražilicom, iz „Još od izvođača”), glavna mapa pjesme. */
  const policaKojaSvira = useMemo(() => {
    if (!sada) return "";
    if (izvor && izvor !== "sve" && police.some((p) => p.id === izvor)) return izvor;
    return glavnaMapa(sada);
  }, [sada, izvor, police, glavnaMapa]);

  /** Pjesme otvorene police, poredane i pretražene. */
  const prikazane = useMemo(() => {
    if (!polica) return [];
    let lista = polica.pjesme.map((id) => poId.get(id)).filter(Boolean);
    const n = fold(trazi.trim());
    if (n) lista = lista.filter((p) => fold(p.naslov + " " + p.izvodac).includes(n));
    const kopija = [...lista];
    /* Smjer množi samo glavnu usporedbu, a naslov ostaje razrješivač i uvijek
       ide od A do Ž. Da se cijeli popis na kraju okretao, iste bi se datume
       poredalo unatrag, pa bi se pri svakom okretu ispremiješale i one pjesme
       koje se poretkom uopće ne razlikuju. */
    const smjer = silazno ? -1 : 1;
    const poNaslovu = (a, b) => a.naslov.localeCompare(b.naslov, "hr");
    if (poredak === "naslov") kopija.sort((a, b) => smjer * poNaslovu(a, b));
    else if (poredak === "trajanje")
      kopija.sort((a, b) => smjer * (a.trajanje - b.trajanje) || poNaslovu(a, b));
    else
      kopija.sort(
        (a, b) => smjer * String(a.dodano).localeCompare(String(b.dodano)) || poNaslovu(a, b),
      );
    return kopija;
  }, [polica, poId, trazi, poredak, silazno]);

  const trajanjePolice = useMemo(
    () => prikazane.reduce((s, p) => s + (p.trajanje || 0), 0),
    [prikazane],
  );

  const mozaik = useMemo(
    () =>
      prikazane
        .map((p) => p.omot)
        .filter(Boolean)
        .slice(0, 4),
    [prikazane],
  );

  /* ---------- sviranje ---------- */

  /* Puštanje i pomicanje po redu rade se ravno u sviraču. Ovdje ostaje samo
     ono što svirač ne može znati: koji je popis otvoren, pa se odatle uzima
     prva pjesma kad se pritisne „pusti”, a još ništa ne svira. */
  const { pusti, pomakni } = svirac;

  const prekidac = useCallback(() => {
    if (!sada) {
      if (prikazane.length) pusti(prikazane.map((p) => p.id), 0, polica.id);
      return;
    }
    svirac.prekidac();
  }, [sada, prikazane, pusti, polica.id]);

  /* Za retke: pusti i-tu pjesmu otvorene police, ili zaustavi ako je baš ona. */
  const pustiRedak = useCallback(
    (/** @type {number} */ i, /** @type {boolean} */ jeSada) => {
      if (jeSada) svirac.prekidac();
      else pusti(prikazane.map((x) => x.id), i, polica.id);
    },
    [prikazane, pusti, polica.id],
  );

  const otvoriJelovnik = useCallback((/** @type {any} */ e, /** @type {string} */ id) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    /* Izbornik ima i dno, pa se uz donji rub prozora otvara prema gore. */
    const gore = window.innerHeight - r.bottom < 330;
    setJelovnik((j) =>
      j && j.id === id
        ? null
        : {
            id,
            x: Math.min(r.left, window.innerWidth - 240),
            y: gore ? window.innerHeight - r.top + 6 : r.bottom + 6,
            gore,
          },
    );
  }, []);

  /* ---------- pjesma koja svira ostaje na vidiku ---------- */

  /**
   * Redak pjesme koja svira, ako je u otvorenom popisu.
   * @param {"odmah" | "glatko"} kako @param {boolean} samoAkoNijeVidljiv
   */
  const pokaziSviranu = useCallback(
    (kako, samoAkoNijeVidljiv) => {
      const okvir = glavnoRef.current;
      if (!okvir || !sada) return;
      const redak = /** @type {HTMLElement | null} */ (
        okvir.querySelector('[data-pjesma="' + CSS.escape(sada.id) + '"]')
      );
      if (!redak) return;
      if (samoAkoNijeVidljiv) {
        const o = okvir.getBoundingClientRect();
        const r = redak.getBoundingClientRect();
        /* Gore stoji zaglavlje stupaca, a dolje na mobitelu svirač. */
        const dno = Math.min(o.bottom, window.innerHeight) - 8;
        if (r.top >= o.top + 44 && r.bottom <= dno) return;
      }
      const o = okvir.getBoundingClientRect();
      const r = redak.getBoundingClientRect();
      /* Popis ne klizi uvijek sam: na mobitelu klizi cijeli prikaz, pa se tada
         prepušta pregledniku da nađe što treba pomaknuti. */
      if (okvir.scrollHeight <= okvir.clientHeight) {
        redak.scrollIntoView({ block: "center" });
        return;
      }
      const cilj = Math.max(0, okvir.scrollTop + r.top - o.top - (o.height - r.height) / 2);
      if (kako === "odmah") {
        okvir.scrollTop = cilj;
        return;
      }
      okvir.scrollTo({ top: cilj, behavior: "smooth" });
      /* Glatko klizanje preglednik zna i preskočiti, u prozoru koji se ne crta
         ili kad je pomak dug, pa ako popis nije stigao, skače se odmah. */
      setTimeout(() => {
        if (Date.now() - rucnoPomaknuto.current < 1000) return;
        if (Math.abs(okvir.scrollTop - cilj) > 4) okvir.scrollTop = cilj;
      }, 900);
    },
    [sada],
  );

  /* Otvori li se popis u kojem svira ono što svira, popis se otvara na njoj. */
  useEffect(() => {
    if (ucitavam) return;
    pokaziSviranu("odmah", false);
    // Samo pri otvaranju police; sljedeća pjesma ima svoj učinak ispod.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polica.id, ucitavam]);

  /* Kad krene sljedeća, popis je prati, osim dok ga čovjek sam pomiče. */
  const sadaId = sada ? sada.id : "";
  useEffect(() => {
    if (!sadaId || Date.now() - rucnoPomaknuto.current < 4000) return;
    pokaziSviranu("glatko", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sadaId]);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const naTipku = (e) => {
      const c = /** @type {HTMLElement} */ (e.target);
      const upisuje = c && (c.tagName === "INPUT" || c.tagName === "TEXTAREA" || c.isContentEditable);
      if (e.key === "Escape") {
        if (zaUkloniti) {
          if (!uklanjam) setZaUkloniti(null);
        } else if (noviPopisZa !== null) setNoviPopisZa(null);
        else if (jelovnik) setJelovnik(null);
        else if (mjeracOtvoren) setMjeracOtvoren(null);
        else if (zbirkaOtvorena) setZbirkaOtvorena(false);
        return;
      }
      if (upisuje) return;
      if (e.key === " ") {
        e.preventDefault();
        prekidac();
      } else if (e.key === "ArrowRight") {
        svirac.pomakZa(5);
      } else if (e.key === "ArrowLeft") {
        svirac.pomakZa(-5);
      }
    };
    document.addEventListener("keydown", naTipku);
    return () => document.removeEventListener("keydown", naTipku);
  }, [prekidac, jelovnik, mjeracOtvoren, zbirkaOtvorena, noviPopisZa, zaUkloniti, uklanjam]);

  useEffect(() => {
    if (!jelovnik) return;
    const zatvori = () => setJelovnik(null);
    window.addEventListener("click", zatvori);
    window.addEventListener("resize", zatvori);
    return () => {
      window.removeEventListener("click", zatvori);
      window.removeEventListener("resize", zatvori);
    };
  }, [jelovnik]);

  /* Izbornik mjerača zatvara se klikom bilo gdje drugdje. Sam izbornik klik
     zaustavlja, pa preživi klik po sebi. */
  useEffect(() => {
    if (!mjeracOtvoren) return;
    const zatvori = () => setMjeracOtvoren(null);
    window.addEventListener("click", zatvori);
    window.addEventListener("resize", zatvori);
    return () => {
      window.removeEventListener("click", zatvori);
      window.removeEventListener("resize", zatvori);
    };
  }, [mjeracOtvoren]);

  /* Otvoren svirač na mobitelu pokriva cijeli zaslon, pa se zatvara i tipkom
     natrag na uređaju, a ne samo strelicom dolje. Zapis u povijesti je lažan:
     ne mijenja adresu, nego samo daje toj tipki što zatvoriti. */
  useEffect(() => {
    if (!puniSvirac) return undefined;
    /** @param {KeyboardEvent} e */
    const naTipku = (e) => {
      if (e.key === "Escape") setPuniSvirac(false);
    };
    const naNatrag = () => setPuniSvirac(false);
    window.history.pushState({ svirac: true }, "");
    window.addEventListener("popstate", naNatrag);
    document.addEventListener("keydown", naTipku);
    return () => {
      window.removeEventListener("popstate", naNatrag);
      document.removeEventListener("keydown", naTipku);
      /* Ako se svirač zatvorio strelicom, lažni zapis treba maknuti sam, da
         tipka natrag ne troši jedan pritisak na prazno. */
      if (window.history.state && window.history.state.svirac) window.history.back();
    };
  }, [puniSvirac]);

  /** Novo odbrojavanje. @param {number} minuta */
  const postaviMjerac = useCallback((minuta) => {
    svirac.postaviMjerac(minuta);
    setMjeracOtvoren(null);
  }, []);

  /* ---------- popisi koje radi korisnik ---------- */

  /**
   * Novi popis se otvara vlastitim okvirom, a ne kroz `window.prompt`, jer taj
   * zaustavi cijelu stranicu i izgleda kao poruka preglednika, a ne kao dio
   * Lucifyja.
   * @param {string[]} [pocetne]
   */
  const zatraziPopis = useCallback((pocetne) => {
    setNoviPopisZa(pocetne || []);
    setNovoIme(t("Moj popis"));
  }, [t]);

  const napraviPopis = useCallback(() => {
    const naslov = novoIme.trim();
    if (!naslov || noviPopisZa === null) return;
    const id = "lista-" + Date.now().toString(36);
    setListe((l) => [...l, { id, naslov, pjesme: noviPopisZa }]);
    setOtvoreno({ vrsta: "lista", id });
    setNoviPopisZa(null);
  }, [novoIme, noviPopisZa]);

  const uPopis = useCallback((idListe, idPjesme) => {
    setListe((l) =>
      l.map((x) =>
        x.id === idListe && !x.pjesme.includes(idPjesme)
          ? { ...x, pjesme: [...x.pjesme, idPjesme] }
          : x,
      ),
    );
  }, []);

  /**
   * Van iz popisa, ali ne i iz zbirke.
   *
   * Miče se samo iz **vlastitih popisa**, jer su oni ono što je čovjek složio i
   * smije rasložiti. Glavne mape i police po izvođačima nisu popisi nego pogled
   * na zbirku, pa se odande pjesma ne miče nego **uklanja** — skroz, sa
   * snimkom, vidi `ukloni` ispod.
   */
  const izPopisa = useCallback((idListe, idPjesme) => {
    setListe((l) =>
      l.map((x) =>
        x.id === idListe ? { ...x, pjesme: x.pjesme.filter((p) => p !== idPjesme) } : x,
      ),
    );
  }, []);

  const srce = useCallback((id) => {
    setSrca((s) => (s.includes(id) ? s.filter((x) => x !== id) : [id, ...s]));
  }, []);

  /** Iz jedne glavne mape u drugu. @param {any} p */
  const premjesti = useCallback(
    (p) => {
      const u = glavnaMapa(p) === HRVATSKE ? "drugi" : "hr";
      setJezici((j) => {
        const novi = { ...j };
        /* Vraćena na ono što piše u popisu, pjesma iz ovoga zapisa ispada. */
        if ((p.jezik || "drugi") === u) delete novi[p.id];
        else novi[p.id] = u;
        return novi;
      });
    },
    [glavnaMapa],
  );

  /**
   * Pjesma van iz zbirke, sa snimkom.
   *
   * Nije isto što i „Makni iz ovog popisa”: ondje pjesma ostaje u zbirci, a
   * ovdje odlazi s diska, odnosno s mobitela, i oslobađa mjesto. Zato traži
   * potvrdu, a natrag se vraća samo ponovnim dodavanjem poveznice.
   */
  const ukloni = useCallback(async () => {
    const p = zaUkloniti;
    if (!p || uklanjam) return;
    setUklanjam(true);
    setGreskaUklanjanja("");
    /* Svirač je pušta prije brisanja, da poslužitelj ne briše datoteku koju
       element još čita. */
    svirac.izbaci(p.id);
    try {
      await ukloniPjesmu(p.id);
    } catch (e) {
      setGreskaUklanjanja(e && e.message ? String(e.message) : t("Pjesma se nije dala ukloniti."));
      setUklanjam(false);
      return;
    }
    setSrca((s) => s.filter((x) => x !== p.id));
    setListe((l) => l.map((x) => ({ ...x, pjesme: x.pjesme.filter((y) => y !== p.id) })));
    setJezici((j) => {
      if (!(p.id in j)) return j;
      const novi = { ...j };
      delete novi[p.id];
      return novi;
    });
    await ucitajPopis();
    setUklanjam(false);
    setZaUkloniti(null);
  }, [zaUkloniti, uklanjam, ucitajPopis, t]);

  /* ---------- prikaz ---------- */

  /* Okvir za dodavanje stoji u svim trima granama prikaza, jer se pjesma
     dodaje i kad je zbirka prazna. Nije grid ćelija nego `position: fixed`, pa
     ne pomiče ništa ispod sebe. */
  const okvirDodaj =
    PREUZIMAC && dodajOtvoren ? (
      <Suspense fallback={null}>
        <Dodaj
          naZatvori={() => setDodajOtvoren(false)}
          naDodano={ucitajPopis}
          naPusti={(id) => pusti([id], 0, "")}
        />
      </Suspense>
    ) : null;

  const okvirVeze = vezeOtvorene ? (
    <Suspense fallback={null}>
      <Poveznice pjesme={sve} naZatvori={() => setVezeOtvorene(false)} />
    </Suspense>
  ) : null;

  /* Uvoz mijenja zbirku pod rukom, pa se po njegovu zatvaranju popis čita
     iznova, isto kao poslije preuzimanja. */
  const okvirUvoz =
    NA_UREDAJU && uvozOtvoren ? (
      <Suspense fallback={null}>
        <Uvoz naZatvori={() => setUvozOtvoren(false)} naUvezeno={ucitajPopis} />
      </Suspense>
    ) : null;

  /** Tipka koja taj okvir otvara. @param {string} [razred] */
  const tipkaDodaj = (razred) =>
    PREUZIMAC ? (
      <button
        type="button"
        className={"gdodajtipka" + (razred ? " " + razred : "")}
        aria-label={t("Dodaj pjesmu")}
        onClick={() => setDodajOtvoren(true)}
      >
        <ListPlus size={17} aria-hidden="true" />
        <span>{t("Dodaj pjesmu")}</span>
      </button>
    ) : null;

  /** Njezin par na uređaju: ondje se zbirka ne preuzima nego unosi. @param {string} [razred] */
  const tipkaUvoz = (razred) =>
    NA_UREDAJU ? (
      <button
        type="button"
        className={"gdodajtipka" + (razred ? " " + razred : "")}
        aria-label={t("Zbirka na uređaju")}
        onClick={() => setUvozOtvoren(true)}
      >
        <FolderInput size={17} aria-hidden="true" />
        <span>{t("Zbirka")}</span>
      </button>
    ) : null;

  if (ucitavam) {
    return (
      <div className="glazba">
        <div />
        <div className="gporuka">
          <p>{t("Otvaram zbirku…")}</p>
        </div>
        <div />
        {okvirDodaj}
        {okvirUvoz}
        {okvirVeze}
      </div>
    );
  }

  const razredi =
    "gsadrzaj" + (panel ? " spanelom" : "") + (zbirkaOtvorena ? " szbirkom" : "");

  /** Natpis vrste police, iznad naslova i ispod njega u zbirci. @param {string} vrsta */
  const vrstaPolice = (vrsta) =>
    vrsta === "izvodac" ? t("Izvođač") : vrsta === "mapa" || vrsta === "sve" ? t("Mapa") : t("Popis");

  /* Naslov stupca kojim se popis poreda. Obična funkcija, a ne komponenta,
     jer bi React komponentu opisanu unutar Lucifyja pri svakom prikazu
     smatrao novom vrstom i odmontirao je, kao što je opisano i uz izbornik
     bilježaka. Prije je poredak birao `<select>`, koji otvara popis
     operacijskoga sustava, bijel i četvrtast, pa je iz Lucifyja iskakao.
     @param {string} id @param {string} ime @param {string} [razred] */
  const zaglavlje = (id, ime, razred) => {
    const on = poredak === id;
    return (
      <button
        type="button"
        className={"gporedaj" + (razred ? " " + razred : "") + (on ? " on" : "")}
        aria-label={t("Poredaj po: ") + ime + (on && !silazno ? ", od najmanjega" : "")}
        onClick={() => {
          if (on) setSilazno((v) => !v);
          else {
            setPoredak(id);
            /* Naslov se prvi put očekuje od A do Ž, a datum i trajanje od
               najvećega, jer „nedavno dodano” znači najnovije na vrhu. */
            setSilazno(id !== "naslov");
          }
        }}
      >
        <span>{ime}</span>
        {on ? (
          <ChevronDown size={13} className={silazno ? undefined : "gore"} aria-hidden="true" />
        ) : null}
      </button>
    );
  };

  return (
    <div className="glazba">
      <div className="gvrh">
        {/* Znak stoji lijevo od svega, kao u svakom sviraču, i ne pomiče se
            sa suženjem zaslona: tipka za zbirku iskoči desno od njega. */}
        <div className="gznak">
          <Znak mjera={24} />
          <b>Lucify</b>
        </div>
        {/* Jelovnik namjenske aplikacije. Otkad prozor nema sustavske
            naslovne trake, nema ni retka s jelovnikom, pa je ovo jedina vrata
            mapi zbirke koja se ne otvaraju Altom. Otvara ga prozor, a ne
            stranica: ona samo pokuca na vlastiti poslužitelj. */}
        {NAMJENSKA ? (
          <button
            type="button"
            className="gikona gjelovniktipka"
            aria-label={t("Jelovnik")}
            onClick={() => {
              fetch("/jelovnik", { method: "POST" }).catch(() => {
                /* Nema li poslužitelja, nema ni jelovnika; Alt i dalje radi. */
              });
            }}
          >
            <MoreHorizontal size={19} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="gikona zbirkatipka"
          aria-label={t("Zbirka")}
          onClick={() => setZbirkaOtvorena((v) => !v)}
        >
          <ListMusic size={19} aria-hidden="true" />
        </button>
        <label className="gtrazi">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={trazi}
            placeholder={t("Što želiš slušati?")}
            aria-label={t("Traži po zbirci")}
            autoComplete="off"
            onChange={(e) => {
              const upisano = e.target.value;
              setTrazi(upisano);
              if (upisano.trim()) {
                /* Traži se po cijeloj zbirci, a zapamti se odakle se krenulo. */
                if (otvoreno.id !== "sve") prijeTrazenja.current = otvoreno;
                setOtvoreno({ vrsta: "sve", id: "sve" });
              } else if (prijeTrazenja.current) {
                setOtvoreno(prijeTrazenja.current);
                prijeTrazenja.current = null;
              }
            }}
          />
        </label>
        <div className="desno">
          {/* Jezik: dvije riječi, pa nema izbornika nego tipka koja ih
              izmjenjuje. Piše ono na što se prelazi, a ne ono što je sada, jer
              se u tipku gleda kad se hoće drugo. */}
          <button
            type="button"
            className="gikona gjeziktipka"
            aria-label={jezik === "hr" ? "Switch to English" : "Prebaci na hrvatski"}
            title={jezik === "hr" ? "Switch to English" : "Prebaci na hrvatski"}
            onClick={() => jezikStanje.postavi(jezikStanje.drugi())}
          >
            <span aria-hidden="true">{jezik === "hr" ? "EN" : "HR"}</span>
            <Globe size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="gdodajtipka"
            aria-label={t("Poveznice")}
            onClick={() => setVezeOtvorene(true)}
          >
            <Link2 size={17} aria-hidden="true" />
            <span>{t("Poveznice")}</span>
          </button>
          {tipkaDodaj()}
          {tipkaUvoz()}
          {/* Samo na objavljenoj stranici: ondje se pjesma ne može preuzeti
              poveznicom, jer iza stranice nema ni yt-dlpa ni ffmpega. Zbirka se
              ondje unosi gotova, a slaže je namjenska aplikacija. Tko je već u
              njoj, ili na `npm run dev`, nema što preuzimati. */}
          {!PREUZIMAC ? (
            <a
              className="gdodajtipka"
              href={IZDANJA}
              target="_blank"
              rel="noreferrer"
              aria-label={t("Lucify za računalo")}
            >
              <Download size={17} aria-hidden="true" />
              <span>{t("Za računalo")}</span>
            </a>
          ) : null}
          <button
            type="button"
            className="gikona gplocatipka"
            aria-pressed={panel}
            aria-label={t("Ploča sa strane")}
            onClick={() => setPanel((v) => !v)}
          >
            <PanelRight size={19} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={razredi}>
        <div
          className="gzastor"
          onClick={() => {
            setZbirkaOtvorena(false);
            setPanel(false);
          }}
        />

        <nav className="gzbirka" aria-label={t("Zbirka")}>
          <div className="gzglava">
            <ListMusic size={18} aria-hidden="true" />
            {t("Tvoja zbirka")}
            <button
              type="button"
              className="novi"
              aria-label={t("Novi popis")}
              onClick={() => zatraziPopis()}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="gfiltar">
            {[
              ["sve", t("Sve")],
              ["liste", t("Popisi")],
              ["izvodaci", t("Izvođači")],
            ].map(([id, ime]) => (
              <button
                key={id}
                type="button"
                className="gcip"
                aria-pressed={filtar === id}
                onClick={() => setFiltar(id)}
              >
                {ime}
              </button>
            ))}
          </div>

          <div className="gzpretraga">
            <input
              type="search"
              value={traziZbirku}
              placeholder={t("Traži u zbirci")}
              aria-label={t("Traži u zbirci")}
              autoComplete="off"
              onChange={(e) => setTraziZbirku(e.target.value)}
            />
          </div>

          <div className="gpopis">
            {viđene.map((p) => {
              const prve = omotiPolica.get(p.id) || [];
              const ovdjeSvira = p.id === policaKojaSvira;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={"gstavka" + (ovdjeSvira ? " svira" : "")}
                  aria-current={p.id === polica.id ? "true" : undefined}
                  onClick={() => {
                    setOtvoreno({ vrsta: p.vrsta, id: p.id });
                    setTrazi("");
                    prijeTrazenja.current = null;
                    setZbirkaOtvorena(false);
                  }}
                >
                  <Omot ime={p.naslov} mozaik={p.vrsta === "izvodac" ? prve.slice(0, 1) : prve} />
                  <span>
                    <b>{p.naslov}</b>
                    <span>
                      {vrstaPolice(p.vrsta)} &middot; {p.pjesme.length}{" "}
                      {pjesama(p.pjesme.length, jezik)}
                    </span>
                  </span>
                  {/* Isti stupci kao u retku pjesme, uz popis s kojega svira. */}
                  {ovdjeSvira && svira ? <Stupci /> : null}
                </button>
              );
            })}
            {viđene.length === 0 ? <p className="gprazno">{t("Ništa pod tim imenom.")}</p> : null}
          </div>
        </nav>

        <main
          className="gglavno"
          ref={glavnoRef}
          onWheel={() => {
            rucnoPomaknuto.current = Date.now();
          }}
          onTouchMove={() => {
            rucnoPomaknuto.current = Date.now();
          }}
        >
          <header className="gzaglavlje" style={stil({ "--ton": ton(polica.naslov) })}>
            <Omot
              ime={polica.naslov}
              mozaik={polica.vrsta === "izvodac" ? mozaik.slice(0, 1) : mozaik}
            />
            <div className="gnatpisi">
              <div className="vrsta">{vrstaPolice(polica.vrsta)}</div>
              <h1>{polica.naslov}</h1>
              <div className="mjere">
                <b>Lucify</b>
                <span className="tocka">&middot;</span>
                {prikazane.length} {pjesama(prikazane.length, jezik)}
                {trajanjePolice ? (
                  <>
                    <span className="tocka">&middot;</span>
                    {koliko(trajanjePolice)}
                  </>
                ) : null}
              </div>
            </div>
          </header>

          <div className="galatke">
            <button
              type="button"
              className="gpusti"
              aria-label={svira ? t("Zaustavi") : t("Pusti")}
              disabled={!prikazane.length}
              onClick={() => {
                const isti = sada && prikazane.some((p) => p.id === sada.id) && red.length;
                if (isti) prekidac();
                else if (prikazane.length) pusti(prikazane.map((p) => p.id), 0, polica.id);
              }}
            >
              {svira ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <button
              type="button"
              className="gikona"
              aria-pressed={mijesaj}
              aria-label={t("Nasumično")}
              onClick={() => {
                svirac.postaviMijesaj(!mijesaj);
              }}
            >
              <Shuffle size={22} aria-hidden="true" />
            </button>

            {/* Mjerač vremena stoji uz desni rub alatki, jer se ne dira pri
                svakoj pjesmi nego jednom, na početku slušanja. */}
            <div className="gmjerac">
              <button
                type="button"
                className={"gikona" + (imaMjerac ? " gtraje" : "")}
                aria-expanded={!!mjeracOtvoren}
                aria-label={t("Mjerač vremena")}
                title={t("Zaustavi glazbu nakon zadanog vremena")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (mjeracOtvoren) {
                    setMjeracOtvoren(null);
                    return;
                  }
                  /* Izbornik se ravna po desnom rubu gumba, jer i gumb stoji uz
                     desni rub. Najveća visina računa se odmah, pa na niskom
                     prozoru izbornik dobije vlastiti klizač umjesto da mu zadnji
                     redak ostane ispod ruba zaslona.
                     Ako je ispod tijesno, a iznad ima više mjesta, visi s gornje
                     strane gumba. Tada se mjesto zadaje odozdo, pa se visina
                     izbornika ne mora znati unaprijed, a ona ovisi o tome je li
                     mjerač postavljen. */
                  const r = e.currentTarget.getBoundingClientRect();
                  const ispod = window.innerHeight - r.bottom - 18;
                  const iznad = r.top - 18;
                  const gore = ispod < 260 && iznad > ispod;
                  setMjeracOtvoren({
                    x: Math.max(8, r.right - 232),
                    y: gore ? window.innerHeight - r.top + 6 : r.bottom + 6,
                    visina: gore ? iznad : ispod,
                    gore,
                  });
                }}
              >
                <Clock size={22} aria-hidden="true" />
                <MjeracOdbroj t={t} />
              </button>

              {mjeracOtvoren ? (
                <div
                  className="gjelovnik gmjerilo"
                  style={{
                    left: mjeracOtvoren.x,
                    top: mjeracOtvoren.gore ? "auto" : mjeracOtvoren.y,
                    bottom: mjeracOtvoren.gore ? mjeracOtvoren.y : "auto",
                    maxHeight: mjeracOtvoren.visina,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h6>{t("Zaustavi glazbu nakon")}</h6>
                  {MJERILA.map((m) => (
                    <button key={m} type="button" onClick={() => postaviMjerac(m)}>
                      {trajanjeRijecju(m, jezik)}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-current={mjeracKraj ? "true" : undefined}
                    onClick={() => {
                      svirac.mjeracDoKraja();
                      setMjeracOtvoren(null);
                    }}
                  >
                    {t("Do kraja pjesme")}
                  </button>
                  <hr />
                  {/* Vlastito vrijeme, jer šest ponuđenih trajanja ne pogađa
                      svaki put ono koliko se doista kani slušati. */}
                  <form
                    className="gvlastito"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = Math.round(Number(vlastito));
                      if (n > 0) postaviMjerac(Math.min(n, 600));
                    }}
                  >
                    <input
                      type="number"
                      min="1"
                      max="600"
                      inputMode="numeric"
                      value={vlastito}
                      aria-label={t("Vlastito vrijeme u minutama")}
                      onChange={(e) => setVlastito(e.target.value)}
                    />
                    <span>min</span>
                    <button type="submit">{t("Postavi")}</button>
                  </form>
                  {imaMjerac ? (
                    <>
                      <hr />
                      <button
                        type="button"
                        onClick={() => {
                          svirac.ugasiMjerac();
                          setMjeracOtvoren(null);
                        }}
                      >
                        {t("Isključi mjerač")}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="gtablica">
            <div className="gredak gzaglavljeredka">
              <span className="gbroj">#</span>
              {zaglavlje("naslov", t("Naslov"))}
              <span className="stupac">{t("Razdoblje i izvor")}</span>
              {zaglavlje("dodano", t("Dodano"), "dodano")}
              {zaglavlje("trajanje", t("Trajanje"), "kraj")}
            </div>

            {prikazane.map((p, i) => {
              const jeSada = !!sada && sada.id === p.id;
              return (
                <Redak
                  key={p.id}
                  p={p}
                  i={i}
                  jeSada={jeSada}
                  tece={jeSada && svira}
                  srcem={srcaSkup.has(p.id)}
                  otvoren={!!jelovnik && jelovnik.id === p.id}
                  mreza={mreza}
                  t={t}
                  naPusti={pustiRedak}
                  naSrce={srce}
                  naJelovnik={otvoriJelovnik}
                />
              );
            })}

            {prikazane.length === 0 ? (
              trazi.trim() ? (
                <p className="gprazno">{t("Ništa za „") + trazi.trim() + "”."}</p>
              ) : sve.length ? (
                <p className="gprazno">{t("U ovom popisu još nema ničega.")}</p>
              ) : (
                /* Prazna zbirka objašnjava se ovdje, unutar popisa, a ne preko
                   cijeloga zaslona: gornja traka mora ostati vidljiva, jer na
                   objavljenoj stranici u njoj stoje „Poveznice”, a one su ondje
                   jedino što je od zbirke ostalo. */
                <div className="gporuka gpraznozbirka">
                  {NAMJENSKA ? (
                    <>
                      <p>
                        Zbirka je prazna. Snimke stoje u mapi zbirke, koja se otvara iz
                        jelovnika: <b>Lucify &rarr; Otvori mapu zbirke</b>. Ondje se mogu i
                        samo prekopirati, a Lucify ih pokupi pri idućem otvaranju.
                      </p>
                      <p>
                        {t("Najlakše ide poveznicom s YouTubea, tipkom")} <b>{t("Dodaj pjesmu")}</b> gore.
                      </p>
                    </>
                  ) : PREUZIMAC ? (
                    <>
                      <p>
                        {t("Zbirka je prazna. Snimke stoje u")} <code>Glazba/Zvuk/</code>, a ta mapa
                        nije u gitu, jer je glazba tuđe autorsko djelo.
                      </p>
                      <p>
                        <code>npm run glazba -- --uvezi &quot;putanja/do/mape&quot;</code>
                      </p>
                      <p>{t("Ili jednu po jednu, tipkom")} <b>{t("Dodaj pjesmu")}</b> gore.</p>
                    </>
                  ) : (
                    <>
                      <p>
                        Zbirka je prazna, jer je na ovom uređaju još nema. Glazba ne dolazi
                        odavde: snimke su tuđe autorsko djelo, pa ne idu ni u git ni na
                        objavljenu stranicu. Zbirku nosi sam uređaj, i unese se jednom.
                      </p>
                      <p>
                        {t("Mapu slaže Lucify za računalo, naredbom")} <code>npm run izvezi</code>.
                        Prenesi je na ovaj uređaj i otvori <b>{t("Zbirka")}</b> gore.
                      </p>
                      <p className="gpraznotipke">
                        {tipkaUvoz()}
                        <button
                          type="button"
                          className="gdodajtipka"
                          onClick={() => setVezeOtvorene(true)}
                        >
                          <Link2 size={17} aria-hidden="true" />
                          <span>{t("Otvori poveznice")}</span>
                        </button>
                        <a className="gdodajtipka" href={IZDANJA} target="_blank" rel="noreferrer">
                          <Download size={17} aria-hidden="true" />
                          <span>{t("Lucify za računalo")}</span>
                        </a>
                      </p>
                    </>
                  )}
                </div>
              )
            ) : null}
          </div>
        </main>

        {panel ? (
          <aside className="gpanel" aria-label={t("Sad svira")}>
            <div className="gvrhploce">
              <h2>{t("Sad svira")}</h2>
            </div>
            {sada ? (
              <>
                <Omot ime={sada.naslov} slika={sada.omot} klasa="veliki" />
                <div className="gime">{sada.naslov}</div>
                <div className="izvodac">{sada.izvodac}</div>

                {sada.razdoblje || sada.biljeska ? (
                  <div className="gkartica">
                    <h3>{t("Uz slušanje")}</h3>
                    {sada.razdoblje ? <span className="rub">{sada.razdoblje}</span> : null}
                    {sada.biljeska ? <p>{sada.biljeska}</p> : null}
                  </div>
                ) : null}

                <div className="gkartica">
                  <h3>{t("Zapis")}</h3>
                  <p>{sada.izvorniNaslov}</p>
                  {sada.yt && mreza ? (
                    <p style={{ marginTop: 8 }}>
                      <a
                        className="gizvor"
                        href={"https://www.youtube.com/watch?v=" + sada.yt}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t("Otvori izvornik na YouTubeu")}
                      </a>
                    </p>
                  ) : null}
                </div>

                {(() => {
                  const jos = sve
                    .filter((x) => x.izvodac === sada.izvodac && x.id !== sada.id)
                    .slice(0, 5);
                  if (!jos.length) return null;
                  return (
                    <div className="gkartica">
                      <h3>Još od {sada.izvodac}</h3>
                      <div className="gjos">
                        {jos.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            onClick={() => pusti([x.id, ...jos.filter((y) => y.id !== x.id).map((y) => y.id)], 0, "")}
                          >
                            <Omot ime={x.naslov} slika={x.omot} />
                            <span>
                              <b>{x.naslov}</b>
                              <span>{mmss(x.trajanje)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <p className="gprazno">{t("Ništa ne svira. Odaberi pjesmu s popisa.")}</p>
            )}
          </aside>
        ) : null}
      </div>

      <div
        className={"gsvirac" + (puniSvirac ? " puni" : "") + (sada ? "" : " prazan")}
        style={stil({ "--ton": sada ? ton(sada.naslov) : 210 })}
      >
        {/* Samo na mobitelu: kartica se dodiruje da se svirač otvori preko
            cijeloga zaslona. Tipka pokriva omot i natpis, ali ne i srce ni
            puštanje — oni nad njom imaju svoj sloj. */}
        {sada ? (
          <button
            type="button"
            className="gotvorisvirac"
            aria-label={t("Otvori svirač")}
            onClick={() => setPuniSvirac(true)}
          />
        ) : null}

        <div className="gpunivrh">
          <button
            type="button"
            className="gikona gspusti"
            aria-label={t("Zatvori svirač")}
            onClick={() => setPuniSvirac(false)}
          >
            <ChevronDown size={24} aria-hidden="true" />
          </button>
          <span className="gpunislog">{t("Sad svira")}</span>
        </div>

        <div className="gsada">
          {sada ? (
            <>
              <Omot ime={sada.naslov} slika={sada.omot} />
              <span className="tekst">
                <b>{sada.naslov}</b>
                <span>{sada.izvodac}</span>
              </span>
              <button
                type="button"
                className={"gsrce" + (srca.includes(sada.id) ? " puno" : "")}
                aria-label={srca.includes(sada.id) ? t("Makni iz srca") : t("Označi srcem")}
                aria-pressed={srca.includes(sada.id)}
                onClick={() => srce(sada.id)}
              >
                <Heart size={16} fill={srca.includes(sada.id) ? "currentColor" : "none"} />
              </button>
            </>
          ) : null}
        </div>

        <div className="gsredina">
          <div className="gtipke">
            <button
              type="button"
              className="gikona"
              aria-pressed={mijesaj}
              aria-label={t("Nasumično")}
              onClick={() => {
                svirac.postaviMijesaj(!mijesaj);
              }}
            >
              <Shuffle size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="gikona"
              aria-label={t("Prethodna")}
              disabled={!red.length}
              onClick={() => pomakni(-1)}
            >
              <SkipBack size={18} fill="currentColor" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="gsvira"
              aria-label={svira ? t("Zaustavi") : t("Pusti")}
              onClick={prekidac}
            >
              {svira ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              className="gikona"
              aria-label={t("Sljedeća")}
              disabled={!red.length}
              onClick={() => pomakni(1)}
            >
              <SkipForward size={18} fill="currentColor" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="gikona"
              aria-pressed={ponovi !== "ne"}
              aria-label={
                ponovi === "ne"
                  ? t("Ponavljanje isključeno")
                  : ponovi === "sve"
                    ? t("Ponavljaj popis")
                    : t("Ponavljaj pjesmu")
              }
              onClick={() => svirac.sljedecePonavljanje()}
            >
              {ponovi === "jedna" ? (
                <Repeat1 size={17} aria-hidden="true" />
              ) : (
                <Repeat size={17} aria-hidden="true" />
              )}
            </button>
          </div>

          <Vrijeme t={t} />
        </div>

        <Glasnoca t={t} />
      </div>

      {/* Donja traka postoji samo na mobitelu, gdje se za zbirku i svirač
          nema gdje drugdje uhvatiti: zbirka je ondje ladica, a svirač kartica.
          Tri odredišta su tri stvari koje Lucify doista ima, pa traka ne
          obećava sobe kojih nema. */}
      <nav className="gtraka" aria-label={t("Glavno kretanje")}>
        <button
          type="button"
          className={"gtrakatipka" + (zbirkaOtvorena ? " on" : "")}
          aria-current={zbirkaOtvorena ? "page" : undefined}
          onClick={() => {
            setPuniSvirac(false);
            setZbirkaOtvorena(true);
          }}
        >
          <Library size={21} aria-hidden="true" />
          <span>{t("Zbirka")}</span>
        </button>
        <button
          type="button"
          className={"gtrakatipka" + (!zbirkaOtvorena && !puniSvirac ? " on" : "")}
          aria-current={!zbirkaOtvorena && !puniSvirac ? "page" : undefined}
          onClick={() => {
            setPuniSvirac(false);
            setZbirkaOtvorena(false);
          }}
        >
          <ListMusic size={21} aria-hidden="true" />
          <span>{t("Popis")}</span>
        </button>
        <button
          type="button"
          className={"gtrakatipka" + (puniSvirac ? " on" : "")}
          aria-current={puniSvirac ? "page" : undefined}
          disabled={!sada}
          onClick={() => {
            setZbirkaOtvorena(false);
            setPuniSvirac(true);
          }}
        >
          <Disc3 size={21} aria-hidden="true" />
          <span>{t("Sad svira")}</span>
        </button>
      </nav>

      {noviPopisZa !== null ? (
        <div className="gokvir" onClick={() => setNoviPopisZa(null)}>
          <form
            className="gkutija"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              napraviPopis();
            }}
          >
            <h2>{t("Novi popis")}</h2>
            <label htmlFor="gnovoime">{t("Kako se zove?")}</label>
            <input
              id="gnovoime"
              value={novoIme}
              autoFocus
              maxLength={60}
              onChange={(e) => setNovoIme(e.target.value)}
            />
            {noviPopisZa.length ? (
              <p className="uz">
                U njega odmah ide {noviPopisZa.length}{" "}
                {pjesama(noviPopisZa.length, jezik)}.
              </p>
            ) : null}
            <div className="gdno">
              <button type="button" className="blijedo" onClick={() => setNoviPopisZa(null)}>
                {t("Odustani")}
              </button>
              <button type="submit" className="glavna" disabled={!novoIme.trim()}>
                {t("Napravi")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {okvirDodaj}
      {okvirUvoz}
      {okvirVeze}

      {jelovnik ? (
        <div
          className="gjelovnik"
          style={{
            left: jelovnik.x,
            top: jelovnik.gore ? "auto" : jelovnik.y,
            bottom: jelovnik.gore ? jelovnik.y : "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              srce(jelovnik.id);
              setJelovnik(null);
            }}
          >
            {srcaSkup.has(jelovnik.id) ? t("Makni iz srca") : t("Označi srcem")}
          </button>
          <hr />
          <h6>{t("Dodaj u popis")}</h6>
          {liste.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                uPopis(l.id, jelovnik.id);
                setJelovnik(null);
              }}
            >
              {l.naslov}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              zatraziPopis([jelovnik.id]);
              setJelovnik(null);
            }}
          >
            {t("Novi popis…")}
          </button>
          {otvoreno.vrsta === "lista" ? (
            <>
              <hr />
              <button
                type="button"
                onClick={() => {
                  izPopisa(otvoreno.id, jelovnik.id);
                  setJelovnik(null);
                }}
              >
                {t("Makni iz ovog popisa")}
              </button>
            </>
          ) : null}
          {poId.get(jelovnik.id) ? (
            <>
              <hr />
              <button
                type="button"
                onClick={() => {
                  premjesti(poId.get(jelovnik.id));
                  setJelovnik(null);
                }}
              >
                {glavnaMapa(poId.get(jelovnik.id)) === HRVATSKE
                  ? t("Premjesti u Sve ostale pjesme")
                  : t("Premjesti u Hrvatske pjesme")}
              </button>
              {poId.get(jelovnik.id).yt && mreza ? (
                <a
                  href={"https://www.youtube.com/watch?v=" + poId.get(jelovnik.id).yt}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("Otvori na YouTubeu")}
                </a>
              ) : null}
              <hr />
              <button
                type="button"
                className="gopasno"
                onClick={() => {
                  setGreskaUklanjanja("");
                  setZaUkloniti(poId.get(jelovnik.id));
                  setJelovnik(null);
                }}
              >
                {t("Ukloni iz zbirke…")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {zaUkloniti ? (
        <div className="gokvir" onClick={() => (uklanjam ? null : setZaUkloniti(null))}>
          <div
            className="gkutija gukloni"
            role="alertdialog"
            aria-labelledby="gukloninaslov"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gukloniglava">
              <Omot ime={zaUkloniti.naslov} slika={zaUkloniti.omot} />
              <div>
                <h2 id="gukloninaslov">{t("Ukloniti iz zbirke?")}</h2>
                <b>{zaUkloniti.naslov}</b>
                <span>{zaUkloniti.izvodac}</span>
              </div>
            </div>
            <p className="uz">
              {NA_UREDAJU
                ? t("Snimka se briše s ovog uređaja i oslobađa mjesto. Nestaje i iz srca i iz svih popisa.")
                : t("Snimka se briše s diska i oslobađa mjesto. Nestaje i iz srca i iz svih popisa.")}
            </p>
            <p className="uz">
              {NA_UREDAJU
                ? t("Natrag se vraća samo iznova: poveznicom u Lucifyju na računalu, pa uvozom cijele zbirke.")
                : t("Natrag se vraća samo iznova, poveznicom, tipkom „Dodaj pjesmu”.")}
            </p>
            {zaUkloniti.yt ? (
              /* Poveznica stoji odmah ovdje, jer je upravo ona ono što će
                 trebati da se pjesma vrati. */
              <input
                className="gukloniveza"
                readOnly
                value={adresaSnimke(zaUkloniti.yt)}
                aria-label={t("Poveznica na snimku")}
                onFocus={(e) => e.currentTarget.select()}
              />
            ) : null}
            {greskaUklanjanja ? <p className="guklonigreska">{greskaUklanjanja}</p> : null}
            <div className="gdno">
              <button
                type="button"
                className="blijedo"
                disabled={uklanjam}
                onClick={() => setZaUkloniti(null)}
              >
                {t("Odustani")}
              </button>
              <button type="button" className="glavna opasno" disabled={uklanjam} autoFocus onClick={ukloni}>
                {uklanjam ? t("Uklanjam…") : t("Ukloni")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
