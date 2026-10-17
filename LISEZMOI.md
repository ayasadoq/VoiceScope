# VoiceScope — détecteur de voix en classe (React + FastAPI)

## Installation (une seule fois)
Dans PowerShell, dans ce dossier :

    pip install fastapi uvicorn python-multipart numpy scipy soundfile librosa tqdm webrtcvad-wheels
    pip install resemblyzer --no-deps
    pip install faster-whisper        (optionnel : transcription)

Torch est déjà installé chez vous (dépendance de Resemblyzer).

## Lancer
Double-cliquez sur `lancer.bat`, ou :

    python -m uvicorn server:app --port 8000

puis ouvrez **http://localhost:8000** (Chrome ou Edge).
Ne pas ouvrir index.html directement : l'interface a besoin du serveur.

## Voix en mémoire
Les voix sont sauvegardées dans `data/voices.json` : on les enregistre une seule fois,
elles sont rechargées à chaque démarrage. Pour les partager avec les coéquipiers :
bouton **Exporter** / **Importer** dans l'interface (ou copier le fichier `data/voices.json`).

## Modifier l'interface (facultatif, Node.js requis)
    cd frontend
    npm install
    npm run dev        (http://localhost:5173, le serveur Python doit tourner)
    npm run build      (régénère frontend/dist, utilisé par le serveur)
