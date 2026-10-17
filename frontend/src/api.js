async function lire(r) {
  if (!r.ok) {
    let msg = "Erreur du serveur";
    try { msg = (await r.json()).detail || msg; } catch { /* ignore */ }
    throw new Error(typeof msg === "string" ? msg : "Requête invalide");
  }
  return r.json();
}

export const api = {
  etat: () => fetch("/api/etat").then(lire),
  personnes: () => fetch("/api/personnes").then(lire),
  ajouter: (nom, blob) => {
    const f = new FormData();
    f.append("nom", nom);
    f.append("audio", blob, "voix.wav");
    return fetch("/api/personnes", { method: "POST", body: f }).then(lire);
  },
  supprimer: (nom) =>
    fetch(`/api/personnes/${encodeURIComponent(nom)}`, { method: "DELETE" }).then(lire),
  importer: (fichier) => {
    const f = new FormData();
    f.append("fichier", fichier);
    return fetch("/api/voix/import", { method: "POST", body: f }).then(lire);
  },
  analyser: (blob, { stt, modele, langue }) => {
    const f = new FormData();
    f.append("audio", blob, "analyse.wav");
    f.append("stt", String(stt));
    f.append("modele", modele);
    f.append("langue", langue);
    return fetch("/api/analyse", { method: "POST", body: f }).then(lire);
  },
};
