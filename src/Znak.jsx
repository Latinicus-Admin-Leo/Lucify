/*
 * Znak Lucifyja: val koji se širi iz donjega lijevog kuta. Stoji ovdje kao
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
      <g fill="none" stroke="#f5a45c" strokeWidth="40" strokeLinecap="round">
        <path d="M264 356A96 96 0 0 0 168 260" />
        <path d="M324 356A156 156 0 0 0 168 200" />
        <path d="M384 356A216 216 0 0 0 168 140" />
      </g>
      <circle cx="168" cy="356" r="26" fill="#f5a45c" />
    </svg>
  );
}
