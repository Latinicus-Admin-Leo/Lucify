/**
 * Aplikacija za Android, od gotove stranice do APK-a.
 *
 * Ovo je zadnji korak naredbe `npm run apk`. Prije njega `npm run android`
 * složi stranicu u `dist-android/` i prepiše je u `android/`, a ovdje Gradle od
 * toga složi APK i stavi ga u `izdanje/`, uz program za Windows.
 *
 * Gradle treba dvoje što nije u projektu: Javu 21 i Android SDK. Na GitHubu oboje
 * već stoji na računalu i zna se po `JAVA_HOME` i `ANDROID_HOME`. Na ovom
 * računalu stoje u `%LOCALAPPDATA%`, bez instalacije, pa se ondje i traže kad
 * varijabli nema.
 *
 *   npm run apk              potpisano izdanje, ako ključ postoji
 *   npm run apk -- --debug   razvojna inačica, i za emulator
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const korijen = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const razvojna = process.argv.includes("--debug");

/** Prva mapa u `mapa` čije ime počinje s `pocetak`, ili ništa. @param {string} mapa @param {string} pocetak */
function prvaMapa(mapa, pocetak) {
  if (!existsSync(mapa)) return "";
  const ime = readdirSync(mapa)
    .filter((i) => i.startsWith(pocetak))
    .sort()
    .pop();
  return ime ? join(mapa, ime) : "";
}

function okolina() {
  const env = { ...process.env };
  const lokalno = process.env.LOCALAPPDATA || "";
  if (!env.JAVA_HOME && lokalno) {
    const java = prvaMapa(join(lokalno, "Java"), "jdk-21");
    if (java) env.JAVA_HOME = java;
  }
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && lokalno) {
    const sdk = join(lokalno, "Android", "Sdk");
    if (existsSync(sdk)) env.ANDROID_HOME = sdk;
  }
  /* Java 21 na Windowsima i za unutarnje cijevi otvara priključnicu u mapi
     `TEMP`. Kad je ta putanja skraćena („LEOB~1”), spajanje padne s „Unable to
     establish loopback connection” i Gradle se ne digne uopće. Mapa bez
     razmaka i tilde to rješava, a zajednička mapa `Public` ima je na svakom
     računalu. */
  if (windows && env.PUBLIC && !/unixdomain\.tmpdir/.test(env.JAVA_TOOL_OPTIONS || "")) {
    const uds = join(env.PUBLIC, "lucify-uds");
    if (!/[\s~]/.test(uds)) {
      mkdirSync(uds, { recursive: true });
      env.JAVA_TOOL_OPTIONS = ((env.JAVA_TOOL_OPTIONS || "") + " -Djdk.net.unixdomain.tmpdir=" + uds).trim();
    }
  }
  if (!env.JAVA_HOME) {
    console.error("Nema Jave 21. Postavi JAVA_HOME ili je raspakiraj u %LOCALAPPDATA%\\Java.");
    process.exit(1);
  }
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
    console.error("Nema Android SDK-a. Postavi ANDROID_HOME ili ga stavi u %LOCALAPPDATA%\\Android\\Sdk.");
    process.exit(1);
  }
  return env;
}

const inacica = JSON.parse(readFileSync(join(korijen, "package.json"), "utf8")).version;
const zadatak = razvojna ? "assembleDebug" : "assembleRelease";
const mapaAndroida = join(korijen, "android");

/* Na Windowsima se `.bat` pokreće samo kroz ljusku, a ljuska putanju s
   razmakom („Leo B”) reže na dvoje, pa ide pod navodnicima. Argumenti su
   ovdje stalni, pa kroz ljusku ne prolazi ništa izvana. */
const ishod = windows
  ? spawnSync('"' + join(mapaAndroida, "gradlew.bat") + '" ' + zadatak + " --no-daemon", {
      cwd: mapaAndroida,
      env: okolina(),
      stdio: "inherit",
      shell: true,
    })
  : /* Kroz `sh`, jer `gradlew` složen na Windowsima u gitu nema pravo
       izvršavanja, pa ga Linux na GitHubu inače ne bi htio pokrenuti. */
    spawnSync("sh", ["./gradlew", zadatak, "--no-daemon"], { cwd: mapaAndroida, env: okolina(), stdio: "inherit" });
if (ishod.status !== 0) process.exit(ishod.status || 1);

const vrsta = razvojna ? "debug" : "release";
const izlaz = join(mapaAndroida, "app", "build", "outputs", "apk", vrsta);
const apk = readdirSync(izlaz)
  .filter((i) => i.endsWith(".apk"))
  .map((i) => join(izlaz, i))[0];
if (!apk) {
  console.error("Gradle je završio, a APK-a nema u " + izlaz);
  process.exit(1);
}

/* Nepotpisan APK ne da se instalirati, pa ne smije izgledati kao gotov. */
const nepotpisan = apk.endsWith("-unsigned.apk");
const ime = "Lucify-" + inacica + (razvojna ? "-razvojna" : nepotpisan ? "-nepotpisana" : "") + ".apk";
mkdirSync(join(korijen, "izdanje"), { recursive: true });
copyFileSync(apk, join(korijen, "izdanje", ime));
console.log("\nAPK: izdanje/" + ime);
if (nepotpisan) {
  console.log("Nije potpisan, jer nema ključa (android/keystore.properties ili LUCIFY_KEYSTORE).");
}
