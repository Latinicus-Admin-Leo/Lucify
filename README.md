# Lucify

Vlastita zbirka glazbe i svirač uz nju. Zbirka stoji na disku, popis se čita iz samih
snimaka, a nove pjesme ulaze poveznicom s YouTubea, iz samoga Lucifyja.

Prije je ovo bio alat unutar školske mape **Lucijankice** i ondje je imao tipku „Natrag na
bilješke”. Ondje se zvao **Slušaonica**; ovdje je sam sebi stranica i zove se Lucify. Sve
ostalo je isto.

Živi na dva načina: kao stranica na razvojnom poslužitelju i kao **namjenska aplikacija za
Windows**, koja se instalira i otvara kao svaki drugi program. Opis je [na dnu](#namjenska-aplikacija).

Znak stoji u `public/lucify.svg`, i to je jedini primjerak koji se mijenja: iz njega
`npm run ikona` napravi `build/icon.png`, iz koje graditelj složi ikonu programa.
Isti je znak još jednom ispisan u `src/Znak.jsx`, jer se u gornjoj traci crta ugrađen, pa
ga treba mijenjati zajedno s datotekom.

```bash
npm install        # ovisnosti, uz njih i ffmpeg
npm run dev        # razvojni poslužitelj (port 5176)
npm run glazba     # iznova pročita zbirku
npm run build      # produkcijski build
npm run lint       # eslint . --quiet
npm run typecheck  # tsc prema jsconfig (checkJs)

npm run namjenska  # namjenska aplikacija, iz izvora, bez pakiranja
npm run pakiraj    # instalacija i prijenosni program u `izdanje/`
npm run ikona      # public/lucify.svg -> build/icon.png
```

Port je **5176**, a ne 5174, da Lucify i Lucijankica mogu raditi istodobno.

## Zbirka

Snimke stoje u **`Glazba/Zvuk/`**, uz `popis.json` i mapu `omoti/`. Ta mapa **nije u
gitu** i **nije u `public/`**, i to su dva odvojena razloga:

- **Nije u gitu** zato što je glazba tuđe autorsko djelo i osobna je.
- **Nije u `public/`** zato što Vite sve odande prepisuje u `dist/`, pa bi svaki build
  uzalud kopirao šest stotina megabajta.

Zato ih na razvojnom poslužitelju poslužuje mali dodatak u `vite.config.js`, s adrese
`/glazba/`, i to samo uz `apply: "serve"`. Popis se zato **dohvaća, a ne uvozi**: da se
uvozi, build bi pao ondje gdje zbirke nema. Ovako Lucify ondje samo kaže da je zbirka
prazna, i to je namjerno.

**Provjera nakon `npm run build`:** u `dist/` ne smije biti mape `glazba`, ni datoteke
`popis.json`, ni ijednoga naslova pjesme u `assets/*.js`.

### Uvoz snimaka

```bash
npm run glazba                            # iznova pročita zbirku
npm run glazba -- --uvezi "<mapa>"        # prije toga preseli nove snimke iz mape
```

Ime datoteke je **oznaka izvorne snimke** (`ETxmCCsMoD0.mp3`), a ne naslov, jer u
naslovima ima emojija, japanskoga i ćirilice, a ime datoteke mora preživjeti i Windows, i
URL, i poslužitelj. Pravi naslov živi u popisu.

Ručno dopisano preživljava ponovno čitanje: `razdoblje` i `biljeska` uvijek, a naslov i
izvođač uz zastavicu `ispravljeno: true`. Bez nje bi ih svako čitanje vratilo na ono što
piše u datoteci, a ondje je izvođač često ime kanala koje je snimku prenijelo.

### Dodavanje pjesme iz samoga Lucifyja

U gornjoj traci stoji tipka **Dodaj pjesmu**: zalijepi se poveznica s YouTubea, jedna ili
cijeli popis, snimka se preuzme, pretvori u mp3 i odmah uđe u zbirku.

Radi **samo na razvojnom poslužitelju**, jer iza njega stoje yt-dlp i ffmpeg, kojih u
gotovom buildu nema.

- **ffmpeg** dolazi kroz `npm install`, kao neobavezna ovisnost (`ffmpeg-static`).
- **yt-dlp se ne isporučuje**, nego se instalira Pythonom:

  ```bash
  python -m pip install --upgrade yt-dlp
  ```

  Ista je naredba i popravak kad YouTube promijeni svirač, a preuzimanja počnu padati.

**Preuzima se samo ono na što se ima pravo.** Alat to ne može provjeriti i ne pokušava:
odluka je na onome tko lijepi poveznicu.

## Što je gdje

| Datoteka | Što drži |
|---|---|
| `src/Glazba.jsx` | sam Lucify: popis, police, pretraga, ploča „Sad svira” |
| `src/glazba-svirac.mjs` | zvuk, red čekanja, glasnoća, ponavljanje, mjerač vremena |
| `src/GlazbaDodaj.jsx` | okvir za dodavanje pjesme poveznicom |
| `src/glazba-veze.mjs` | čitanje YouTube poveznica, isto za preglednik i za poslužitelj |
| `src/glazba.css` | sav izgled |
| `src/Znak.jsx` | znak, ugrađen, za gornju traku |
| `scripts/glazba.mjs` | `npm run glazba`: selidba snimaka u zbirku |
| `scripts/glazba-zbirka.mjs` | čitanje snimke i slaganje popisa |
| `scripts/posluga.mjs` | posluživanje zbirke s `/glazba/`, uz `Range` |
| `scripts/preuzimac*.mjs` | poslovi preuzimanja, red čekanja, yt-dlp i ffmpeg |
| `scripts/ikona.mjs` | `npm run ikona`: znak u ikonu programa |
| `electron/glavni.mjs` | namjenska aplikacija: prozor, jelovnik, mapa zbirke |
| `electron/posluzitelj.mjs` | njezin poslužitelj: zbirka, preuzimač, gotov build |

**Svirač stoji izvan Reacta**, u modulskom stanju `glazba-svirac.mjs`, a prikaz ga čita
kroz `useSyncExternalStore`. To nije ukras: ono što ne smije preživjeti ponovni prikaz ne
stavlja se u prikaz.

**Nazivi razreda u CSS-u počinju slovom `g`.** Prije novoga naziva vrijedi `grep`, jer se
`glazba.css` zna sudariti sam sa sobom: razred za redak koji svira jednom je nazvan
`gsvira`, a to je već bio okrugli gumb od trideset četiri točke, pa se redak stisnuo na tu
mjeru i razlio preko popisa. Sada se zove `gtece`.

## Postavke se pamte po pregledniku

Srca, vlastiti popisi, glasnoća i zadnja pjesma stoje u `localStorage`, pod
`lucijanka.glazba.*`. Ključevi nose staro ime namjerno, da se ništa ne izgubi.

Pamte se **po adresi**, pa su ovdje (`localhost:5176`) odvojeni od onih u Lucijankici
(`localhost:5174`): srca i popisi složeni ondje ne vide se ovdje, i obrnuto.

## Namjenska aplikacija

Lucify se gradi i kao program za Windows, Electronom. Iza toga ne stoji nikakav drugi
Lucify: isti izvor, isti svirač, isti preuzimač.

```bash
npm run namjenska   # otvori program iz izvora
npm run pakiraj     # složi instalaciju i prijenosni program
```

U `izdanje/` izađu dvije datoteke, obje oko sto megabajta, jer nose cijeli preglednik i
ffmpeg:

- `Lucify-1.0.0-instalacija.exe` — instalacija, uz prečac i mogućnost biranja mape
- `Lucify-1.0.0-prijenosni.exe` — isti program, bez instaliranja

**Preuzimanje pjesama ovdje radi i u gotovom programu**, za razliku od objavljene
stranice. Razlog je jednostavan: ffmpeg dolazi zapakiran uz program, a prozor iza sebe ima
poslužitelj, dok objavljena stranica nema ništa od toga. yt-dlp se i dalje instalira
zasebno, Pythonom, jer se mijenja onoliko često koliko YouTube mijenja svirač:

```bash
python -m pip install --upgrade yt-dlp
```

Tko ga ne želi na putanji, može ga staviti u `alati/` unutar mape zbirke.

### Gdje zbirka stoji

Program ide u `Program Files`, kamo se ne piše, pa zbirka ondje **ne stoji uz njega**,
nego u `Glazba\Lucify\` u korisnikovoj mapi. Tako preživi nadogradnju.

Mapa se otvara i mijenja iz jelovnika, pod **Lucify**. Promjena mape zatvori i iznova
otvori program, jer poslužitelj mapu pročita jednom, pri pokretanju: bolje to nego pola
stanja na jednoj, pola na drugoj mapi. Mapa se može zadati i izvana, kroz `LUCIFY_ZBIRKA`.

Dok se radi na Lucifyju (`npm run namjenska`) zbirka je ona iz projekta, ista koju vidi i
`npm run dev`.

### Što je ovdje drukčije nego na stranici

Prozor otvara **stranicu s vlastitoga poslužitelja**, a ne `dist/index.html` s `file://`.
To nije ukras: s `file://` preglednik ne može zatražiti dio datoteke (`Range`), pa se u
pjesmi ne bi dalo skočiti na sredinu, a `fetch`, kojim se dohvaća popis, ondje uopće ne
radi. Poslužitelj sluša samo na `127.0.0.1`, na luci koju mu dodijeli sustav.

Build se zato slaže s `--mode namjenska`, i to je jedina razlika u izvoru: po toj se
oznaci uključuje preuzimač, a savjeti o `npm` naredbama u praznoj zbirci zamjenjuju se
onima o mapi i jelovniku.

### Ako pakiranje pukne na `winCodeSign`

Na Windowsima bez „Developer Mode” graditelj ne uspije raspakirati svoj alat za
potpisivanje, jer u njemu stoje macOS simboličke veze, a za njih treba pravo koje običan
račun nema. Poruka govori o `Cannot create symbolic link`. Lijek je raspakirati ga jednom
ručno, bez `-snld`, pa graditelj poslije nađe gotovo:

```bash
C=$LOCALAPPDATA/electron-builder/Cache/winCodeSign
node_modules/7zip-bin/win/x64/7za.exe x -bd -y "$C/winCodeSign-2.6.0.7z" "-o$C/winCodeSign-2.6.0"
```

Dvije greške o `.dylib` vezama ostaju i ondje, i to je u redu: one su za macOS, a ovdje se
gradi za Windows.
