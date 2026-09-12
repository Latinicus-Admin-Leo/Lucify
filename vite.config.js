import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { zbirkaNaRazvoju } from "./scripts/posluga.mjs";
import { preuzimacNaRazvoju } from "./scripts/preuzimac.mjs";

/**
 * Gdje objavljeni Lucify stoji na poslužitelju.
 *
 * Na GitHub Pagesu spremište koje nije `ime.github.io` ne dobiva korijen nego
 * podmapu, ovdje `/Lucify/`. Zato adrese ne smiju biti apsolutne: `/assets/…`
 * ondje pokazuje na sam korijen domene, mimo aplikacije.
 *
 * Zadano ostaje `/`, jer i razvojni poslužitelj i namjenska aplikacija stoje
 * na korijenu; podmapu upisuje samo radni tijek koji objavljuje stranicu, kroz
 * `LUCIFY_PODMAPA`. Tako se ista postavka slaže na sva tri mjesta, a nigdje ne
 * piše ime spremišta osim ondje gdje se objavljuje.
 */
const podmapa = process.env.LUCIFY_PODMAPA || "/";

/**
 * Objavljeni Lucify je **program na mobitelu**, a ne stranica koja se otvara:
 * doda se na početni zaslon, otvara se bez trake preglednika i radi bez mreže,
 * jer mu zbirka stoji na samom uređaju, u IndexedDB.
 *
 * Sprema se **samo ono što je Lucify sam**, dakle stotinjak kilobajta stranice.
 * Glazba u to ne ulazi: ona ne dolazi mrežom nego iz mape koju čovjek unese, pa
 * je ovdje nema što ni spremati ni dohvaćati.
 *
 * Namjenska aplikacija za Windows ovo **ne dobiva**: ondje iza prozora stoji
 * pravi poslužitelj, sa zbirkom na disku, pa bi uslužni radnik ondje bio
 * posrednik između programa i njegovih vlastitih datoteka.
 *
 * @param {string} mode
 */
function pwa(mode) {
  if (mode === "namjenska") return [];
  return [
    VitePWA({
      /* Nova inačica se uzima sama, bez pitanja: Lucify je jedna stranica bez
         nespremljena posla, pa nema što izgubiti osvježavanjem. */
      registerType: "autoUpdate",
      includeAssets: ["lucify.svg"],
      manifest: {
        name: "Lucify",
        short_name: "Lucify",
        description: "Vlastita zbirka glazbe i svirač uz nju.",
        lang: "hr",
        start_url: podmapa,
        scope: podmapa,
        display: "standalone",
        orientation: "portrait",
        background_color: "#0a0a0b",
        theme_color: "#0a0a0b",
        icons: [
          { src: "lucify-192.png", sizes: "192x192", type: "image/png" },
          { src: "lucify-512.png", sizes: "512x512", type: "image/png" },
          /* Maskirna je zasebna slika, uvučena i na podlozi, jer je Android
             reže u svoj oblik. Obje slaže `npm run ikona`. */
          {
            src: "lucify-maska.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        /* Sama stranica, i ništa osim nje. `poveznice.json` ulazi jer je
           dvadesetak kilobajta, a bez njega bi popis adresa na praznom uređaju
           tražio mrežu. `woff2` ulazi otkad pismo stoji uz Lucify, u `src/pisma/`:
           bez njega bi se ono na uređaju bez mreže tražilo uzalud, pa bi
           program izgledao drukčije nego dan prije. */
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,json,woff2}"],
        navigateFallback: "index.html",
        /* `runtimeCaching` ovdje više nema: stajao je zbog pisma s Googleovih
           poslužitelja, a Lucify izvana ne traži više ništa. */
      },
    }),
  ];
}

export default defineConfig(({ mode }) => ({
  base: podmapa,
  /* Oba dodatka žive samo na `npm run dev`, a mapa projekta im se predaje
     odavde, jer se ove postavke prije pokretanja spoje u privremenu datoteku,
     pa se iznutra ne da izračunati gdje projekt stoji.

     Isti su rukovatelji i u namjenskoj aplikaciji, gdje ih vrti mali
     poslužitelj iz `electron/posluzitelj.mjs`. Zato su i izvađeni iz ovih
     postavaka: `Range` kod zvuka i red čekanja kod preuzimanja ne smiju
     postojati u dva primjerka. */
  plugins: [
    react(),
    zbirkaNaRazvoju(path.resolve(__dirname)),
    preuzimacNaRazvoju(path.resolve(__dirname)),
    ...pwa(mode),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  /* `open: true`: preglednik se otvara sam na `npm run dev`, kao i u ostalim
     projektima, pa se adresa ne mora upisivati. Namjenska aplikacija ovo ne
     dira: ona otvara svoj prozor. */
  server: { port: 5176, open: !process.env.LUCIFY_NAMJENSKA },
}));
