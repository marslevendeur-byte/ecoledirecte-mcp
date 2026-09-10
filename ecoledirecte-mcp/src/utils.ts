/**
 * Décode une string base64 EcoleDirecte (contenu HTML → texte brut)
 */
export function decodeED(b64: string): string {
  if (!b64) return "";
  try {
    const html = Buffer.from(b64, "base64").toString("utf-8");
    // Retire les balises HTML basiques
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  } catch {
    return b64;
  }
}

/**
 * Formate une date ISO en français : "lundi 15 janvier 2024"
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "date inconnue";
  const d = new Date(dateStr.replace(" ", "T"));
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Parse une note ED (format "XX,YY" ou "XX.YY") → nombre ou null
 */
export function parseNote(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === "") return null;
  const str = String(val).replace(",", ".");
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

/**
 * Calcule une moyenne pondérée à partir d'un tableau de notes
 */
export function calcMoyenne(
  notes: Array<{ valeur: string; coef: string; noteSur: string }>
): string {
  let sumProd = 0;
  let sumCoef = 0;

  for (const note of notes) {
    const val = parseNote(note.valeur);
    const coef = parseNote(note.coef) ?? 1;
    const sur = parseNote(note.noteSur) ?? 20;
    if (val === null || note.valeur === "Abs" || note.valeur === "Disp") continue;
    // Ramène sur /20
    const valSur20 = (val / sur) * 20;
    sumProd += valSur20 * coef;
    sumCoef += coef;
  }

  if (sumCoef === 0) return "N/A";
  return (sumProd / sumCoef).toFixed(2).replace(".", ",");
}

/**
 * Semaine en cours : lundi → vendredi
 */
export function getCurrentWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0=dim, 1=lun...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const toISO = (d: Date) => d.toISOString().split("T")[0];
  return { start: toISO(monday), end: toISO(friday) };
}

/**
 * Formate un créneau EDT : "08:00 → 08:55"
 */
export function formatTimeSlot(start: string, end: string): string {
  const fmt = (dt: string) => dt.split(" ")[1]?.slice(0, 5) ?? dt;
  return `${fmt(start)} → ${fmt(end)}`;
}
