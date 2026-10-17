import { useEffect, useMemo, useState } from "react";
import AudioInput from "./AudioInput.jsx";
import { Donut, LevelChart } from "./charts.jsx";
import { api } from "./api.js";

const INCONCLUANT = "Non concluant";
const SILENCE = "Silence";
const PALETTE = ["#6d8bff", "#f9a84f", "#4fd1a5", "#c084fc", "#f472b6", "#facc15"];
const LANGUES = { fr: "Français", en: "Anglais", ar: "Arabe", es: "Espagnol" };

function classer(scores, seuil, ecart) {
  if (!scores) return { qui: INCONCLUANT, score: null };
  const tri = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!tri.length) return { qui: INCONCLUANT, score: null };
  const [meilleur, s] = tri[0];
  const second = tri.length > 1 ? tri[1][1] : -1;
  if (s < seuil || s - second < ecart) return { qui: INCONCLUANT, score: s };
  return { qui: meilleur, score: s };
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function App() {
  const [etat, setEtat] = useState(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [personnes, setPersonnes] = useState([]);
  const [nom, setNom] = useState("");
  const [voix, setVoix] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ajout, setAjout] = useState(false);

  const [seuil, setSeuil] = useState(0.75);
  const [ecart, setEcart] = useState(0.05);
  const [silence, setSilence] = useState(-50);
  const [stt, setStt] = useState(true);
  const [modele, setModele] = useState("base");
  const [langue, setLangue] = useState("fr");

  const [audio, setAudio] = useState(null);
  const [res, setRes] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState("dash");

  // état du serveur (attend le chargement du modèle vocal)
  useEffect(() => {
    let stop = false, t;
    const tick = async () => {
      try {
        const e = await api.etat();
        if (stop) return;
        setEtat(e);
        setHorsLigne(false);
        if (!e.pret) t = setTimeout(tick, 1500);
      } catch {
        if (stop) return;
        setHorsLigne(true);
        t = setTimeout(tick, 3000);
      }
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (etat) api.personnes().then(setPersonnes).catch(() => {});
  }, [!!etat]); // eslint-disable-line

  const sttActif = stt && !!etat?.stt_disponible;
  const noms = useMemo(() => personnes.map((p) => p.nom), [personnes]);
  const couleur = (n) =>
    n === INCONCLUANT ? "#9aa3b2" : n === SILENCE ? "#3b4252" : PALETTE[Math.max(noms.indexOf(n), 0) % PALETTE.length];

  async function ajouter() {
    setMsg(null);
    if (!nom.trim() || !voix) {
      setMsg({ type: "warn", text: "Saisissez un identifiant et fournissez un enregistrement." });
      return;
    }
    setAjout(true);
    try {
      const r = await api.ajouter(nom.trim(), voix);
      setPersonnes(r.personnes);
      setMsg({ type: "ok", text: `Voix ajoutée pour ${r.nom} (${r.secondes.toFixed(0)} s de parole détectée).` });
      setVoix(null);
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    } finally {
      setAjout(false);
    }
  }

  async function supprimer(n) {
    if (!window.confirm(`Supprimer la voix de « ${n} » ?`)) return;
    try { setPersonnes(await api.supprimer(n)); } catch (e) { setMsg({ type: "err", text: e.message }); }
  }

  async function importer(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setPersonnes(await api.importer(f));
      setMsg({ type: "ok", text: "Voix importées." });
    } catch (err) {
      setMsg({ type: "err", text: err.message });
    }
  }

  async function analyser() {
    setOccupe(true);
    setErreur("");
    try {
      setRes(await api.analyser(audio, { stt: sttActif, modele, langue }));
      setOnglet("dash");
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  const lignes = useMemo(() => {
    if (!res) return [];
    return res.segments.map((s) => {
      if (s.dbfs < silence) return { ...s, qui: SILENCE, score: null };
      const c = classer(s.scores, seuil, ecart);
      return { ...s, qui: c.qui, score: c.score };
    });
  }, [res, seuil, ecart, silence]);

  const stats = useMemo(() => {
    if (!res) return null;
    const parole = {};
    lignes.forEach((l) => {
      if (l.qui !== SILENCE && l.qui !== INCONCLUANT) parole[l.qui] = (parole[l.qui] || 0) + (l.fin - l.debut);
    });
    const principal = Object.entries(parole).sort((a, b) => b[1] - a[1])[0];
    const moy = res.niveaux.length
      ? 10 * Math.log10(res.niveaux.reduce((a, f) => a + Math.pow(10, f.dbfs / 10), 0) / res.niveaux.length)
      : -120;
    const tri = res.niveaux.map((f) => f.dbfs).sort((a, b) => a - b);
    const plancher = tri.length ? tri[Math.floor(tri.length * 0.1)] : -120;
    return { parole, principal: principal ? principal[0] : null, moy, plancher };
  }, [res, lignes]);

  function exporterCsv() {
    const tete = ["Début (s)", "Fin (s)", "Locuteur", "Score", "Niveau (dBFS)", "Texte"];
    const corps = lignes.map((l) =>
      [l.debut.toFixed(2), l.fin.toFixed(2), l.qui, l.score?.toFixed(3) ?? "", l.dbfs.toFixed(1), l.texte]
        .map(csvCell).join(";"));
    const blob = new Blob(["\ufeff" + [tete.map(csvCell).join(";"), ...corps].join("\n")],
                          { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "voicescope_resultats.csv";
    a.click();
  }

  const pret = !!etat?.pret;
  const peutAnalyser = !!audio && personnes.length > 0 && pret && !occupe;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="logo">🎙️</div>
          <div>
            <div className="brand-name">VoiceScope</div>
            <div className="brand-sub">Analyse sonore en classe</div>
          </div>
        </div>

        <section className="card">
          <h3>1 · Enregistrer une personne</h3>
          <label className="field">
            <span>Identifiant</span>
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="H1, H2, H3 ou un prénom" maxLength={40} />
          </label>
          <p className="hint">Lisez un texte à voix haute pendant 10 à 15 secondes. Plusieurs échantillons par personne améliorent la fiabilité.</p>
          <AudioInput value={voix} onChange={setVoix} compact />
          <button className="btn primary full" onClick={ajouter} disabled={ajout || !pret}>
            {ajout ? "Calcul de l'empreinte…" : "Ajouter cette voix"}
          </button>
          {msg && <div className={"alert " + msg.type}>{msg.text}</div>}
        </section>

        <section className="card">
          <h3>Voix enregistrées</h3>
          {personnes.length === 0 && <p className="hint">Aucune voix pour le moment.</p>}
          <ul className="people">
            {personnes.map((p) => (
              <li key={p.nom}>
                <span className="chip" style={{ background: couleur(p.nom) }}>{p.nom}</span>
                <span className="meta">{p.echantillons} échantillon{p.echantillons > 1 ? "s" : ""}</span>
                <button className="icon" title="Supprimer" onClick={() => supprimer(p.nom)}>✕</button>
              </li>
            ))}
          </ul>
          <p className="hint">💾 Les voix sont sauvegardées sur le disque : inutile de les réenregistrer à chaque session.</p>
          <div className="row">
            <a className="btn ghost small" href="/api/voix/export" download>Exporter</a>
            <label className="btn ghost small">
              Importer<input type="file" accept=".json,application/json" hidden onChange={importer} />
            </label>
          </div>
        </section>

        <section className="card">
          <h3>Paramètres</h3>
          <Slider label="Seuil de similarité" v={seuil} set={setSeuil} min={0.5} max={0.95} step={0.01}
                  fmt={(v) => v.toFixed(2)} aide="Plus élevé = plus strict. En dessous : « Non concluant »." />
          <Slider label="Écart minimal avec le 2ᵉ" v={ecart} set={setEcart} min={0} max={0.2} step={0.01}
                  fmt={(v) => v.toFixed(2)} />
          <Slider label="Seuil de silence" v={silence} set={setSilence} min={-80} max={-20} step={1}
                  fmt={(v) => `${v} dBFS`} />
          <label className="toggle">
            <input type="checkbox" checked={sttActif} disabled={!etat?.stt_disponible}
                   onChange={(e) => setStt(e.target.checked)} />
            <span>Transcription de la parole</span>
          </label>
          {etat && !etat.stt_disponible && (
            <p className="hint">Non installée : <code>pip install faster-whisper</code></p>
          )}
          <div className="row two">
            <label className="field">
              <span>Modèle</span>
              <select value={modele} onChange={(e) => setModele(e.target.value)} disabled={!sttActif}>
                <option value="base">base (rapide)</option>
                <option value="small">small (précis)</option>
              </select>
            </label>
            <label className="field">
              <span>Langue</span>
              <select value={langue} onChange={(e) => setLangue(e.target.value)} disabled={!sttActif}>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="ar">Arabe</option>
                <option value="auto">Auto</option>
              </select>
            </label>
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="hero">
          <div>
            <h1>Détecteur et analyse du son en classe</h1>
            <p>Reconnaissance du locuteur · transcription · niveau sonore relatif (dBFS)</p>
          </div>
          <div className="status">
            <span className={"pill " + (horsLigne ? "bad" : pret ? "good" : "wait")}>
              {horsLigne ? "Serveur hors ligne" : pret ? "Modèle vocal prêt" : "Chargement du modèle…"}
            </span>
            <span className={"pill " + (etat?.stt_disponible ? "good" : "off")}>
              Transcription {etat?.stt_disponible ? "disponible" : "absente"}
            </span>
            <span className="pill off">{personnes.length} voix</span>
          </div>
        </header>

        {horsLigne && (
          <div className="alert err">
            Impossible de joindre le serveur. Lancez-le avec <code>python -m uvicorn server:app --port 8000</code> puis ouvrez <code>http://localhost:8000</code>.
          </div>
        )}

        <section className="card">
          <h3>2 · Analyser un enregistrement</h3>
          <AudioInput value={audio} onChange={setAudio} />
          <div className="row">
            <button className="btn primary" onClick={analyser} disabled={!peutAnalyser}>
              {occupe ? "Analyse en cours…" : "▶ Analyser"}
            </button>
            {personnes.length === 0 && <span className="hint">Enregistrez d'abord au moins une voix.</span>}
          </div>
          {erreur && <div className="alert err">{erreur}</div>}
          {res?.avertissement && <div className="alert warn">{res.avertissement}</div>}
        </section>

        {res && stats && (
          <>
            <div className="kpis">
              <Kpi titre="Durée" valeur={`${res.duree.toFixed(1)} s`} />
              <Kpi titre="Niveau moyen" valeur={`${stats.moy.toFixed(1)} dBFS`} />
              <Kpi titre="Plancher de bruit" valeur={`${stats.plancher.toFixed(1)} dBFS`} />
              <Kpi titre="Locuteur principal" valeur={stats.principal || "Aucun"}
                   couleur={stats.principal ? couleur(stats.principal) : null} />
              <Kpi titre="Langue détectée" valeur={res.langue ? LANGUES[res.langue] || res.langue.toUpperCase() : "—"} />
            </div>

            <div className="tabs">
              {[["dash", "📊 Tableau de bord"], ["trans", "💬 Transcription"], ["data", "🗂️ Données"]].map(([k, l]) => (
                <button key={k} className={onglet === k ? "tab on" : "tab"} onClick={() => setOnglet(k)}>{l}</button>
              ))}
            </div>

            {onglet === "dash" && (
              <div className="grid-dash">
                <section className="card">
                  <h3>Niveau sonore et locuteur actif</h3>
                  <LevelChart frames={res.niveaux} duree={res.duree} silence={silence} colorOf={couleur}
                              segs={lignes.map((l) => ({ debut: l.debut, fin: l.fin, who: l.qui }))} />
                  <div className="legend">
                    {[...noms, INCONCLUANT].map((n) => (
                      <span key={n}><i style={{ background: couleur(n) }} />{n}</span>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <h3>Temps de parole</h3>
                  {Object.keys(stats.parole).length ? (
                    <>
                      <Donut items={Object.entries(stats.parole).map(([n, v]) => ({ name: n, value: v, color: couleur(n) }))} />
                      <div className="legend col">
                        {Object.entries(stats.parole).sort((a, b) => b[1] - a[1]).map(([n, v]) => (
                          <span key={n}><i style={{ background: couleur(n) }} />{n} · {v.toFixed(1)} s</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="hint">Aucune voix identifiée. Essayez de baisser le seuil de similarité.</p>
                  )}
                </section>
              </div>
            )}

            {onglet === "trans" && (
              <section className="card">
                <h3>Transcription par locuteur</h3>
                {!res.stt && <p className="hint">Activez la transcription dans les paramètres puis relancez l'analyse.</p>}
                {lignes.filter((l) => l.texte).map((l, i) => (
                  <div key={i} className="tline" style={{ borderColor: couleur(l.qui) }}>
                    <span className="chip" style={{ background: couleur(l.qui) }}>{l.qui}</span>
                    <span className="meta">{l.debut.toFixed(1)} s – {l.fin.toFixed(1)} s{l.score != null ? ` · ${l.score.toFixed(2)}` : ""}</span>
                    <div className="ttext">{l.texte}</div>
                  </div>
                ))}
              </section>
            )}

            {onglet === "data" && (
              <section className="card">
                <div className="row between">
                  <h3>Données détaillées</h3>
                  <button className="btn ghost small" onClick={exporterCsv}>⬇ Télécharger le CSV</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Début</th><th>Fin</th><th>Locuteur</th><th>Score</th><th>Niveau</th><th>Texte</th></tr>
                    </thead>
                    <tbody>
                      {lignes.map((l, i) => (
                        <tr key={i}>
                          <td>{l.debut.toFixed(1)} s</td>
                          <td>{l.fin.toFixed(1)} s</td>
                          <td><span className="chip" style={{ background: couleur(l.qui) }}>{l.qui}</span></td>
                          <td>{l.score != null ? l.score.toFixed(2) : "—"}</td>
                          <td>{l.dbfs.toFixed(1)} dBFS</td>
                          <td>{l.texte}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({ titre, valeur, couleur }) {
  return (
    <div className="kpi">
      <div className="kpi-t">{titre}</div>
      <div className="kpi-v" style={couleur ? { color: couleur } : null}>{valeur}</div>
    </div>
  );
}

function Slider({ label, v, set, min, max, step, fmt, aide }) {
  return (
    <label className="field">
      <span className="between">{label}<b>{fmt(v)}</b></span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(parseFloat(e.target.value))} />
      {aide && <small className="hint">{aide}</small>}
    </label>
  );
}
