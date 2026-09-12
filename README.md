# Lucify

Vlastita zbirka glazbe i svirač uz nju. Zbirka stoji na disku, popis se čita iz samih
snimaka, a nove pjesme ulaze poveznicom s YouTubea, iz samoga Lucifyja.

Prije je ovo bio alat unutar školske mape **Lucijankice** i ondje je imao tipku „Natrag na
bilješke”. Ondje se zvao **Slušaonica**; ovdje je sam sebi stranica i zove se Lucify. Sve
ostalo je isto.

Živi na tri načina: kao stranica na razvojnom poslužitelju, kao **namjenska aplikacija za
Windows**, koja se instalira i otvara kao svaki drugi program, i kao **program na
mobitelu**, koji se doda na početni zaslon i nosi zbirku u samom uređaju. Prvo je opisano
[na dnu](#namjenska-aplikacija), a drugo [malo iznad](#lucify-na-mobitelu).

Znak stoji u `public/lucify.svg`, i to je jedini primjerak koji se mijenja: iz njega
`npm run ikona` napravi `build/icon.png`, iz koje graditelj složi ikonu programa, i
`public/lucify-*.png` za prečac na početnom zaslonu mobitela.
Isti je znak još jednom ispisan u `src/Znak.jsx`, jer se u gornjoj traci crta ugrađen, pa
ga treba mijenjati zajedno s datotekom.

Pismo stoji uz njega, u `public/pisma/`, i ne dolazi izvana. Prije je dolazilo s
Googleovih poslužitelja, i to je bila jedina stvar koju je Lucify ikad tražio s mreže.
Na mobitelu se nije vidjelo, jer ga je uslužni radnik spremio pri prvom otvaranju, ali u
namjenskoj aplikaciji uslužnoga radnika nema, pa je ona bez mreže na pismo čekala,
odustala i ispisala se sustavskim. Sada Lucify izvana ne traži ništa: jedino što ikad
ide na mrežu jest poveznica koju se samo zalijepi.

Uzeta je samo debljina 400, jer se `IBM Plex Mono` javlja na dva mjesta i ni na jednom se
ne podeblja: u retku s inačicama alata (`.gdalati`) i u polju za poveznice (`.gppolje`).
Podskupa su dva, `latin` i `latin-ext`, zajedno dvadeset osam kilobajta, a `unicode-range`
na vrhu `glazba.css` govori pregledniku koji mu treba: `latin-ext` dohvati tek kad
zatreba kvačica. Naslovi pjesama, u kojima ima i ćirilice i japanskoga, idu sustavskim
pismom i ovo ih ne dira.

## Iz jedne mape, dvoklikom

Na računalu na kojem nema ničega — ni Nodea, ni gita, ni Pythona — dovoljno je prenijeti
ovu mapu i dvokliknuti **`pokreni.cmd`**. Nađe Node ili ga dohvati, povuče ovisnosti,
dohvati yt-dlp, složi program i pokrene instalaciju. Poslije toga Lucify stoji kao svaki
drugi program i ova mapa mu više ne treba.

```cmd
pokreni.cmd                 dohvati što treba, složi program, instaliraj
pokreni.cmd --samo-gradi    stani nakon `izdanje\`, bez instaliranja
pokreni.cmd --osvjezi       dohvati Node i yt-dlp iznova, pa i ako stoje
```

Batch datoteka ne radi ništa osim što zove `scripts/pokreni.ps1`, gdje je sav posao.
Razlog je i jedan i drugi put isti: PowerShell na Windowsima stoji uvijek, pa se njime
smije dohvatiti Node, a `.ps1` se ne da dvokliknuti, jer bi pao na pravilima izvođenja.
Zato `.cmd` sprijeda.

Node koji se dohvati je **prijenosni** i ostaje u `alati/node`: ništa se ne upisuje u
sustav i ništa se ne mijenja onome tko Node već ima. Uzima se zadnji iz grane 22, a ime i
kontrolni zbroj dolaze iz `SHASUMS256.txt`, pa se točna inačica nigdje ne upisuje i krnje
preuzimanje pukne odmah, a ne tek na `npm install`. Tko Node već ima, i to 20 ili noviji,
dobiva svoj — ništa se ne preuzima.

Za ovo jedanput treba mreža. Sve poslije radi bez nje.

```bash
npm install        # ovisnosti, uz njih i ffmpeg
npm run dev        # razvojni poslužitelj (port 5176)
npm run glazba     # iznova pročita zbirku
npm run izvezi     # zbirka za mobitel, s naslovima i omotima
npm run build      # produkcijski build
npm run lint       # eslint . --quiet
npm run typecheck  # tsc prema jsconfig (checkJs)

npm run namjenska  # namjenska aplikacija, iz izvora, bez pakiranja
npm run pakiraj    # instalacija i prijenosni program u `izdanje/`
npm run objavi     # isto, pa uz to i izdanje na GitHub (treba GH_TOKEN)
npm run ikona      # public/lucify.svg -> build/icon.png
npm run alati      # dohvati yt-dlp u `alati/` (pakiraj to radi sam)
npm run potpisivac # raspakiraj winCodeSign (pakiraj to radi sam)
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

Radi ondje gdje iza Lucifyja stoji poslužitelj: na `npm run dev` i u namjenskoj
aplikaciji. Na mobitelu ne radi, jer ondje nema ni yt-dlpa ni ffmpega; tamo zbirka
dolazi gotova, izvozom.

- **ffmpeg** dolazi kroz `npm install`, kao neobavezna ovisnost (`ffmpeg-static`).
- **yt-dlp dolazi kroz `npm run alati`**, koji dohvati zadnje izdanje u mapu `alati/`.
  `npm run pakiraj` to radi sam, prije svega ostaloga, pa ga gotov program nosi sa sobom.
  U povijesti ga nema: tuđi je program i izlazi gotovo svaki tjedan.

  ```bash
  npm run alati              # dohvati ako ga nema
  npm run alati -- --osvjezi # dohvati iznova, pa i ako već stoji
  ```

  Druga je naredba i popravak kad YouTube promijeni svirač, a preuzimanja počnu padati.

Preuzimač traži yt-dlp redom, u `nadiYtDlp()`: `YTDLP_PATH`, pa `alati/` u mapi zbirke,
pa putanja, pa Python (`python -m yt_dlp`, `python3`, `py -3`). Python je, dakle, ostao
kao zadnja mogućnost za onoga tko ga već ima tako, a ne više put kojim yt-dlp dolazi.

**Preuzima se samo ono na što se ima pravo.** Alat to ne može provjeriti i ne pokušava:
odluka je na onome tko lijepi poveznicu.

### Zbirka na mobitelu, u tuđem sviraču

```bash
npm run izvezi                     # u „Lucify za mobitel/” uz projekt
npm run izvezi -- "D:/Glazba"      # ili u zadanu mapu
```

Sam Lucify na mobitel ne ide: `.exe` je za Windows, a stranica bez poslužitelja iza
sebe ne može ni dohvatiti popis ni skočiti na sredinu pjesme. Ide zbirka, a svira je
svirač koji na mobitelu ionako već stoji.

Mapu `Glazba/Zvuk/` ne valja kopirati ravno na mobitel, i to zbog oznaka: datoteka u
zbirci nosi **sirovi** naslov s YouTubea, jer joj ga ondje upiše preuzimač. Očišćeni
naslov i pravi izvođač nastaju tek pri čitanju zbirke, u `rastavi()`, i žive samo u
`popis.json`, a njega Lucify čita, dok ga svirač na mobitelu ne čita. Ondje bi zato
pisalo „Britney Spears - ...Baby One More Time (Official Video)”, a kao izvođač ime
kanala koji je snimku prenio.

`npm run izvezi` zbirku zato prepisuje van s onim što Lucify pokazuje upisanim u same
datoteke: naslov i izvođač u oznaci, omot iz `omoti/` ugrađen u snimku, naslov i u
imenu datoteke. Zvuk se pritom **ne pretvara iznova** (`-c copy`), pa je izvoz bajt po
bajt istovjetan izvorniku i gotov u nekoliko sekunda.

Srca i vlastiti popisi ne putuju s njima: oni stoje u `localStorage`, po pregledniku i
po adresi.

## Što je gdje

| Datoteka | Što drži |
|---|---|
| `src/Glazba.jsx` | sam Lucify: popis, police, pretraga, ploča „Sad svira” |
| `src/glazba-svirac.mjs` | zvuk, red čekanja, glasnoća, ponavljanje, mjerač vremena |
| `src/GlazbaDodaj.jsx` | okvir za dodavanje pjesme poveznicom |
| `src/glazba-veze.mjs` | čitanje YouTube poveznica, isto za preglednik i za poslužitelj |
| `src/GlazbaUvoz.jsx` | okvir „Zbirka”: mapa s računala u zbirku uređaja |
| `src/glazba-izvor.mjs` | odakle snimka dolazi: poslužitelj ili sam uređaj |
| `src/glazba-spremiste.mjs` | zbirka u IndexedDB, na objavljenom Lucifyju |
| `src/glazba.css` | sav izgled |
| `src/Znak.jsx` | znak, ugrađen, za gornju traku |
| `public/pisma/` | IBM Plex Mono, uz licenciju: pismo ne dolazi s mreže |
| `scripts/glazba.mjs` | `npm run glazba`: selidba snimaka u zbirku |
| `scripts/glazba-zbirka.mjs` | čitanje snimke i slaganje popisa |
| `scripts/izvezi.mjs` | `npm run izvezi`: zbirka van, za svirač na mobitelu |
| `scripts/posluga.mjs` | posluživanje zbirke s `/glazba/`, uz `Range` |
| `scripts/preuzimac*.mjs` | poslovi preuzimanja, red čekanja, yt-dlp i ffmpeg |
| `scripts/ikona.mjs` | `npm run ikona`: znak u ikonu programa |
| `scripts/alati.mjs` | `npm run alati`: yt-dlp u `alati/`, uz build |
| `scripts/potpisivac.mjs` | `npm run potpisivac`: winCodeSign bez `-snld` |
| `pokreni.cmd` | dvoklik na praznom računalu: zove `scripts/pokreni.ps1` |
| `scripts/pokreni.ps1` | Node, ovisnosti, yt-dlp, gradnja, instalacija |
| `electron/glavni.mjs` | namjenska aplikacija: prozor, jelovnik, mapa zbirke |
| `electron/posluzitelj.mjs` | njezin poslužitelj: zbirka, preuzimač, gotov build |

**Svirač stoji izvan Reacta**, u modulskom stanju `glazba-svirac.mjs`, a prikaz ga čita
kroz `useSyncExternalStore`. To nije ukras: ono što ne smije preživjeti ponovni prikaz ne
stavlja se u prikaz.

**Nazivi razreda u CSS-u počinju slovom `g`.** Prije novoga naziva vrijedi `grep`, jer se
`glazba.css` zna sudariti sam sa sobom: razred za redak koji svira jednom je nazvan
`gsvira`, a to je već bio okrugli gumb od trideset četiri točke, pa se redak stisnuo na tu
mjeru i razlio preko popisa. Sada se zove `gtece`.

## Lucify na mobitelu

Objavljeni Lucify nije stranica koja se otvara nego **program koji se doda na početni
zaslon**: otvara se bez trake preglednika, ima svoju ikonu i radi bez mreže. Zbirku
pritom nosi **sam uređaj**, u IndexedDB, pa ne treba ni upaljeno računalo.

Zato ondje, umjesto tipke **Dodaj pjesmu**, u gornjoj traci stoji **Zbirka**. Put je
uvijek isti:

1. na računalu `npm run izvezi`, pa se dobivena mapa prenese na mobitel,
2. u Lucifyju na mobitelu **Zbirka → Odaberi mapu**,
3. dodati Lucify na početni zaslon.

Treći korak nije ukras. Preglednik smije počistiti spremište stranice koja se dugo nije
otvarala, a šesto megabajta je prvo na redu; prečacu na početnom zaslonu to se ne
događa. Okvir **Zbirka** kaže je li zbirka već proglašena trajnom.

Mapa se bira odjednom samo ondje gdje preglednik zna za mape, dakle na računalu i u
Chromeu na Androidu. **iOS za mape ne zna**, pa se ondje uzima „Odaberi datoteke” i u
Datotekama označi sve što je u mapi. Uvoz **dodaje, a ne zamjenjuje**, pa se smije
obaviti i u nekoliko navrata; pjesma koja je već ovdje preskače se.

`popis.json` iz te mape mora doći s prvim odabirom: iz njega dolaze očišćeni naslovi,
izvođači i police. Snimka bez njega nema uza se ništa osim imena datoteke.

### Zbirka uređaja zna i smršavjeti

Kad uvoz samo dodaje, zbirka uređaja jedino raste: pjesma izbačena na računalu ostaje
ovdje i poslije novoga izvoza. Ne vidi je se, jer je nema u popisu, ali mjesto drži, a
jedini je lijek dosad bio obrisati sve i prenositi zbirku iznova.

Okvir **Zbirka** takve sada prebroji, izmjeri koliko zauzimaju i ponudi **Počisti**.
Briše se točno ono čega u popisu nema, snimke i omoti zajedno, i ništa mimo toga; sam
popis se ne dira, jer je već onakav kakav treba biti.

Višak se traži **prema popisu**, a ne prema onome što je maloprije odabrano, i u tome je
sav oprez: na iPhoneu datoteke stižu u nekoliko navrata, dok je `popis.json` cijel već iz
prvoga odabira. Kad bi se višak računao iz odabira, drugi bi uvoz pobrisao sve što je
donio prvi.

**Preuzimanja ondje nema**, kao ni prije: iza objavljene stranice ne stoje ni yt-dlp ni
ffmpeg. Nove pjesme ulaze na računalu, pa se izvoz ponovi.

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
stranice. Razlog je jednostavan: oba alata dolaze zapakirana uz program, a prozor iza sebe
ima poslužitelj, dok objavljena stranica nema ništa od toga. Ništa se ne doinstalira i
Python ne treba.

ffmpeg ulazi kroz `ffmpeg-static`, a yt-dlp kroz mapu `alati/`, koju `npm run pakiraj`
napuni prije nego što išta složi. Obojicu graditelj drži izvan `app.asar` (`asarUnpack`),
jer se program koji se pokreće ne da pokrenuti iz arhive. Put do yt-dlpa program pri
pokretanju upiše u `YTDLP_PATH`, a to je prvo što preuzimač pogleda, pa se zapakirani
primjerak i onaj iz `npm run alati` ne mogu razići.

Kad YouTube promijeni svirač, a preuzimanja počnu padati, treba noviji yt-dlp: u izvoru
`npm run alati -- --osvjezi` pa iznova `npm run pakiraj`. Tko ga ima na putanji ili
Pythonom, može ga i tako podmetnuti — preuzimač gleda i ondje, samo poslije.

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

Build se zato slaže s `--mode namjenska`, i po toj se oznaci u izvoru razlikuje troje:
uključuje se preuzimač, savjeti o `npm` naredbama u praznoj zbirci zamjenjuju se onima o
mapi i jelovniku, a gornja traka preuzima posao naslovne trake prozora.

### Prozor bez sustavske naslovne trake

Iznad Lucifyja nema ni sustavske naslovne trake ni retka s jelovnikom: gornja traka ide
sve do vrha, a gumbe prozora (—, ▢, ✕) Windows crta preko njezina desnog ugla i u njezinim
bojama (`titleBarStyle: "hidden"` uz `titleBarOverlay`). Crta ih i dalje sustav, pa uz
njih ostaje i sve što uz njih ide: razvlačenje prijelazom u gornji rub i izbornik
razmještaja koji se pod mišem otvori nad ▢.

Traka zato mora raditi i ono što je naslovna radila prije nje: za nju se prozor hvata i
vuče (`-webkit-app-region: drag`), a sve što se u njoj pritišće mora biti izuzeto, jer bi
inače pritisak otišao prozoru umjesto gumbu. Koliko desno ustupi gumbima, ne pogađa se
nego dolazi iz `env(titlebar-area-width)`; visina joj je u `electron/glavni.mjs` upisana
kao `VISINA_TRAKE` i mora ostati ista kao `.gvrh` u `glazba.css`, pa se mijenjaju zajedno.

Jelovnik time ostaje bez svojega retka i seli se pod Alt, a mapa zbirke drugih vrata nema.
Zato u traci stoji **⋯**, odmah do znaka: pritisak ode `fetch`om na vlastiti poslužitelj,
a prozor na to otvori isti onaj sustavski jelovnik. Stranici se ni zbog ovoga nije morao
otvoriti Node.

### `winCodeSign` se raspakirava sam

U alatu za potpisivanje, koji graditelj dohvaća prije pakiranja, stoje dvije macOS
simboličke veze. Graditelj ga raspakirava sa `7za x -snld`, a ta zastavica traži da veze
ostanu veze; za pravljenje veze na Windowsima treba pravo koje običan račun nema, osim uz
„Developer Mode”. 7za zato izađe s greškom o `Cannot create symbolic link`, graditelj to
shvati kao neuspjeh i pokuša iznova — četiri puta, svaki put iznova preuzevši istih pet i
pol megabajta i ostavivši za sobom mapu do pola raspakiranu.

To sada radi `npm run potpisivac`, koji `pakiraj` i `objavi` pokreću sami: istu arhivu
raspakira **bez** `-snld`, pa 7za veze zapiše kao obične datoteke. Ovdje je to svejedno,
jer su za macOS, a gradi se za Windows. Graditelj poslije nađe gotovu mapu i ne dira
ništa. Usput pospremi i ostatke prijašnjih neuspjelih pokušaja.

Ako mapa već stoji, ne radi se ništa, pa pokretanje uz svaki `pakiraj` ništa ne stoji.
Ako pak ne uspije, ne prekida gradnju nego je prepušta graditelju — dakle isto što je
bilo i prije, ni gore.
