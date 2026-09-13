package hr.lucify.svirac;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import kotlin.Unit;

/**
 * Preuzimač u samom mobitelu: yt-dlp, Python i ffmpeg iz knjižnice
 * youtubedl-android, iste koju nosi i aplikacija Seal.
 *
 * Ovdje se samo pokreću programi. Red čekanja, stanja poslova i upis u zbirku
 * drži `src/glazba-preuzimac-android.mjs`, isto kao što na računalu to drži
 * `scripts/preuzimac.mjs`, a programe pokreće `scripts/preuzimac-posao.mjs`.
 *
 * Sav posao ide na **vlastite** niti. Capacitor sve dodatke poslužuje jednom
 * jedinom niti, pa bi preuzimanje od dvije minute na njoj zaustavilo i tipke u
 * obavijesti svirača, i svaki drugi poziv iz Lucifyja.
 */
@CapacitorPlugin(name = "LucifyPreuzimac")
public class LucifyPreuzimacPlugin extends Plugin {

    private static final String TAG = "LucifyPreuzimac";

    private final ExecutorService niti = Executors.newCachedThreadPool();
    /** Raspakiravanje Pythona i ffmpega pri prvom pokretanju traje nekoliko sekunda. */
    private Future<?> priprema;
    /** Inačica yt-dlpa, jednom pročitana. Briše se kad stigne nova. */
    private volatile String inacica;

    /** Poveznica podijeljena prije nego što ju je itko u Lucifyju slušao. */
    private String podijeljeno;

    private static final Pattern POSTO = Pattern.compile("\\[download\\]\\s+(\\d+(?:\\.\\d+)?)%");

    @Override
    public void load() {
        final Context kontekst = getContext().getApplicationContext();
        priprema = niti.submit(() -> {
            try {
                YoutubeDL.getInstance().init(kontekst);
                FFmpeg.getInstance().init(kontekst);
            } catch (Exception e) {
                Log.e(TAG, "yt-dlp se nije dao pripremiti", e);
                throw new RuntimeException(e);
            }
            return null;
        });
        if (getActivity() != null) primiDijeljenje(getActivity().getIntent());
    }

    /** Baca ako priprema nije uspjela, s porukom koja se smije pokazati. */
    private void cekajPripremu() throws Exception {
        try {
            priprema.get();
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable uzrok = e.getCause() != null && e.getCause().getCause() != null ? e.getCause().getCause() : e.getCause();
            throw new Exception("yt-dlp se nije dao pripremiti: " + (uzrok != null ? uzrok.getMessage() : ""));
        }
    }

    private File radnaMapa(String posao) {
        String ime = posao.replaceAll("[^A-Za-z0-9_-]", "");
        return new File(new File(getContext().getCacheDir(), "lucify-preuzimanje"), ime);
    }

    /* ---------- stanje i nov yt-dlp ---------- */

    @PluginMethod
    public void stanje(PluginCall call) {
        niti.submit(() -> {
            try {
                cekajPripremu();
                JSObject o = new JSObject();
                o.put("ytDlp", procitajInacicu());
                call.resolve(o);
            } catch (Exception e) {
                call.reject(poruka(e));
            }
        });
    }

    private String procitajInacicu() throws Exception {
        if (inacica != null) return inacica;
        /* Knjižnica pamti inačicu tek kad sama dohvati novu. Zapakirani yt-dlp
           je zato nema zapisanu, pa se pita on sam. */
        /* `version` je sama oznaka („2026.08.19”); `versionName` ispred nje
           piše još i „yt-dlp”, pa bi se u okviru ispisalo dvaput. */
        String zapamceno = YoutubeDL.getInstance().version(getContext());
        if (zapamceno == null || zapamceno.isEmpty()) {
            YoutubeDLResponse odgovor = YoutubeDL.getInstance().execute(new YoutubeDLRequest("--version"), null, false, null);
            zapamceno = odgovor.getOut().trim();
        }
        inacica = zapamceno;
        return inacica;
    }

    @PluginMethod
    public void osvjezi(PluginCall call) {
        niti.submit(() -> {
            try {
                cekajPripremu();
                YoutubeDL.getInstance().updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel._STABLE);
                inacica = null;
                JSObject o = new JSObject();
                o.put("inacica", procitajInacicu());
                call.resolve(o);
            } catch (Exception e) {
                call.reject(poruka(e));
            }
        });
    }

    /* ---------- jedna snimka ---------- */

    /** Podatci o snimci, bez ijednog preuzetog bajta. Isto kao `podatci()` na računalu. */
    @PluginMethod
    public void podatci(PluginCall call) {
        final String adresa = call.getString("adresa", "");
        niti.submit(() -> {
            try {
                cekajPripremu();
                /* Adresa ide kao zadnji argument, nikad kao dio opcije. */
                YoutubeDLRequest zahtjev = new YoutubeDLRequest(adresa)
                    .addOption("--dump-single-json")
                    .addOption("--no-playlist")
                    .addOption("--no-progress")
                    .addOption("--no-warnings")
                    .addOption("--skip-download");
                YoutubeDLResponse odgovor = YoutubeDL.getInstance().execute(zahtjev, null, false, null);
                JSObject o = new JSObject();
                o.put("json", odgovor.getOut());
                call.resolve(o);
            } catch (Exception e) {
                call.reject(poruka(e));
            }
        });
    }

    /**
     * Zvuk u mp3, u radnu mapu posla, uz omot. Za razliku od računala ovdje
     * pretvara sam yt-dlp (`-x`), pozivom istoga ffmpega, pa nema drugoga
     * programa koji bi trebalo naći.
     *
     * Kakvoće su iste kao `KAKVOCE` u `scripts/preuzimac-posao.mjs`: ondje je
     * broj `-q:a`, a `--audio-quality` je taj isti broj.
     */
    @PluginMethod
    public void preuzmi(PluginCall call) {
        final String posao = call.getString("posao", "");
        final String adresa = call.getString("adresa", "");
        final String oznaka = call.getString("oznaka", "");
        final String kakvoca = call.getString("kakvoca", "visoka");
        niti.submit(() -> {
            File mapa = radnaMapa(posao);
            try {
                cekajPripremu();
                if (posao.isEmpty()) throw new Exception("Posao nema oznake.");
                mapa.mkdirs();

                String kolicina;
                switch (kakvoca) {
                    case "mala": kolicina = "6"; break;
                    case "srednja": kolicina = "4"; break;
                    case "najveca": kolicina = "320K"; break;
                    default: kolicina = "2";
                }

                YoutubeDLRequest zahtjev = new YoutubeDLRequest(adresa)
                    .addOption("--no-playlist")
                    .addOption("--no-part")
                    .addOption("--no-mtime")
                    .addOption("--newline")
                    .addOption("--no-warnings")
                    .addOption("--format", "bestaudio/best")
                    .addOption("--extract-audio")
                    .addOption("--audio-format", "mp3")
                    .addOption("--audio-quality", kolicina)
                    /* Oznake kao na računalu: naslov, kanal kao izvođač i
                       adresa u komentaru, iz koje se čita oznaka snimke. */
                    .addOption("--embed-metadata")
                    .addOption("--parse-metadata", "%(uploader,channel)s:%(meta_artist)s")
                    .addOption("--parse-metadata", "webpage_url:%(meta_comment)s")
                    .addOption("--postprocessor-args", "ExtractAudio+ffmpeg_o:-id3v2_version 3 -write_id3v1 1")
                    .addOption("--postprocessor-args", "Metadata+ffmpeg_o:-id3v2_version 3 -write_id3v1 1")
                    .addOption("--output", new File(mapa, "izvor.%(ext)s").getAbsolutePath());

                YoutubeDL.getInstance().execute(zahtjev, posao, false, (posto, eta, redak) -> {
                    javiNapredak(posao, redak);
                    return Unit.INSTANCE;
                });

                File mp3 = null;
                File[] datoteke = mapa.listFiles();
                if (datoteke != null) {
                    for (File f : datoteke) {
                        if (f.getName().startsWith("izvor.") && f.getName().endsWith(".mp3")) mp3 = f;
                    }
                }
                if (mp3 == null) throw new Exception("Preuzimanje je završilo, a datoteke nema.");

                File omot = dohvatiOmot(oznaka, mapa);

                JSObject o = new JSObject();
                o.put("mp3", mp3.getAbsolutePath());
                o.put("omot", omot != null ? omot.getAbsolutePath() : "");
                call.resolve(o);
            } catch (YoutubeDL.CanceledException e) {
                call.reject("Prekinuto.", "PREKINUTO");
            } catch (Exception e) {
                call.reject(poruka(e));
            }
        });
    }

    /** Postotak preuzimanja i trenutak kad počne pretvorba. */
    private void javiNapredak(String posao, String redak) {
        if (redak == null) return;
        JSObject n = new JSObject();
        n.put("posao", posao);
        if (redak.startsWith("[ExtractAudio]")) {
            n.put("faza", "pretvaram");
            notifyListeners("napredak", n);
            return;
        }
        Matcher m = POSTO.matcher(redak);
        if (m.find()) {
            n.put("faza", "preuzimam");
            n.put("posto", Double.parseDouble(m.group(1)));
            notifyListeners("napredak", n);
        }
    }

    /**
     * Sličica s YouTubea, istim redom kao `omot()` u
     * `scripts/glazba-zbirka.mjs`. Bez nje Lucify crta slovo, pa neuspjeh
     * nije kvar.
     */
    private File dohvatiOmot(String oznaka, File mapa) {
        if (!oznaka.matches("[A-Za-z0-9_-]{11}")) return null;
        File cilj = new File(mapa, "omot.jpg");
        for (String vrsta : new String[] {"maxresdefault", "hqdefault", "mqdefault"}) {
            HttpURLConnection veza = null;
            try {
                veza = (HttpURLConnection) new URL("https://i.ytimg.com/vi/" + oznaka + "/" + vrsta + ".jpg").openConnection();
                veza.setConnectTimeout(10000);
                veza.setReadTimeout(15000);
                if (veza.getResponseCode() != 200) continue;
                try (InputStream ulaz = veza.getInputStream(); OutputStream izlaz = new FileOutputStream(cilj)) {
                    byte[] komad = new byte[16384];
                    int n;
                    while ((n = ulaz.read(komad)) != -1) izlaz.write(komad, 0, n);
                }
                if (cilj.length() > 1000) return cilj;
            } catch (Exception e) {
                /* bez mreže se jednostavno ostaje bez omota */
            } finally {
                if (veza != null) veza.disconnect();
            }
        }
        cilj.delete();
        return null;
    }

    @PluginMethod
    public void odustani(PluginCall call) {
        YoutubeDL.getInstance().destroyProcessById(call.getString("posao", ""));
        call.resolve();
    }

    /** Radna mapa posla van, kad je Lucify svoje već pročitao. */
    @PluginMethod
    public void pospremi(PluginCall call) {
        final File mapa = radnaMapa(call.getString("posao", ""));
        niti.submit(() -> {
            obrisi(mapa);
            call.resolve();
        });
    }

    private static void obrisi(File f) {
        File[] djeca = f.listFiles();
        if (djeca != null) for (File d : djeca) obrisi(d);
        f.delete();
    }

    /* ---------- dijeljenje iz druge aplikacije ---------- */

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        primiDijeljenje(intent);
    }

    /**
     * „Dijeli” → Lucify, iz YouTubea ili preglednika. Ako Lucify već sluša,
     * poveznica mu ide odmah; ako je dijeljenje tek otvorilo aplikaciju, čeka
     * dok je ne pokupi `uzmiPodijeljeno`.
     */
    private synchronized void primiDijeljenje(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String tekst = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (tekst == null || tekst.trim().isEmpty()) return;
        /* Isti se intent inače pročita opet pri svakom novom stvaranju. */
        intent.setAction(Intent.ACTION_MAIN);
        if (hasListeners("podijeljeno")) {
            JSObject o = new JSObject();
            o.put("tekst", tekst.trim());
            notifyListeners("podijeljeno", o);
        } else {
            podijeljeno = tekst.trim();
        }
    }

    @PluginMethod
    public synchronized void uzmiPodijeljeno(PluginCall call) {
        JSObject o = new JSObject();
        o.put("tekst", podijeljeno != null ? podijeljeno : "");
        podijeljeno = null;
        call.resolve(o);
    }

    /* ---------- greške ---------- */

    /**
     * yt-dlpov ispis ide u Lucify cijel, jer ga ondje čitaju ista pravila kao
     * na računalu (`src/glazba-greske.mjs`). Ovdje se samo skraćuje.
     */
    private static String poruka(Exception e) {
        String p = e.getMessage();
        if (p == null || p.isEmpty()) p = e.getClass().getSimpleName();
        return p.length() > 4000 ? p.substring(p.length() - 4000) : p;
    }
}
