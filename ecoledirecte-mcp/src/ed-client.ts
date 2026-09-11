import fetch from "node-fetch";

const BASE_URL = "https://api.ecoledirecte.com";
const API_VERSION = "4.101.4";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

export interface Session {
  token: string;
  studentId: number;
  studentName: string;
  className: string;
  gtkCookie: string;
}

export interface EDResponse<T = unknown> {
  code: number;
  token?: string;
  message?: string;
  data: T;
}

// ── Auth state (in-memory) ───────────────────────────────────────────────────
let _session: Session | null = null;

export function getSession(): Session | null {
  return _session;
}

export function clearSession(): void {
  _session = null;
}

// ── Cookie helpers ───────────────────────────────────────────────────────────
function extractCookie(setCookieHeaders: string[], name: string): string {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return "";
}

// ── Bootstrap GTK (optionnel) ────────────────────────────────────────────────
async function fetchGTK(): Promise<string> {
  try {
    const res = await fetch(
      `${BASE_URL}/v3/login.awp?gtk=1&v=${API_VERSION}`,
      {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      }
    );
    // node-fetch expose raw() sur les headers
    const raw = (res.headers as unknown as { raw(): Record<string, string[]> }).raw();
    const setCookies = raw["set-cookie"] ?? [];
    return extractCookie(setCookies, "GTK");
  } catch {
    return "";
  }
}

// ── Login ────────────────────────────────────────────────────────────────────
export async function login(
  identifiant: string,
  motdepasse: string,
  fa?: { cn: string; cv: string }[]
): Promise<{ session: Session; needDoubleAuth: boolean; question?: string; propositions?: string[] }> {
  const gtk = await fetchGTK();

  const faWithUniq = fa?.map(f => ({ ...f, uniq: false }));
  const body: Record<string, unknown> = {
    identifiant,
    motdepasse,
    isReLogin: false,
    uuid: "",
  };
  if (faWithUniq && faWithUniq.length > 0) body.fa = faWithUniq;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": USER_AGENT,
  };
  if (gtk) {
    headers["X-Gtk"] = gtk;
    headers["Cookie"] = `GTK=${gtk}`;
  }

  const res = await fetch(`${BASE_URL}/v3/login.awp?v=${API_VERSION}`, {
    method: "POST",
    headers,
    body: `data=${encodeURIComponent(JSON.stringify(body))}`,
  });

  const json = (await res.json()) as EDResponse<{
    accounts?: Array<{
      id: number;
      prenom: string;
      nom: string;
      profile?: { classe?: { libelle?: string } };
    }>;
    question?: string;
    propositions?: string[];
  }>;

  // Double auth requise
  if (json.code === 250) {
    return {
      session: null as unknown as Session,
      needDoubleAuth: true,
      question: json.data?.question
        ? Buffer.from(json.data.question, "base64").toString("utf-8")
        : undefined,
      propositions: json.data?.propositions?.map((p) =>
        Buffer.from(p, "base64").toString("utf-8")
      ),
    };
  }

  console.error("[ED LOGIN] code:", json.code, "message:", json.message, "data:", JSON.stringify(json.data)?.slice(0, 200));

  if (json.code === 505) throw new Error(`Identifiant ou mot de passe invalide (505) — réponse ED: "${json.message}" — data: ${JSON.stringify(json.data)?.slice(0,100)}`);
  if (json.code !== 200) throw new Error(`Erreur EcoleDirecte ${json.code}: ${json.message ?? "inconnue"}`);

  const account = json.data?.accounts?.[0];
  if (!account) throw new Error("Aucun compte trouvé dans la réponse");

  // BUG FIX : le token est à la racine du JSON, pas dans account
  if (!json.token) throw new Error("Token absent de la réponse de login");

  _session = {
    token: json.token,
    studentId: account.id,
    studentName: `${account.prenom} ${account.nom}`,
    className: account.profile?.classe?.libelle ?? "Classe inconnue",
    gtkCookie: gtk,
  };

  return { session: _session, needDoubleAuth: false };
}

// ── Request helper ───────────────────────────────────────────────────────────
export async function edRequest<T>(
  path: string,
  bodyData: Record<string, unknown> = {}
): Promise<T> {
  if (!_session) throw new Error("Non connecté. Utilise d'abord login.");

  // BUG FIX : certaines routes ont déjà des query params (?mode=...) — on
  // ajoute verbe=get et v= sans écraser ce qui existe déjà
  const separator = path.includes("?") ? "&" : "?";
  const url = `${BASE_URL}/v3/${path}${separator}verbe=get&v=${API_VERSION}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": USER_AGENT,
    "X-Token": _session.token,
  };
  // GTK optionnel (peut être vide si non récupéré au login)
  if (_session.gtkCookie) {
    headers["Cookie"] = `GTK=${_session.gtkCookie}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: `data=${encodeURIComponent(JSON.stringify(bodyData))}`,
  });

  const json = (await res.json()) as EDResponse<T>;

  if (json.code === 520 || json.code === 525) {
    _session = null;
    throw new Error("Session expirée. Veuillez vous reconnecter.");
  }
  if (json.code !== 200) {
    throw new Error(`Erreur EcoleDirecte ${json.code}: ${json.message ?? "Erreur inconnue"}`);
  }

  // Rafraîchit le token si ED en envoie un nouveau
  if (json.token && _session) {
    _session.token = json.token;
  }

  return json.data as T;
}

