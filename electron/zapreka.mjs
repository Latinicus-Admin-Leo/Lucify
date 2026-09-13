/**
 * Hoće li Windows uopće pustiti preuzetu nadogradnju.
 *
 * Na Windowsima 11 zna biti uključena **Pametna kontrola aplikacija** (Smart App
 * Control). Ona ne pušta program koji nema digitalnog potpisa ni Microsoftova
 * ugleda, a Lucifyjeva instalacija potpisa nema. Nadograditelj za to ne zna:
 * instalaciju pokuša pokrenuti, Windows je odbije (greška 4551), pa je pokuša
 * još jednom s pravima administratora, na što iskoči pitanje „dopustiti
 * promjene?”, i Windows je odbije opet. Lucify ostane star, pri sljedećem
 * otvaranju nadogradnja se nađe iznova, i tako u krug.
 *
 * Zato se prije toga pita ovdje. Datoteka ne uvozi ništa iz Electrona, pa se
 * dade provjeriti i običnim Nodeom.
 */

import { execFile } from "node:child_process";

/** @param {string} cmd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function pokreni(cmd, args, env) {
  return new Promise((vrati) => {
    execFile(cmd, args, { timeout: 15000, windowsHide: true, env: env || process.env }, (greska, izlaz) => {
      vrati(greska ? "" : String(izlaz || ""));
    });
  });
}

/** Je li Pametna kontrola aplikacija uključena, a ne samo u procjeni ili isključena. */
export async function pametnaKontrolaUkljucena() {
  if (process.platform !== "win32") return false;
  const izlaz = await pokreni("reg", [
    "query",
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy",
    "/v",
    "VerifiedAndReputablePolicyState",
  ]);
  /* 0 je isključeno, 1 uključeno, 2 procjena, u kojoj Windows još ništa ne brani. */
  return /VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x1\b/i.test(izlaz);
}

/**
 * Ima li datoteka valjan potpis. Putanja ide kroz okolinu, a ne u naredbu, pa
 * ništa u imenu datoteke ne može postati dio naredbe.
 *
 * @param {string} put
 */
export async function potpisana(put) {
  const izlaz = await pokreni(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "(Get-AuthenticodeSignature -LiteralPath $env:LUCIFY_PUT).Status"],
    { ...process.env, LUCIFY_PUT: put },
  );
  return izlaz.trim() === "Valid";
}

/**
 * Brani li Windows pokretanje ove instalacije.
 *
 * @param {string} put preuzeta instalacija
 */
export async function windowsBrani(put) {
  if (!(await pametnaKontrolaUkljucena())) return false;
  return !(await potpisana(put));
}
