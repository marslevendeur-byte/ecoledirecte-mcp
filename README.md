# EcoleDirecte MCP

Serveur MCP pour EcoleDirecte — accès à l'emploi du temps, devoirs, notes, messages directement depuis Claude.

## Fonctionnalités

| Outil | Description |
|-------|-------------|
| `login` | Se connecter avec identifiant + mot de passe |
| `auth_status` | Vérifier l'état de la session |
| `logout` | Se déconnecter |
| `get_emploi_du_temps` | EDT de la semaine (ou période personnalisée) |
| `get_devoirs` | Liste des devoirs à venir / détail d'un jour |
| `get_notes` | Notes par période + filtre matière |
| `get_moyennes` | Récapitulatif des moyennes |
| `get_messages` | Messages reçus + lecture d'un message |

---

## Déploiement Railway (claude.ai + Claude Code)

### 1. Push sur GitHub

```bash
git init
git add .
git commit -m "feat: EcoleDirecte MCP server"
git remote add origin https://github.com/TON_USERNAME/ecoledirecte-mcp.git
git push -u origin main
```

### 2. Déployer sur Railway

1. Va sur [railway.app](https://railway.app) et connecte-toi avec GitHub
2. **New Project → Deploy from GitHub repo** → sélectionne `ecoledirecte-mcp`
3. Railway détecte automatiquement Node.js
4. Dans **Settings → Deploy** → Start Command : `npm run start:sse`
5. Dans **Variables** → ajoute :
   - `NODE_ENV` = `production`
   - `PORT` = `3000` (Railway l'injecte déjà automatiquement)

6. Railway génère une URL publique : `https://ecoledirecte-mcp-xxxx.up.railway.app`

### 3. Ajouter dans claude.ai

1. Paramètres → **Connecteurs personnalisés** → Ajouter
2. URL : `https://ecoledirecte-mcp-xxxx.up.railway.app/sse`
3. Type : **SSE**

### 4. Ajouter dans Claude Code

Dans `.claude/settings.json` ou `~/.claude/settings.json` :

```json
{
  "mcpServers": {
    "ecoledirecte": {
      "type": "sse",
      "url": "https://ecoledirecte-mcp-xxxx.up.railway.app/sse"
    }
  }
}
```

---

## Usage local (stdio — Claude Code uniquement)

```bash
npm install
npm run build
```

Config dans Claude Code :

```json
{
  "mcpServers": {
    "ecoledirecte": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/chemin/vers/ecoledirecte-mcp"
    }
  }
}
```

---

## Utilisation

Une fois connecté, parle naturellement à Claude :

> *"Montre-moi mon emploi du temps de la semaine"*
> *"Qu'est-ce que j'ai comme devoirs ?"*
> *"Quelle est ma moyenne en maths ?"*
> *"Lis mes derniers messages EcoleDirecte"*

### Première connexion

Claude appelera automatiquement `login` avec tes identifiants. Si EcoleDirecte demande une double authentification (QCM), Claude te posera la question et s'authentifiera automatiquement.

---

## Sécurité

- Les identifiants ne sont **jamais stockés** dans le code ni dans le repo
- La session est en mémoire uniquement (réinitialisée à chaque redémarrage)
- Sur Railway : ne mets **jamais** tes identifiants dans les variables d'environnement — utilise toujours `login` depuis Claude
- Le repo GitHub ne contient aucune donnée personnelle

---

## Stack

- TypeScript + Node.js 22
- `@modelcontextprotocol/sdk` — SDK officiel Anthropic
- Express (mode SSE)
- Compatible : claude.ai connecteur personnalisé + Claude Code
