import { login, edRequest, getSession, clearSession } from "./ed-client.js";
import {
  decodeED,
  formatDate,
  parseNote,
  calcMoyenne,
  getCurrentWeekRange,
  formatTimeSlot,
} from "./utils.js";

// ── Types API EcoleDirecte ───────────────────────────────────────────────────

interface EDCours {
  id: number;
  text: string;
  matiere: string;
  typeCours: string;
  start_date: string;
  end_date: string;
  prof: string;
  salle: string;
  isAnnule: boolean;
  dispense: number;
}

interface EDDevoirBrief {
  matiere: string;
  idDevoir: number;
  effectue: boolean;
  interrogation: boolean;
  donneLe: string;
}

interface EDDevoirDetail {
  matiere: string;
  nomProf: string;
  interrogation: boolean;
  aFaire: {
    contenu: string;
    rendreEnLigne: boolean;
    donneLe: string;
    effectue: boolean;
    documents: Array<{ id: number; libelle: string; taille: number }>;
  } | null;
  contenuDeSeance?: { contenu: string };
}

interface EDNote {
  id: number;
  devoir: string;
  codePeriode: string;
  libelleMatiere: string;
  typeDevoir: string;
  coef: string;
  noteSur: string;
  valeur: string;
  date: string;
  commentaire: string;
  moyenneClasse: string;
}

interface EDPeriode {
  codePeriode: string;
  periode: string;
  annuel: boolean;
  cloture: boolean;
  ensembleMatieres: {
    moyenneGenerale: string;
    disciplines: Array<{
      discipline: string;
      moyenne: string;
      moyenneClasse: string;
      coef: number;
    }>;
  };
}

interface EDMessage {
  id: number;
  objet: string;
  from: { name: string };
  date: string;
  read: boolean;
  content?: string;
  // BUG FIX : ED peut retourner "read" ou "lu"
  lu?: boolean;
}

// ── Tool handlers ────────────────────────────────────────────────────────────

export async function handleLogin(args: {
  cn?: string;
  cv?: string;
  identifiant: string;
  motdepasse: string;
}): Promise<string> {
  const fa = args.cn && args.cv ? [{ cn: args.cn, cv: args.cv }] : undefined;
  const result = await login(args.identifiant, args.motdepasse, fa);

  if (result.needDoubleAuth) {
    let msg = "⚠️ EcoleDirecte demande une double authentification.\n\n";
    if (result.question) msg += `**Question :** ${result.question}\n\n`;
    if (result.propositions?.length) {
      msg += "**Propositions :**\n";
      result.propositions.forEach((p, i) => (msg += `${i + 1}. ${p}\n`));
      msg += "\nRéponds avec le numéro de ta réponse.";
    }
    return msg;
  }

  const s = result.session;
  return `✅ Connecté en tant que **${s.studentName}** (${s.className})`;
}

export async function handleLogout(): Promise<string> {
  clearSession();
  return "👋 Déconnecté.";
}

export async function handleStatus(): Promise<string> {
  const s = getSession();
  if (!s) return "❌ Non connecté. Utilise l'outil `login` pour te connecter.";
  return `✅ Connecté : **${s.studentName}** — ${s.className}`;
}

export async function handleEmploiDuTemps(args: {
  date_debut?: string;
  date_fin?: string;
}): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const { start, end } = getCurrentWeekRange();
  const dateDebut = args.date_debut ?? start;
  const dateFin = args.date_fin ?? end;

  // BUG FIX : route correcte = eleves (minuscule), pas E/
  const cours = await edRequest<EDCours[]>(
    `eleves/${s.studentId}/emploidutemps.awp`,
    { dateDebut, dateFin, avecTrous: false }
  );

  // BUG FIX : la réponse peut ne pas être un tableau directement
  const list = Array.isArray(cours) ? cours : [];

  if (!list.length) return `📅 Aucun cours du ${formatDate(dateDebut)} au ${formatDate(dateFin)}.`;

  const byDay = new Map<string, EDCours[]>();
  for (const c of list) {
    const day = c.start_date.split(" ")[0];
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(c);
  }

  let out = `📅 **Emploi du temps** du ${formatDate(dateDebut)} au ${formatDate(dateFin)}\n\n`;

  for (const [day, classes] of [...byDay.entries()].sort()) {
    out += `### ${formatDate(day)}\n`;
    for (const c of classes.sort((a, b) => a.start_date.localeCompare(b.start_date))) {
      const annule = c.isAnnule ? " ~~annulé~~" : "";
      const dispense = c.dispense ? " *(dispensé)*" : "";
      out += `- **${formatTimeSlot(c.start_date, c.end_date)}** — ${c.text || c.matiere}${annule}${dispense}`;
      if (c.salle) out += ` · salle ${c.salle}`;
      if (c.prof) out += ` · ${c.prof}`;
      out += "\n";
    }
    out += "\n";
  }

  return out.trim();
}

export async function handleDevoirs(args: { date?: string }): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const today = new Date().toISOString().split("T")[0];

  if (args.date) {
    const data = await edRequest<{
      date: string;
      matieres: EDDevoirDetail[];
    }>(`Eleves/${s.studentId}/cahierdetexte/${args.date}.awp`);

    // BUG FIX : matieres peut être null/undefined
    const matieres = data?.matieres ?? [];
    if (!matieres.length)
      return `📚 Aucun devoir pour le ${formatDate(args.date)}.`;

    let out = `📚 **Devoirs pour le ${formatDate(args.date)}**\n\n`;

    for (const m of matieres) {
      if (!m.aFaire) continue;
      const af = m.aFaire;
      out += `### ${m.matiere}`;
      if (m.interrogation) out += " 🔴 *Interro*";
      out += "\n";
      if (m.nomProf) out += `*Prof : ${m.nomProf}*\n`;
      out += decodeED(af.contenu) || "*(pas de détail)*";
      out += "\n";
      if (af.effectue) out += "✅ Marqué comme fait\n";
      if (af.rendreEnLigne) out += "📤 *À rendre en ligne*\n";
      if (af.documents?.length) {
        out += `📎 ${af.documents.map((d) => d.libelle).join(", ")}\n`;
      }
      out += "\n";
    }

    return out.trim() || `📚 Aucun devoir à faire pour le ${formatDate(args.date)}.`;
  }

  // Liste synthétique
  const data = await edRequest<Record<string, EDDevoirBrief[]>>(
    `Eleves/${s.studentId}/cahierdetexte.awp`
  );

  // BUG FIX : data peut être null ou pas un objet
  if (!data || typeof data !== "object") return "📚 Aucun devoir à venir ! 🎉";

  const entries = Object.entries(data)
    .filter(([date, devoirs]) => date >= today && Array.isArray(devoirs) && devoirs.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) return "📚 Aucun devoir à venir ! 🎉";

  let out = "📚 **Devoirs à venir**\n\n";

  for (const [date, devoirs] of entries) {
    out += `**${formatDate(date)}**\n`;
    for (const d of devoirs) {
      const effectue = d.effectue ? " ✅" : "";
      const interro = d.interrogation ? " 🔴 *Interro*" : "";
      out += `- ${d.matiere}${interro}${effectue}\n`;
    }
    out += "\n";
  }

  out += `\n*Dis-moi une date (ex: "${entries[0]?.[0]}") pour voir le détail.*`;

  return out.trim();
}

export async function handleNotes(args: {
  matiere?: string;
  periode?: string;
}): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const data = await edRequest<{
    periodes: EDPeriode[];
    notes: EDNote[];
  }>(`eleves/${s.studentId}/notes.awp`, { anneeScolaire: "" });

  const periodes = data?.periodes ?? [];
  const notes = data?.notes ?? [];

  let periodeActive: EDPeriode | undefined;
  if (args.periode) {
    periodeActive = periodes.find(
      (p) =>
        p.codePeriode === args.periode ||
        p.periode.toLowerCase().includes(args.periode!.toLowerCase())
    );
  } else {
    periodeActive =
      periodes.filter((p) => !p.annuel && !p.cloture).at(-1) ??
      periodes.filter((p) => !p.annuel).at(-1);
  }

  if (!periodeActive) return "❌ Aucune période trouvée.";

  const filteredNotes = notes.filter((n) => n.codePeriode === periodeActive!.codePeriode);
  const notesMatiere = args.matiere
    ? filteredNotes.filter((n) =>
        n.libelleMatiere.toLowerCase().includes(args.matiere!.toLowerCase())
      )
    : filteredNotes;

  if (!notesMatiere.length)
    return `📊 Aucune note pour "${periodeActive.periode}"${args.matiere ? ` en ${args.matiere}` : ""}.`;

  let out = `📊 **Notes — ${periodeActive.periode}**${args.matiere ? ` · ${args.matiere}` : ""}\n\n`;

  const moyGen = periodeActive.ensembleMatieres?.moyenneGenerale;
  if (moyGen && !args.matiere) {
    out += `**Moyenne générale : ${moyGen}/20**\n\n`;
  }

  const byMatiere = new Map<string, EDNote[]>();
  for (const n of notesMatiere.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )) {
    if (!byMatiere.has(n.libelleMatiere)) byMatiere.set(n.libelleMatiere, []);
    byMatiere.get(n.libelleMatiere)!.push(n);
  }

  for (const [matiere, mNotes] of byMatiere) {
    const discipInfo = periodeActive.ensembleMatieres?.disciplines?.find(
      (d) => d.discipline === matiere
    );
    out += `### ${matiere}`;
    if (discipInfo?.moyenne) out += ` *(moy. ED : ${discipInfo.moyenne}/20)*`;
    out += "\n";

    for (const n of mNotes) {
      const val = parseNote(n.valeur);
      const sur = parseNote(n.noteSur) ?? 20;
      const valDisplay = val !== null ? `**${n.valeur}/${n.noteSur}**` : n.valeur;
      const moy20 = val !== null ? ` *(${((val / sur) * 20).toFixed(2)}/20)*` : "";
      out += `- ${formatDate(n.date)} — ${n.devoir} : ${valDisplay}${moy20}`;
      if (n.commentaire) out += ` — *${n.commentaire}*`;
      out += "\n";
    }

    out += `*Moyenne calculée : ${calcMoyenne(mNotes)}/20*\n\n`;
  }

  out += `---\n*Périodes : ${periodes
    .filter((p) => !p.annuel)
    .map((p) => `${p.periode} (${p.codePeriode})`)
    .join(", ")}*`;

  return out.trim();
}

export async function handleMessages(args: {
  limit?: number;
  id?: number;
}): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  if (args.id) return handleMessageDetail({ id: args.id });

  const limit = Math.min(args.limit ?? 10, 50);

  // BUG FIX : la route messages nécessite le paramètre anneeMessages
  const currentYear = new Date().getFullYear();
  const schoolYear = new Date().getMonth() >= 8
    ? `${currentYear}-${currentYear + 1}`
    : `${currentYear - 1}-${currentYear}`;

  const data = await edRequest<unknown>(
    `eleves/${s.studentId}/messages.awp`,
    { anneeMessages: schoolYear }
  );

  // BUG FIX : la structure de retour varie — on cherche received partout
  let received: EDMessage[] = [];
  if (Array.isArray(data)) {
    received = data as EDMessage[];
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["received"])) received = d["received"] as EDMessage[];
    else if (d["messages"] && typeof d["messages"] === "object") {
      const m = d["messages"] as Record<string, unknown>;
      if (Array.isArray(m["received"])) received = m["received"] as EDMessage[];
    }
  }

  if (!received.length) return "📬 Aucun message reçu.";

  const sorted = [...received]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  let out = `📬 **Messages reçus** (${sorted.length} sur ${received.length})\n\n`;

  for (const m of sorted) {
    const lu = m.read || m.lu;
    out += `${lu ? "" : "🔵 "}**[${m.id}]** ${formatDate(m.date)} — *${m.from?.name ?? "Inconnu"}*\n`;
    out += `> ${m.objet ?? "(sans objet)"}\n\n`;
  }

  out += `*Dis-moi l'ID d'un message pour le lire en entier.*`;

  return out.trim();
}

export async function handleMessageDetail(args: { id: number }): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const currentYear = new Date().getFullYear();
  const schoolYear = new Date().getMonth() >= 8
    ? `${currentYear}-${currentYear + 1}`
    : `${currentYear - 1}-${currentYear}`;

  // BUG FIX : le ?mode=destinataire était ajouté dans le path, ce qui
  // cassait la construction de l'URL dans edRequest (double ?)
  const data = await edRequest<EDMessage>(
    `eleves/${s.studentId}/messages/${args.id}.awp`,
    { anneeMessages: schoolYear, mode: "destinataire" }
  );

  let out = `📨 **Message #${args.id}**\n\n`;
  out += `**De :** ${data.from?.name ?? "Inconnu"}\n`;
  out += `**Date :** ${formatDate(data.date)}\n`;
  out += `**Objet :** ${data.objet ?? "(sans objet)"}\n\n---\n\n`;
  out += data.content ? decodeED(data.content) : "*(contenu vide)*";

  return out.trim();
}

export async function handleMoyennes(): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const data = await edRequest<{
    periodes: EDPeriode[];
    notes: EDNote[];
  }>(`eleves/${s.studentId}/notes.awp`, { anneeScolaire: "" });

  const periodes = data?.periodes ?? [];
  const notes = data?.notes ?? [];
  const periodesCourantes = periodes.filter((p) => !p.annuel);

  if (!periodesCourantes.length) return "❌ Aucune période trouvée.";

  let out = `📈 **Moyennes — ${s.studentName}**\n\n`;

  for (const periode of periodesCourantes) {
    out += `## ${periode.periode}${periode.cloture ? " *(clôturée)*" : ""}\n`;

    const moyGen = periode.ensembleMatieres?.moyenneGenerale;
    if (moyGen) out += `**Moyenne générale : ${moyGen}/20**\n\n`;

    const disciplines = periode.ensembleMatieres?.disciplines ?? [];
    if (disciplines.length) {
      for (const d of disciplines) {
        if (!d.moyenne) continue;
        out += `- **${d.discipline}** : ${d.moyenne}/20`;
        if (d.moyenneClasse) out += ` *(classe : ${d.moyenneClasse}/20)*`;
        out += "\n";
      }
    } else {
      // Calcul maison
      const notesP = notes.filter((n) => n.codePeriode === periode.codePeriode);
      const byMat = new Map<string, EDNote[]>();
      for (const n of notesP) {
        if (!byMat.has(n.libelleMatiere)) byMat.set(n.libelleMatiere, []);
        byMat.get(n.libelleMatiere)!.push(n);
      }
      for (const [mat, ns] of byMat) {
        out += `- **${mat}** : ${calcMoyenne(ns)}/20\n`;
      }
    }
    out += "\n";
  }

  return out.trim();
}
