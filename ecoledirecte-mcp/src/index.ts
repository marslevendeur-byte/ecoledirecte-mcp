import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  handleLogin,
  handleLogout,
  handleStatus,
  handleEmploiDuTemps,
  handleDevoirs,
  handleNotes,
  handleMessages,
  handleMessageDetail,
  handleMoyennes,
} from "./tools.js";

const server = new McpServer({
  name: "ecoledirecte-mcp",
  version: "1.0.0",
});

// ── login ────────────────────────────────────────────────────────────────────
server.tool(
  "login",
  "Se connecter à EcoleDirecte avec identifiant et mot de passe",
  {
    identifiant: z.string().describe("Identifiant EcoleDirecte"),
    motdepasse: z.string().describe("Mot de passe EcoleDirecte"),
    cn: z.string().optional().describe("Token double auth cn (depuis les cookies du navigateur)"),
    cv: z.string().optional().describe("Token double auth cv (depuis les cookies du navigateur)"),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleLogin(args) }],
  })
);

// ── logout ───────────────────────────────────────────────────────────────────
server.tool("logout", "Se déconnecter de EcoleDirecte", {}, async () => ({
  content: [{ type: "text", text: await handleLogout() }],
}));

// ── status ───────────────────────────────────────────────────────────────────
server.tool("auth_status", "Vérifier l'état de la connexion EcoleDirecte", {}, async () => ({
  content: [{ type: "text", text: await handleStatus() }],
}));

// ── emploi du temps ──────────────────────────────────────────────────────────
server.tool(
  "get_emploi_du_temps",
  "Obtenir l'emploi du temps. Sans paramètres = semaine en cours.",
  {
    date_debut: z
      .string()
      .optional()
      .describe("Date de début (YYYY-MM-DD). Défaut: lundi de la semaine courante"),
    date_fin: z
      .string()
      .optional()
      .describe("Date de fin (YYYY-MM-DD). Défaut: vendredi de la semaine courante"),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleEmploiDuTemps(args) }],
  })
);

// ── devoirs ──────────────────────────────────────────────────────────────────
server.tool(
  "get_devoirs",
  "Lister les devoirs à venir ou obtenir le détail d'un jour précis",
  {
    date: z
      .string()
      .optional()
      .describe("Date pour afficher les devoirs détaillés (YYYY-MM-DD). Sans date = tous les devoirs à venir"),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleDevoirs(args) }],
  })
);

// ── notes ────────────────────────────────────────────────────────────────────
server.tool(
  "get_notes",
  "Consulter les notes d'une période (trimestre). Filtre optionnel par matière.",
  {
    matiere: z
      .string()
      .optional()
      .describe("Filtrer par matière (ex: 'maths', 'français')"),
    periode: z
      .string()
      .optional()
      .describe("Code ou nom de la période (ex: 'A001', '1er Trimestre'). Défaut: période en cours"),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleNotes(args) }],
  })
);

// ── moyennes ─────────────────────────────────────────────────────────────────
server.tool(
  "get_moyennes",
  "Voir le récapitulatif de toutes les moyennes par matière et par période",
  {},
  async () => ({
    content: [{ type: "text", text: await handleMoyennes() }],
  })
);

// ── messages ─────────────────────────────────────────────────────────────────
server.tool(
  "get_messages",
  "Lire les messages reçus sur EcoleDirecte",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Nombre maximum de messages à afficher (défaut: 10)"),
    id: z
      .number()
      .int()
      .optional()
      .describe("ID d'un message pour lire son contenu complet"),
  },
  async (args) => ({
    content: [
      {
        type: "text",
        text: args.id
          ? await handleMessageDetail({ id: args.id })
          : await handleMessages(args),
      },
    ],
  })
);

// ── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("✅ EcoleDirecte MCP server démarré (stdio)");

