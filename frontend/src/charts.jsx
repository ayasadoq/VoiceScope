const NIVEAUX = [0, -20, -40, -60, -80];

export function LevelChart({ frames, segs, duree, colorOf, silence }) {
  const W = 860, H = 300, L = 48, R = 12, T = 12, B = 32;
  const iw = W - L - R, ih = H - T - B;
  const d = Math.max(duree, 0.5);
  const x = (t) => L + (t / d) * iw;
  const y = (db) => T + ((0 - Math.max(-80, Math.min(0, db))) / 80) * ih;
  const pts = frames.map((f) => [x(f.t), y(f.dbfs)]);
  const ligne = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const aire = pts.length
    ? `${ligne} L${pts[pts.length - 1][0].toFixed(1)},${T + ih} L${pts[0][0].toFixed(1)},${T + ih} Z`
    : "";
  const pas = d > 60 ? 10 : d > 20 ? 5 : d > 8 ? 2 : 1;
  const ticksX = [];
  for (let t = 0; t <= d; t += pas) ticksX.push(t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
         aria-label="Niveau sonore au cours du temps">
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6d8bff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#6d8bff" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {NIVEAUX.map((n) => (
        <g key={n}>
          <line x1={L} x2={W - R} y1={y(n)} y2={y(n)} className="grid" />
          <text x={L - 8} y={y(n) + 4} textAnchor="end" className="tick">{n}</text>
        </g>
      ))}
      {ticksX.map((t) => (
        <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className="tick">{t}s</text>
      ))}
      {segs.filter((s) => s.who !== "Silence").map((s, i) => (
        <rect key={i} x={x(s.debut)} y={T} width={Math.max(x(s.fin) - x(s.debut), 2)} height={ih}
              fill={colorOf(s.who)} opacity="0.26" rx="3">
          <title>{`${s.who} · ${s.debut.toFixed(1)}s → ${s.fin.toFixed(1)}s`}</title>
        </rect>
      ))}
      <line x1={L} x2={W - R} y1={y(silence)} y2={y(silence)} className="silence-line" />
      <text x={W - R - 4} y={y(silence) - 5} textAnchor="end" className="tick">seuil de silence</text>
      <path d={aire} fill="url(#grad)" />
      <path d={ligne} fill="none" stroke="#6d8bff" strokeWidth="2" />
      <text x={12} y={T + ih / 2} className="tick" transform={`rotate(-90 12 ${T + ih / 2})`}
            textAnchor="middle">dBFS</text>
    </svg>
  );
}

export function Donut({ items }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const r = 70, c = 2 * Math.PI * r;
  let decalage = 0;
  return (
    <svg viewBox="0 0 200 200" className="donut" role="img" aria-label="Temps de parole">
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="26" />
      {items.map((it) => {
        const len = (it.value / total) * c;
        const el = (
          <circle key={it.name} cx="100" cy="100" r={r} fill="none" stroke={it.color}
                  strokeWidth="26" strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-decalage} transform="rotate(-90 100 100)">
            <title>{`${it.name} : ${it.value.toFixed(1)} s`}</title>
          </circle>
        );
        decalage += len;
        return el;
      })}
      <text x="100" y="98" textAnchor="middle" className="donut-big">{total.toFixed(0)} s</text>
      <text x="100" y="118" textAnchor="middle" className="donut-small">de parole</text>
    </svg>
  );
}
