import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Stocke les transports actifs par session
const transports = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ecoledirecte-mcp",
    version: "1.0.0",
  });

  server.tool(
    "login",
    "Se connecter à EcoleDirecte avec identifiant et mot de passe",
    {
      identifiant: z.string().describe("Identifiant EcoleDirecte"),
      motdepasse: z.string().describe("Mot de passe EcoleDirecte"),
    },
    async (args) => ({
      content: [{ type: "text", text: await handleLogin(args) }],
    })
  );

  server.tool("logout", "Se déconnecter de EcoleDirecte", {}, async () => ({
    content: [{ type: "text", text: await handleLogout() }],
  }));

  server.tool("auth_status", "Vérifier l'état de la connexion EcoleDirecte", {}, async () => ({
    content: [{ type: "text", text: await handleStatus() }],
  }));

  server.tool(
    "get_emploi_du_temps",
    "Obtenir l'emploi du temps. Sans paramètres = semaine en cours.",
    {
      date_debut: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
      date_fin: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await handleEmploiDuTemps(args) }],
    })
  );

  server.tool(
    "get_devoirs",
    "Lister les devoirs à venir ou obtenir le détail d'un jour précis",
    {
      date: z.string().optional().describe("Date (YYYY-MM-DD) pour voir les détails d'un jour"),
    },
    async (args) => ({
      content: [{ type: "text", text: await handleDevoirs(args) }],
    })
  );

  server.tool(
    "get_notes",
    "Consulter les notes d'une période. Filtre optionnel par matière.",
    {
      matiere: z.string().optional().describe("Filtrer par matière"),
      periode: z.string().optional().describe("Code ou nom de la période"),
    },
    async (args) => ({
      content: [{ type: "text", text: await handleNotes(args) }],
    })
  );

  server.tool(
    "get_moyennes",
    "Voir le récapitulatif de toutes les moyennes par matière et par période",
    {},
    async () => ({
      content: [{ type: "text", text: await handleMoyennes() }],
    })
  );

  server.tool(
    "get_messages",
    "Lire les messages reçus sur EcoleDirecte",
    {
      limit: z.number().int().min(1).max(50).optional().describe("Nombre de messages (défaut: 10)"),
      id: z.number().int().optional().describe("ID message pour lire son contenu complet"),
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

  return server;
}

// ── SSE endpoint ─────────────────────────────────────────────────────────────
app.get("/sse", async (req, res) => {
  const server = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  res.on("close", () => {
    transports.delete(sessionId);
  });

  await server.connect(transport);
});

// ── Messages endpoint ─────────────────────────────────────────────────────────
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "ecoledirecte-mcp", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`🚀 EcoleDirecte MCP SSE server sur http://0.0.0.0:${PORT}`);
  console.log(`   SSE endpoint: http://0.0.0.0:${PORT}/sse`);
});
