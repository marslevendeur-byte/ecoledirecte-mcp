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
}

// ── Tool handlers ────────────────────────────────────────────────────────────

export async function handleLogin(args: {
  identifiant: string;
  motdepasse: string;
}): Promise<string> {
  const result = await login(args.identifiant, args.motdepasse);

  if (result.needDoubleAuth) {
    let msg =
      "⚠️ EcoleDirecte demande une vérification double authentification.\n\n";
    if (result.question) msg += `**Question :** ${result.question}\n\n`;
    if (result.propositions?.length) {
      msg += "**Propositions :**\n";
      result.propositions.forEach((p, i) => (msg += `${i + 1}. ${p}\n`));
      msg +=
        "\nUtilise l'outil `submit_doubleauth` avec ta réponse pour finaliser la connexion.";
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

  const cours = await edRequest<EDCours[]>(
    `E/${s.studentId}/emploidutemps.awp`,
    { dateDebut, dateFin, avecTrous: false }
  );

  if (!cours.length) return `📅 Aucun cours du ${formatDate(dateDebut)} au ${formatDate(dateFin)}.`;

  // Groupe par jour
  const byDay = new Map<string, EDCours[]>();
  for (const c of cours) {
    const day = c.start_date.split(" ")[0];
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(c);
  }

  let out = `📅 **Emploi du temps** du ${formatDate(dateDebut)} au ${formatDate(dateFin)}\n\n`;

  for (const [day, classes] of [...byDay.entries()].sort()) {
    out += `### ${formatDate(day)}\n`;
    for (const c of classes.sort((a, b) =>
      a.start_date.localeCompare(b.start_date)
    )) {
      const annule = c.isAnnule ? " ~~annulé~~" : "";
      const dispense = c.dispense ? " *(dispensé)*" : "";
      out += `- **${formatTimeSlot(c.start_date, c.end_date)}** — ${c.text}${annule}${dispense}`;
      if (c.salle) out += ` · salle ${c.salle}`;
      if (c.prof) out += ` · ${c.prof}`;
      out += "\n";
    }
    out += "\n";
  }

  return out.trim();
}

export async function handleDevoirs(args: {
  date?: string;
}): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const today = new Date().toISOString().split("T")[0];

  if (args.date) {
    // Devoirs détaillés pour un jour précis
    const data = await edRequest<{
      date: string;
      matieres: EDDevoirDetail[];
    }>(`Eleves/${s.studentId}/cahierdetexte/${args.date}.awp`);

    if (!data.matieres?.length)
      return `📚 Aucun devoir pour le ${formatDate(args.date)}.`;

    let out = `📚 **Devoirs pour le ${formatDate(args.date)}**\n\n`;

    for (const m of data.matieres) {
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
      if (af.documents.length) {
        out += `📎 Pièces jointes : ${af.documents.map((d) => d.libelle).join(", ")}\n`;
      }
      out += "\n";
    }

    return out.trim();
  }

  // Liste synthétique de tous les devoirs à venir
  const data = await edRequest<Record<string, EDDevoirBrief[]>>(
    `Eleves/${s.studentId}/cahierdetexte.awp`
  );

  const entries = Object.entries(data)
    .filter(([date]) => date >= today)
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

  out += `\n*Utilise \`get_devoirs\` avec une date (ex: \`${entries[0]?.[0]}\`) pour voir le détail d'un jour.*`;

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

  const { periodes, notes } = data;

  // Filtre période
  let periodeActive: EDPeriode | undefined;
  if (args.periode) {
    periodeActive = periodes.find(
      (p) =>
        p.codePeriode === args.periode ||
        p.periode.toLowerCase().includes(args.periode!.toLowerCase())
    );
  } else {
    // Période en cours : la dernière non clôturée, sinon la dernière
    periodeActive =
      periodes
        .filter((p) => !p.annuel && !p.cloture)
        .sort((a, b) => a.codePeriode.localeCompare(b.codePeriode))
        .at(-1) ??
      periodes
        .filter((p) => !p.annuel)
        .sort((a, b) => a.codePeriode.localeCompare(b.codePeriode))
        .at(-1);
  }

  if (!periodeActive) return "❌ Aucune période trouvée.";

  const filteredNotes = notes.filter(
    (n) => n.codePeriode === periodeActive!.codePeriode
  );

  // Filtre matière optionnel
  const notesMatiere = args.matiere
    ? filteredNotes.filter((n) =>
        n.libelleMatiere.toLowerCase().includes(args.matiere!.toLowerCase())
      )
    : filteredNotes;

  if (!notesMatiere.length)
    return `📊 Aucune note pour la période "${periodeActive.periode}"${args.matiere ? ` en ${args.matiere}` : ""}.`;

  let out = `📊 **Notes — ${periodeActive.periode}**${args.matiere ? ` · ${args.matiere}` : ""}\n\n`;

  // Moyenne générale de la période
  const moyGen = periodeActive.ensembleMatieres?.moyenneGenerale;
  if (moyGen && !args.matiere) {
    out += `**Moyenne générale : ${moyGen}/20**`;
    const moyClasse = periodeActive.ensembleMatieres?.disciplines?.[0]?.moyenneClasse;
    if (moyClasse) out += ` *(classe : ${moyClasse}/20)*`;
    out += "\n\n";
  }

  // Groupe par matière
  const byMatiere = new Map<string, EDNote[]>();
  for (const n of notesMatiere.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )) {
    if (!byMatiere.has(n.libelleMatiere)) byMatiere.set(n.libelleMatiere, []);
    byMatiere.get(n.libelleMatiere)!.push(n);
  }

  for (const [matiere, mNotes] of byMatiere) {
    // Moyenne de la matière dans la période
    const discipInfo = periodeActive.ensembleMatieres?.disciplines?.find(
      (d) => d.discipline === matiere
    );
    out += `### ${matiere}`;
    if (discipInfo) out += ` *(moy. : ${discipInfo.moyenne}/20)*`;
    out += "\n";

    for (const n of mNotes) {
      const val = parseNote(n.valeur);
      const sur = parseNote(n.noteSur) ?? 20;
      const valDisplay =
        val !== null ? `**${n.valeur}/${n.noteSur}**` : n.valeur;
      const moy20 = val !== null ? ` *(= ${((val / sur) * 20).toFixed(2)}/20)*` : "";
      out += `- ${formatDate(n.date)} — ${n.devoir} : ${valDisplay}${moy20}`;
      if (n.commentaire) out += ` — *${n.commentaire}*`;
      out += "\n";
    }

    // Calcul de moyenne perso pour cette matière
    const moyCalc = calcMoyenne(mNotes);
    out += `*Moyenne calculée : ${moyCalc}/20*\n\n`;
  }

  // Liste des périodes dispo
  out += `---\n*Périodes disponibles : ${periodes
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

  const limit = Math.min(args.limit ?? 10, 50);

  const data = await edRequest<{
    messages: { received: EDMessage[] };
  }>(
    `eleves/${s.studentId}/messages.awp`,
    {}
  );

  const received: EDMessage[] = Array.isArray(data)
    ? (data as unknown as { received: EDMessage[] }).received ?? (data as unknown as EDMessage[])
    : data?.messages?.received ?? [];

  if (!received.length) return "📬 Aucun message reçu.";

  const sorted = [...received]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  let out = `📬 **Messages reçus** (${sorted.length} sur ${received.length})\n\n`;

  for (const m of sorted) {
    const lu = m.read ? "" : "🔵 ";
    out += `${lu}**[${m.id}]** ${formatDate(m.date)} — *${m.from?.name ?? "Inconnu"}*\n`;
    out += `> ${m.objet ?? "(sans objet)"}\n\n`;
  }

  out += `\n*Utilise \`get_messages\` avec \`id\` pour lire un message complet.*`;

  return out.trim();
}

export async function handleMessageDetail(args: { id: number }): Promise<string> {
  const s = getSession();
  if (!s) throw new Error("Non connecté. Utilise d'abord login.");

  const currentYear = new Date().getFullYear();
  const schoolYear = `${currentYear - 1}-${currentYear}`;

  const data = await edRequest<EDMessage>(
    `eleves/${s.studentId}/messages/${args.id}.awp?mode=destinataire`,
    { anneeMessages: schoolYear }
  );

  let out = `📨 **Message #${args.id}**\n\n`;
  out += `**De :** ${data.from?.name ?? "Inconnu"}\n`;
  out += `**Date :** ${formatDate(data.date)}\n`;
  out += `**Objet :** ${data.objet ?? "(sans objet)"}\n\n`;
  out += "---\n\n";
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

  const { periodes, notes } = data;
  const periodesCourantes = periodes.filter((p) => !p.annuel);

  if (!periodesCourantes.length) return "❌ Aucune période trouvée.";

  let out = `📈 **Récapitulatif des moyennes — ${s.studentName}**\n\n`;

  for (const periode of periodesCourantes) {
    out += `## ${periode.periode}${periode.cloture ? " *(clôturée)*" : ""}\n`;

    const moyGen = periode.ensembleMatieres?.moyenneGenerale;
    if (moyGen) out += `**Moyenne générale : ${moyGen}/20**\n\n`;

    const disciplines = periode.ensembleMatieres?.disciplines ?? [];
    if (disciplines.length) {
      for (const d of disciplines) {
        if (!d.moyenne || d.moyenne === "") continue;
        out += `- **${d.discipline}** : ${d.moyenne}/20`;
        if (d.moyenneClasse) out += ` *(classe : ${d.moyenneClasse}/20)*`;
        out += "\n";
      }
    } else {
      // Calcul maison si ED ne donne pas les moyennes par matière
      const notesP = notes.filter((n) => n.codePeriode === periode.codePeriode);
      const byMatiere = new Map<string, EDNote[]>();
      for (const n of notesP) {
        if (!byMatiere.has(n.libelleMatiere)) byMatiere.set(n.libelleMatiere, []);
        byMatiere.get(n.libelleMatiere)!.push(n);
      }
      for (const [mat, ns] of byMatiere) {
        out += `- **${mat}** : ${calcMoyenne(ns)}/20\n`;
      }
    }
    out += "\n";
  }

  return out.trim();
}
