"""VoiceScope - serveur FastAPI : reconnaissance du locuteur + transcription.

Lancer :  python -m uvicorn server:app --port 8000
Les voix enregistrees sont sauvegardees dans data/voices.json (persistantes).
"""
import importlib.util
import io
import json
import logging
import sys
import threading
import types
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

SR = 16000
BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
VOICES_FILE = DATA / "voices.json"
DIST = BASE / "frontend" / "dist"
EMB_DIM = 256
MIN_SPEECH_ENROLL = 3.0  # secondes de parole minimum pour enregistrer une voix

log = logging.getLogger("voicescope")
logging.basicConfig(level=logging.INFO)

STT_DISPO = importlib.util.find_spec("faster_whisper") is not None

lock = threading.RLock()
voices: dict = {}  # nom -> {"echantillons": [[256 floats], ...], "ajoute": iso}


# ---------------------------------------------------------------- persistance
def load_voices():
    global voices
    if VOICES_FILE.exists():
        try:
            voices = json.loads(VOICES_FILE.read_text(encoding="utf-8"))
            log.info("%d voix chargees depuis %s", len(voices), VOICES_FILE)
        except Exception as e:
            log.warning("Impossible de lire %s : %s", VOICES_FILE, e)
            voices = {}


def save_voices():
    tmp = VOICES_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(voices), encoding="utf-8")
    tmp.replace(VOICES_FILE)


def personnes_list():
    with lock:
        return [{"nom": n, "echantillons": len(v["echantillons"]), "ajoute": v.get("ajoute")}
                for n, v in sorted(voices.items(), key=lambda kv: kv[0].lower())]


# ---------------------------------------------------------------- modeles
def _compat():
    """Petits correctifs de compatibilite pour Resemblyzer avec SciPy / PyTorch recents."""
    try:
        import scipy.ndimage.morphology  # noqa: F401
    except Exception:
        import scipy.ndimage as ndi
        m = types.ModuleType("scipy.ndimage.morphology")
        m.binary_dilation = ndi.binary_dilation
        sys.modules["scipy.ndimage.morphology"] = m
    try:
        import torch
        if not getattr(torch.load, "_vs_patched", False):
            orig = torch.load

            def patched(*a, **k):
                k.setdefault("weights_only", False)
                return orig(*a, **k)

            patched._vs_patched = True
            torch.load = patched
    except Exception:
        pass


_rz = None
_enc = None
_rz_lock = threading.Lock()


def rz():
    global _rz
    with _rz_lock:
        if _rz is None:
            _compat()
            import resemblyzer
            _rz = resemblyzer
        return _rz


def get_encoder():
    global _enc
    mod = rz()
    with _rz_lock:
        if _enc is None:
            _enc = mod.VoiceEncoder("cpu", verbose=False)
        return _enc


def prep(wav):
    return rz().preprocess_wav(wav, source_sr=SR)


def embed(wav):
    return get_encoder().embed_utterance(prep(wav))


_whisper = {}


def get_whisper(size):
    if size not in _whisper:
        from faster_whisper import WhisperModel
        _whisper[size] = WhisperModel(size, device="cpu", compute_type="int8")
    return _whisper[size]


# ---------------------------------------------------------------- audio
def read_wav(raw: bytes):
    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception:
        raise HTTPException(400, "Fichier audio illisible.")
    data = data.mean(axis=1)
    if sr != SR and len(data) > 1:
        n = int(len(data) * SR / sr)
        data = np.interp(np.linspace(0, len(data) - 1, n), np.arange(len(data)), data)
    return data.astype(np.float32)


def dbfs(x):
    if len(x) == 0:
        return -120.0
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-12))


def seg_clip(wav, start, end, min_len=1.5):
    mid = (start + end) / 2
    half = max((end - start) / 2, min_len / 2)
    a = max(int((mid - half) * SR), 0)
    b = min(int((mid + half) * SR), len(wav))
    return wav[a:b]


def centroids():
    out = {}
    with lock:
        for n, v in voices.items():
            m = np.mean(np.array(v["echantillons"], dtype=np.float32), axis=0)
            out[n] = m / (np.linalg.norm(m) + 1e-9)
    return out


# ---------------------------------------------------------------- application
@asynccontextmanager
async def lifespan(app):
    load_voices()
    threading.Thread(target=_warmup, daemon=True).start()
    yield


def _warmup():
    try:
        get_encoder()
        log.info("Modele vocal charge.")
    except Exception:
        log.exception("Echec du chargement du modele vocal")


app = FastAPI(title="VoiceScope", lifespan=lifespan)


@app.get("/api/etat")
def etat():
    return {"pret": _enc is not None, "stt_disponible": STT_DISPO, "voix": len(voices)}


@app.get("/api/personnes")
def lister():
    return personnes_list()


@app.post("/api/personnes")
def ajouter(nom: str = Form(...), audio: UploadFile = File(...)):
    nom = nom.strip()
    if not nom or len(nom) > 40:
        raise HTTPException(400, "Donnez un identifiant (40 caracteres max).")
    wav = read_wav(audio.file.read())
    try:
        speech = prep(wav)
    except Exception as e:
        raise HTTPException(500, f"Erreur de pretraitement audio : {e}")
    secondes = len(speech) / SR
    if secondes < MIN_SPEECH_ENROLL:
        raise HTTPException(
            400, f"Seulement {secondes:.1f} s de parole detectee : parlez au moins 5 a 10 secondes.")
    emb = get_encoder().embed_utterance(speech)
    with lock:
        key = next((n for n in voices if n.lower() == nom.lower()), nom)
        entry = voices.setdefault(key, {"echantillons": [], "ajoute": datetime.now().isoformat(timespec="seconds")})
        entry["echantillons"].append([float(x) for x in emb])
        save_voices()
    return {"nom": key, "secondes": secondes, "personnes": personnes_list()}


@app.delete("/api/personnes/{nom}")
def supprimer(nom: str):
    with lock:
        if nom not in voices:
            raise HTTPException(404, "Personne introuvable.")
        del voices[nom]
        save_voices()
    return personnes_list()


@app.get("/api/voix/export")
def exporter():
    with lock:
        save_voices()
    return FileResponse(VOICES_FILE, media_type="application/json", filename="voices.json")


@app.post("/api/voix/import")
def importer(fichier: UploadFile = File(...)):
    try:
        data = json.loads(fichier.file.read().decode("utf-8"))
        assert isinstance(data, dict)
        for n, v in data.items():
            assert all(len(e) == EMB_DIM for e in v["echantillons"])
    except Exception:
        raise HTTPException(400, "Fichier de voix invalide.")
    with lock:
        for n, v in data.items():
            e = voices.setdefault(n, {"echantillons": [], "ajoute": v.get("ajoute")})
            e["echantillons"].extend(v["echantillons"])
        save_voices()
    return personnes_list()


@app.post("/api/analyse")
def analyser(audio: UploadFile = File(...), stt: bool = Form(True), modele: str = Form("base"),
             langue: str = Form("fr"), fenetre: float = Form(3.0)):
    wav = read_wav(audio.file.read())
    duree = len(wav) / SR
    if duree < 0.5:
        raise HTTPException(400, "Enregistrement trop court.")
    cents = centroids()
    if not cents:
        raise HTTPException(400, "Enregistrez d'abord au moins une voix.")

    avertissement, detected, segs = None, None, []
    if stt and STT_DISPO:
        try:
            raw, info = get_whisper(modele).transcribe(
                wav, language=None if langue == "auto" else langue, vad_filter=True, beam_size=1)
            segs = [(float(s.start), float(s.end), s.text.strip()) for s in raw if s.text.strip()]
            detected = info.language
        except Exception as e:
            log.exception("Echec de la transcription")
            avertissement = f"Transcription indisponible ({e}). Analyse par fenetres."
    elif stt:
        avertissement = "Transcription non installee (pip install faster-whisper). Analyse par fenetres."
    if not segs:
        n = max(int(np.ceil(duree / fenetre)), 1)
        for i in range(n):
            s, e = i * fenetre, min((i + 1) * fenetre, duree)
            if i > 0 and e - s < 0.5:
                continue
            segs.append((s, e, ""))

    rows = []
    for s, e, t in segs:
        level = dbfs(wav[int(s * SR):int(e * SR)])
        scores = None
        if level > -75:
            try:
                emb = embed(seg_clip(wav, s, e))
                scores = {n: float(np.dot(emb, c)) for n, c in cents.items()}
            except Exception as ex:
                log.warning("Segment %.1f-%.1f ignore : %s", s, e, ex)
        rows.append({"debut": s, "fin": e, "texte": t, "dbfs": level, "scores": scores})

    hop = int(0.5 * SR)
    niveaux = [{"t": i / SR, "dbfs": dbfs(wav[i:i + hop])} for i in range(0, max(len(wav) - hop // 2, 1), hop)]
    return {"duree": duree, "langue": detected, "stt": bool(detected), "avertissement": avertissement,
            "segments": rows, "niveaux": niveaux}


# ---------------------------------------------------------------- interface React
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
else:
    @app.get("/")
    def racine():
        return {"message": "Interface non construite : cd frontend && npm install && npm run build"}
