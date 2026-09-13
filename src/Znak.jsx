/*
 * Znak Lucifyja: tri luka u krugu, sve kraći prema dnu. Stoji ovdje kao
 * ugrađeni SVG, a ne kao `<img>` na `public/lucify.svg`, jer se u gornjoj traci
 * crta pri svakom prikazu: ugrađen ne traži ništa izvana i ne trepne dok se
 * dohvaća. Istu sliku ipak treba i kao datoteku u `public/lucify.svg`, jer je
 * preglednik traži za karticu, a graditelj namjenske aplikacije za ikonu
 * programa. Promijeni li se jedno, mora se promijeniti i drugo.
 *
 * @param {{ mjera?: number }} props
 */
export default function Znak({ mjera = 22 }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={mjera}
      height={mjera}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <circle cx="256" cy="256" r="232" fill="#b83a1b" />
      <g fill="none" stroke="#f5a45c" strokeLinecap="round">
        <path d="M110.8 189.3Q262.4 132 414 221.7" strokeWidth="39.7" />
        <path d="M124.5 260.6Q255.5 209 386.6 287.1" strokeWidth="36.5" />
        <path d="M136.8 328.2Q247.3 285.7 358.3 345.5" strokeWidth="32.9" />
      </g>
    </svg>
  );
}
