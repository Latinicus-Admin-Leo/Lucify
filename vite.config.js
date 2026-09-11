import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { zbirkaNaRazvoju } from "./scripts/posluga.mjs";
import { preuzimacNaRazvoju } from "./scripts/preuzimac.mjs";

export default defineConfig({
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
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  /* `open: true`: preglednik se otvara sam na `npm run dev`, kao i u ostalim
     projektima, pa se adresa ne mora upisivati. Namjenska aplikacija ovo ne
     dira: ona otvara svoj prozor. */
  server: { port: 5176, open: !process.env.LUCIFY_NAMJENSKA },
});
