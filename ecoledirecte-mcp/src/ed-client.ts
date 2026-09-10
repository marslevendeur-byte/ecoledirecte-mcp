import fetch, { type RequestInit } from "node-fetch";

const BASE_URL = "https://api.ecoledirecte.com";
const API_VERSION = "4.75.0";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// ── Auth state (in-memory, persist via env fallback) ────────────────────────
let _session: Session | null = null;

export function getSession(): Session | null {
  return _session;
}

export function clearSession(): void {
  _session = null;
}

// ── Cookie helpers ───────────────────────────────────────────────────────────
function extractCookie(setCookieHeader: string[], name: string): string {
  for (const header of setCookieHeader) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return "";
}

// ── Bootstrap GTK ────────────────────────────────────────────────────────────
async function fetchGTK(): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/v3/login.awp?gtk=1&v=${API_VERSION}`,
    {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    }
  );
  const setCookies = res.headers.raw()["set-cookie"] ?? [];
  const gtk = extractCookie(setCookies, "GTK");
  if (!gtk) throw new Error("Impossible de récupérer le cookie GTK");
  return gtk;
}

// ── Login ────────────────────────────────────────────────────────────────────
export async function login(
  identifiant: string,
  motdepasse: string,
  fa?: { cn: string; cv: string }[]
): Promise<{ session: Session; needDoubleAuth: boolean; question?: string; propositions?: string[] }> {
  const gtk = await fetchGTK();

  const body: Record<string, unknown> = {
    identifiant,
    motdepasse,
    isRelogin: false,
    uuid: "",
  };
  if (fa && fa.length > 0) body.fa = fa;

  const encodedBody = `data=${encodeURIComponent(JSON.stringify(body))}`;

  const res = await fetch(`${BASE_URL}/v3/login.awp?v=${API_VERSION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      "X-Gtk": gtk,
      Cookie: `GTK=${gtk}`,
    },
    body: encodedBody,
  });

  const json = (await res.json()) as EDResponse<{
    accounts?: Array<{
      id: number;
      prenom: string;
      nom: string;
      profile?: { classe?: { libelle?: string } };
      token?: string;
    }>;
    question?: string;
    propositions?: string[];
    totp?: boolean;
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

  if (json.code === 505) throw new Error("Identifiant ou mot de passe invalide");
  if (json.code !== 200) throw new Error(`Erreur EcoleDirecte: ${json.message ?? json.code}`);

  const account = json.data?.accounts?.[0];
  if (!account) throw new Error("Aucun compte trouvé dans la réponse");

  _session = {
    token: json.token!,
    studentId: account.id,
    studentName: `${account.prenom} ${account.nom}`,
    className: account.profile?.classe?.libelle ?? "Classe inconnue",
    gtkCookie: gtk,
  };

  return { session: _session, needDoubleAuth: false };
}

// ── Double auth (QCM) ────────────────────────────────────────────────────────
export async function submitDoubleAuth(
  identifiant: string,
  motdepasse: string,
  choix: string,
  gtk: string,
  tempToken: string
): Promise<Session> {
  // 1. GET la question
  const getRes = await fetch(
    `${BASE_URL}/v3/connexion/doubleauth.awp?verbe=get&v=${API_VERSION}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "X-Token": tempToken,
        Cookie: `GTK=${gtk}`,
      },
      body: "data={}",
    }
  );
  const getJson = (await getRes.json()) as EDResponse<unknown>;
  if (getJson.code !== 200) throw new Error("Erreur récupération QCM");

  // 2. POST la réponse
  const choixB64 = Buffer.from(choix).toString("base64");
  const postRes = await fetch(
    `${BASE_URL}/v3/connexion/doubleauth.awp?verbe=post&v=${API_VERSION}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "X-Token": tempToken,
        Cookie: `GTK=${gtk}`,
      },
      body: `data=${encodeURIComponent(JSON.stringify({ choix: choixB64 }))}`,
    }
  );
  const postJson = (await postRes.json()) as EDResponse<{ cn: string; cv: string }>;
  if (postJson.code !== 200) throw new Error("Réponse incorrecte au QCM");

  const { cn, cv } = postJson.data;

  // 3. Re-login avec fa
  const result = await login(identifiant, motdepasse, [{ cn, cv }]);
  if (result.needDoubleAuth) throw new Error("Double auth toujours requise après QCM");
  return result.session;
}

// ── Request helper ───────────────────────────────────────────────────────────
export async function edRequest<T>(
  path: string,
  bodyData: Record<string, unknown> = {}
): Promise<T> {
  if (!_session) throw new Error("Non connecté. Utilisez d'abord la commande 'login'.");

  const res = await fetch(
    `${BASE_URL}/v3/${path}?verbe=get&v=${API_VERSION}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "X-Token": _session.token,
        Cookie: `GTK=${_session.gtkCookie}`,
      },
      body: `data=${encodeURIComponent(JSON.stringify(bodyData))}`,
    } as RequestInit
  );

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
