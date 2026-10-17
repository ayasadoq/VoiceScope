import { useEffect, useMemo, useRef, useState } from "react";
import { toWav16k } from "./audio.js";

export default function AudioInput({ value, onChange, compact = false }) {
  const [enCours, setEnCours] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const [niveau, setNiveau] = useState(0);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const r = useRef({});
  const fichier = useRef(null);

  const url = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  useEffect(() => () => arreterTout(), []); // eslint-disable-line

  function arreterTout() {
    const s = r.current;
    cancelAnimationFrame(s.raf);
    clearInterval(s.timer);
    s.ac && s.ac.state !== "closed" && s.ac.close();
    s.stream && s.stream.getTracks().forEach((t) => t.stop());
  }

  async function demarrer() {
    setErreur("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErreur("Micro indisponible : ouvrez l'application via http://localhost:8000.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const mr = new MediaRecorder(stream);
      const morceaux = [];
      mr.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
      mr.onstop = async () => {
        arreterTout();
        setOccupe(true);
        try {
          onChange(await toWav16k(new Blob(morceaux, { type: mr.mimeType })));
        } catch (e) {
          setErreur("Impossible de lire l'enregistrement : " + e.message);
        } finally {
          setOccupe(false);
        }
      };
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let m = 0;
        for (const v of buf) m = Math.max(m, Math.abs(v - 128));
        setNiveau(m / 128);
        r.current.raf = requestAnimationFrame(tick);
      };
      tick();
      setSecondes(0);
      r.current = {
        ...r.current, stream, ac, mr,
        timer: setInterval(() => setSecondes((s) => s + 1), 1000),
      };
      mr.start();
      setEnCours(true);
      onChange(null);
    } catch (e) {
      setErreur(
        e.name === "NotAllowedError"
          ? "Accès au micro refusé : cliquez sur le cadenas à côté de l'adresse puis autorisez le micro."
          : "Micro introuvable : " + e.message
      );
    }
  }

  function arreter() {
    setEnCours(false);
    setNiveau(0);
    r.current.mr && r.current.mr.state !== "inactive" && r.current.mr.stop();
  }

  async function choisir(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErreur("");
    setOccupe(true);
    try {
      onChange(await toWav16k(f));
    } catch (err) {
      setErreur("Fichier audio non pris en charge : " + err.message);
    } finally {
      setOccupe(false);
    }
  }

  const mm = String(Math.floor(secondes / 60)).padStart(2, "0");
  const ss = String(secondes % 60).padStart(2, "0");

  return (
    <div className={"audio-input" + (compact ? " compact" : "")}>
      <div className="audio-actions">
        {!enCours ? (
          <button type="button" className="btn rec" onClick={demarrer} disabled={occupe}>
            <span className="dot" /> Enregistrer
          </button>
        ) : (
          <button type="button" className="btn stop" onClick={arreter}>
            ■ Arrêter · {mm}:{ss}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => fichier.current.click()}
                disabled={enCours || occupe}>
          Importer un fichier
        </button>
        <input ref={fichier} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" hidden
               onChange={choisir} />
      </div>
      {enCours && (
        <div className="meter"><div style={{ width: `${Math.min(niveau * 140, 100)}%` }} /></div>
      )}
      {occupe && <div className="hint">Conversion de l'audio…</div>}
      {erreur && <div className="alert err">{erreur}</div>}
      {url && !enCours && (
        <div className="preview">
          <audio controls src={url} />
          <button type="button" className="link" onClick={() => onChange(null)}>Effacer</button>
        </div>
      )}
    </div>
  );
}
