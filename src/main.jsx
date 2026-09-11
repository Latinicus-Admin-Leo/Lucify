/*
 * Lucify kao vlastiti projekt. Prije je bio alat unutar Lucijankice, pa
 * je imao tipku „Natrag na bilješke”; ovdje nema kamo voditi, jer je on sve
 * što ova stranica prikazuje. Ostalo je isto: ista zbirka, isti svirač, isti
 * preuzimač.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import Glazba from "./Glazba.jsx";

/* Lucify je `position: fixed; inset: 0`, dakle sam popuni zaslon. Podloga
   je ovdje svejedno zadana, jer bi se inače pri odskoku (`overscroll`) na
   rubovima vidjela bijela boja preglednika. */
document.body.style.margin = "0";
document.body.style.background = "#0a0a0b";

const el = document.getElementById("root");
if (el) createRoot(el).render(<React.StrictMode><Glazba /></React.StrictMode>);
