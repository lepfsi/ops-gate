/**
 * Génère GUIDE-UTILISATEUR (FR) et GUIDE-UTILISATEUR-EN (EN) en .docx
 * En-tête style PDF d'origine : « OpsGate | Guide utilisateur V1 »
 * Pied de page : « Page X/Y - DailyOps.Tech »
 * Contenu simple, orienté utilisateur final + checklist démarrage durable.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  AlignmentType,
  LevelFormat
} from "docx"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const docs = path.join(root, "docs")

const navy = "0A1128"
const accent = "2BD9C5"
const muted = "64748B"
const line = "E2E8F0"
const soft = "F8FAFC"
const TW = 10080 // A4 content width ~ (11906 - 2*912)

const border = { style: BorderStyle.SINGLE, size: 4, color: line }
const borders = { top: border, bottom: border, left: border, right: border }

function cell(text, w, opts = {}) {
  const { header, fill } = opts
  return new TableCell({
    borders,
    width: { size: w, type: WidthType.DXA },
    shading: fill
      ? { fill, type: ShadingType.CLEAR }
      : header
        ? { fill: navy, type: ShadingType.CLEAR }
        : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text),
            bold: !!header,
            size: 17,
            font: "Arial",
            color: header ? "FFFFFF" : navy
          })
        ]
      })
    ]
  })
}

function table(headers, rows, colW) {
  const widths = [...(colW || headers.map(() => Math.floor(TW / headers.length)))]
  const sum = widths.slice(0, -1).reduce((a, b) => a + b, 0)
  widths[widths.length - 1] = TW - sum
  return new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: headers.map((h, i) => cell(h, widths[i], { header: true }))
      }),
      ...rows.map((r, ri) =>
        new TableRow({
          children: r.map((c, i) =>
            cell(c, widths[i], { fill: ri % 2 ? soft : "FFFFFF" })
          )
        })
      )
    ]
  })
}

function h1(t) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 120 },
    children: [
      new TextRun({ text: t, bold: true, size: 26, font: "Arial", color: navy })
    ]
  })
}

function h2(t) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 80 },
    children: [
      new TextRun({
        text: t,
        bold: true,
        size: 22,
        font: "Arial",
        color: navy
      })
    ]
  })
}

function p(t) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: t, size: 20, font: "Arial", color: navy })]
  })
}

function meta(label, value) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({
        text: label + " : ",
        bold: true,
        size: 18,
        font: "Arial",
        color: muted
      }),
      new TextRun({ text: value, size: 18, font: "Arial", color: navy })
    ]
  })
}

function bullet(t, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 50 },
    children: [new TextRun({ text: t, size: 20, font: "Arial", color: navy })]
  })
}

function codeBlock(lines) {
  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 20 },
        shading: { fill: soft, type: ShadingType.CLEAR },
        children: [
          new TextRun({
            text: line,
            size: 17,
            font: "Consolas",
            color: navy
          })
        ]
      })
  )
}

function spacer() {
  return new Paragraph({
    spacing: { after: 60 },
    children: []
  })
}

/** Contenu FR — simple, style guide PDF d'origine + MAJ V1.2 */
function contentFr(B) {
  return [
    new Paragraph({
      spacing: { after: 120 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 6 }
      },
      children: [
        new TextRun({
          text: "OpsGate — Guide utilisateur (V1)",
          bold: true,
          size: 32,
          font: "Arial",
          color: navy
        })
      ]
    }),
    meta("Public", "administrateurs console, pilotes, support"),
    meta("Version produit", "1.2"),
    meta("Langue", "français"),
    spacer(),
    p(
      "Ce guide décrit l'usage quotidien d'OpsGate : extension, console, enrôlement, policies, licences, logs et recovery. Pour l'installation technique locale (Docker, ports), voir aussi GUIDE-STACK-LOCALE."
    ),

    h1("1. Vue d'ensemble"),
    table(
      ["Composant", "Rôle"],
      [
        [
          "Extension",
          "Détecte les données sensibles sur les sites IA, applique la policy, journalise les décisions"
        ],
        [
          "API (control plane)",
          "Enrôlement, sync policy/packs, events, authentification console"
        ],
        [
          "Console",
          "Administration : dashboard, policy, agents, packs, événements, audit"
        ],
        ["Postgres", "Stockage durable (recommandé en pilote / prod)"]
      ],
      [2600, 7480]
    ),
    spacer(),
    p(
      "Sans Postgres, l'API utilise un store mémoire : toutes les données sont perdues au redémarrage."
    ),

    h1("2. Première connexion console"),
    bullet("Démarrer l'API (et Postgres si utilisé).", B),
    bullet("Ouvrir la console (ex. http://127.0.0.1:5173).", B),
    bullet(
      "Se connecter avec l'email principal et le mot de passe d'installation.",
      B
    ),
    bullet(
      "Changer le mot de passe à la première connexion si demandé.",
      B
    ),
    spacer(),
    p(
      "Mode avancé (login) : le champ URL API est masqué par défaut ; l'activer uniquement pour pointer une autre instance."
    ),
    p(
      "Session unique par compte : une seconde connexion propose « Forcer la déconnexion »."
    ),
    p(
      "Mauvais mot de passe : le message indique combien d'essais restent (ex. « Invalid. Il vous reste 3 essais. »). Après trop d'échecs, le compte est verrouillé — un administrateur principal le débloque dans Admins & groupes."
    ),

    h1("3. Enrôlement (extension)"),
    h2("Organisation"),
    bullet("Options de l'extension OpsGate.", B),
    bullet(
      "Saisir l'URL API et le code organisation (ex. DEMO-OPSGATE).",
      B
    ),
    bullet("Nommer l'appareil (label).", B),
    bullet("Enrôler.", B),
    spacer(),
    p("Après un sync réussi :"),
    bullet(
      "les policies sont gérées par l'org (non modifiables localement) ;",
      B
    ),
    bullet(
      "la protection reste active hors ligne avec la dernière policy reçue.",
      B
    ),
    h2("Personnel"),
    p(
      "Clé de licence personnelle → mode personnel (pas de télémétrie org vers la console)."
    ),
    h2("Désinscription"),
    p(
      "Si la policy l'exige : identifiant + mot de passe administrateur. Recovery concepteur : réservé au principal / support (voir §8)."
    ),

    h1("4. Tableau de bord"),
    p(
      "Vue d'ensemble de la flotte : licences, agents connectés, décisions, menaces fréquentes."
    ),
    bullet(
      "Cliquez un indicateur pour voir le détail (liste d'agents ou logs).",
      B
    ),
    bullet(
      "Étendre : les graphiques remplissent l'écran de contenu (barre du haut et menu de gauche restent visibles).",
      B
    ),
    bullet("Réduire : retour à la vue normale.", B),
    bullet(
      "Force sync : pousse la configuration aux agents en ligne (effet sous ~2 min).",
      B
    ),

    h1("5. Policy"),
    h2("Policy org par défaut"),
    p(
      "S'applique aux agents licenciés sans profil / groupe spécifique."
    ),
    bullet(
      "Sites IA : catalogue par groupes + sites personnalisés",
      B
    ),
    bullet(
      "Action par défaut : warn | mask_recommend | mask_force | block",
      B
    ),
    bullet("Collecte d'events : on/off", B),
    bullet("Messages utilisateur : textes du bandeau (optionnel)", B),
    spacer(),
    p(
      "Enregistrer puis Synchroniser (ou attendre le poll ≤ 2 min)."
    ),
    h2("Policies par département (profils)"),
    bullet("Créer un profil (ex. Finance).", B),
    bullet("Assigner via groupes (ou agent).", B),
    bullet("Les agents du groupe héritent du profil.", B),
    bullet("Vous pouvez désactiver un profil sans le supprimer.", B),

    h1("6. Licences"),
    bullet("Un siège = un agent protégé.", B),
    bullet(
      "Sans siège : période de grâce (24 h), puis protection inactive (unlicensed).",
      B
    ),
    bullet(
      "L'assignation à un groupe (ou manuelle) active en général le siège.",
      B
    ),
    bullet(
      "Essai : 30 jours à la création de l'organisation.",
      B
    ),
    bullet(
      "Licence full : clé du type OPS-XXXX-XXXX-XXXX-XXXX (Paramètres → Licences).",
      B
    ),
    bullet("Dashboard : listes Licensed / Grace / UNLICENSED.", B),

    h1("7. Packs de règles"),
    p(
      "Un pack est le jeu de signatures de détection poussé aux agents sans rebuilder l'extension."
    ),
    bullet(
      "Publier : nouvelle version (éventuellement sans certaines règles bruyantes).",
      B
    ),
    bullet("Activer : version reçue au prochain sync.", B),

    h1("8. Admins, recovery & paramètres"),
    h2("Admins & groupes"),
    bullet(
      "Plusieurs administrateurs ; un ou plusieurs principals (accès complet).",
      B
    ),
    bullet(
      "Modifier un compte · Nouveau mdp · Déverrouiller · supprimer (selon droits).",
      B
    ),
    bullet("Groupes pour lier agents et profils policy.", B),
    h2("Recovery concepteur"),
    table(
      ["Phase", "Pratique"],
      [
        [
          "Actuel",
          "Secret fort OPSGATE_VENDOR_RECOVERY ; délai offline ≥ 2 h"
        ],
        [
          "Recommandé V1.x",
          "Pool de codes one-time (bas de page Admins & groupes, principal uniquement)"
        ]
      ],
      [2400, 7680]
    ),
    spacer(),
    h2("Paramètres utiles"),
    bullet(
      "Langue FR / EN (Paramètres → Général) — s'applique à toute la console.",
      B
    ),
    bullet("Rétention des logs (défaut 90 jours) et types de journaux.", B),
    bullet("Seuil d'échecs de login (verrouillage compte).", B),
    bullet(
      "Monitoring : seuils online / hors-ligne ; planning heures de travail.",
      B
    ),

    h1("9. Événements (logs) & export"),
    p(
      "Décisions typiques : mask_send, send_anyway, cancel, enroll / unenroll."
    ),
    h2("Rétention"),
    bullet("Définie par l'entreprise (Paramètres → logs).", B),
    bullet("Au-delà : purge automatique.", B),
    bullet(
      "Exporter la semaine, tout, ou une période (CSV / JSON).",
      B
    ),
    bullet("Archive auto fin de semaine si activée.", B),
    h2("Audit admin"),
    p(
      "Journal des actions console (policy, profils, admins, packs…). Réservé au principal. Export disponible."
    ),

    h1("10. Monitoring & horaires"),
    bullet("Seuils online / not connected long time", B),
    bullet(
      "Planning (fuseau, jours, pauses) pour ne pas alerter hors heures",
      B
    ),
    bullet("Rétention logs + archive hebdo", B),
    spacer(),
    p(
      "Fuseaux : Europe, Cameroun (Africa/Douala), Madagascar (Africa/Antananarivo), etc."
    ),

    h1("11. Règles d'affectation"),
    p(
      "Règles auto (label / hostname → groupe), conditions en AND, priorité ordonnée. Appliquées à l'enroll et via « Ré-évaluer »."
    ),

    h1("12. Données & base — pourquoi tout peut « disparaître »"),
    table(
      ["Cause", "Effet", "Prévention"],
      [
        [
          "API sans base Postgres",
          "Store mémoire → vide au restart",
          "Toujours démarrer Postgres"
        ],
        [
          "docker compose down -v",
          "Volume Postgres détruit",
          "Ne pas utiliser -v en pilote"
        ],
        [
          "Nouveau volume / autre machine",
          "DB « vide » + re-seed DEMO",
          "Vérifier le volume Docker"
        ],
        [
          "Rétention logs courte",
          "Events anciens purgés",
          "Ajuster la rétention ; exporter avant"
        ],
        [
          "Redémarrage API en mémoire",
          "Perte agents, events, admins",
          "Passer à Postgres"
        ]
      ],
      [3000, 3540, 3540]
    ),
    spacer(),
    p(
      "Le seed DEMO-OPSGATE ne s'exécute que si l'org n'existe pas encore : il ne réécrit pas une org déjà présente."
    ),
    h2("Checklist démarrage durable"),
    ...codeBlock([
      "docker compose up -d",
      '$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"',
      "pnpm api:dev",
      "pnpm console:dev"
    ]),
    spacer(),
    p("Vérifier le log API : store=postgres (et non memory)."),

    h1("13. Raccourcis console (V1)"),
    table(
      ["Action", "Détail"],
      [
        ["/", "Focus recherche / filtre événements (onglet Événements)"],
        ["Thème", "Clair / sombre sur le bandeau d'état"]
      ],
      [2200, 7880]
    ),

    h1("14. Support & docs liées"),
    table(
      ["Document", "Contenu"],
      [
        ["GUIDE-STACK-LOCALE", "Docker, ports, build extension"],
        ["RECOVERY-CONCEPTEUR", "Pool one-time, offline"],
        ["RULE-PACKS", "Packs de règles"],
        ["RUNBOOK-OPS", "Exploitation"],
        ["PRIVACY", "Modes & privacy"]
      ],
      [3200, 6880]
    ),
    spacer(),
    p(
      "Contact support : contact@dailyops.tech (indiquer le code organisation et la version)."
    ),
    spacer(),
    new Paragraph({
      spacing: { before: 200 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "OpsGate V1 · Guide utilisateur · document de référence produit",
          size: 16,
          font: "Arial",
          color: muted,
          italics: true
        })
      ]
    })
  ]
}

/** Contenu EN — même structure, simple */
function contentEn(B) {
  return [
    new Paragraph({
      spacing: { after: 120 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 6 }
      },
      children: [
        new TextRun({
          text: "OpsGate — User Guide (V1)",
          bold: true,
          size: 32,
          font: "Arial",
          color: navy
        })
      ]
    }),
    meta("Audience", "console administrators, pilots, support"),
    meta("Product version", "1.2"),
    meta("Language", "English"),
    spacer(),
    p(
      "This guide covers day-to-day OpsGate use: extension, console, enrollment, policies, licenses, logs, and recovery. For local technical setup (Docker, ports), see also GUIDE-STACK-LOCALE."
    ),

    h1("1. Overview"),
    table(
      ["Component", "Role"],
      [
        [
          "Extension",
          "Detects sensitive data on AI sites, applies policy, logs decisions"
        ],
        [
          "API (control plane)",
          "Enrollment, policy/pack sync, events, console authentication"
        ],
        [
          "Console",
          "Administration: dashboard, policy, agents, packs, events, audit"
        ],
        ["Postgres", "Durable storage (recommended for pilot / production)"]
      ],
      [2600, 7480]
    ),
    spacer(),
    p(
      "Without Postgres, the API uses an in-memory store: all data is lost on restart."
    ),

    h1("2. First console sign-in"),
    bullet("Start the API (and Postgres if used).", B),
    bullet("Open the console (e.g. http://127.0.0.1:5173).", B),
    bullet(
      "Sign in with the principal email and install password.",
      B
    ),
    bullet("Change the password on first login if prompted.", B),
    spacer(),
    p(
      "Advanced (login): the API URL field is hidden by default; enable it only to point at another instance."
    ),
    p(
      "Single session: a second sign-in offers “Force sign-out”."
    ),
    p(
      "Wrong password: the message shows how many attempts remain (e.g. “Invalid. You have 3 attempt(s) remaining.”). After too many failures, the account is locked — a principal admin unlocks it under Admins & groups."
    ),

    h1("3. Enrollment (extension)"),
    h2("Organization"),
    bullet("OpsGate extension options.", B),
    bullet(
      "Enter the API URL and organization code (e.g. DEMO-OPSGATE).",
      B
    ),
    bullet("Name the device (label).", B),
    bullet("Enroll.", B),
    spacer(),
    p("After a successful sync:"),
    bullet(
      "policies are managed by the org (not editable locally);",
      B
    ),
    bullet(
      "protection stays active offline with the last policy received.",
      B
    ),
    h2("Personal"),
    p(
      "Personal license key → personal mode (no org telemetry to the console)."
    ),
    h2("Unenroll"),
    p(
      "If policy requires it: admin identifier + password. Vendor recovery: principal / support only (see §8)."
    ),

    h1("4. Dashboard"),
    p(
      "Fleet overview: licenses, connected agents, decisions, top threats."
    ),
    bullet(
      "Click an indicator for detail (agent list or logs).",
      B
    ),
    bullet(
      "Expand: charts fill the content area (top bar and left menu stay visible).",
      B
    ),
    bullet("Collapse: back to the normal view.", B),
    bullet(
      "Force sync: pushes config to online agents (effect within ~2 min).",
      B
    ),

    h1("5. Policy"),
    h2("Default org policy"),
    p(
      "Applies to licensed agents without a specific profile / group."
    ),
    bullet("AI sites: catalog by groups + custom sites", B),
    bullet(
      "Default action: warn | mask_recommend | mask_force | block",
      B
    ),
    bullet("Event collection: on/off", B),
    bullet("User messages: banner texts (optional)", B),
    spacer(),
    p("Save then Sync (or wait for poll ≤ 2 min)."),
    h2("Department policies (profiles)"),
    bullet("Create a profile (e.g. Finance).", B),
    bullet("Assign via groups (or agent).", B),
    bullet("Agents in the group inherit the profile.", B),
    bullet("You can disable a profile without deleting it.", B),

    h1("6. Licenses"),
    bullet("One seat = one protected agent.", B),
    bullet(
      "Without a seat: grace period (24 h), then inactive protection (unlicensed).",
      B
    ),
    bullet(
      "Assigning to a group (or manually) usually activates the seat.",
      B
    ),
    bullet("Trial: 30 days from organization creation.", B),
    bullet(
      "Full license: key like OPS-XXXX-XXXX-XXXX-XXXX (Settings → Licenses).",
      B
    ),
    bullet("Dashboard: Licensed / Grace / UNLICENSED lists.", B),

    h1("7. Rule packs"),
    p(
      "A pack is the detection signature set pushed to agents without rebuilding the extension."
    ),
    bullet(
      "Publish: new version (optionally without noisy rules).",
      B
    ),
    bullet("Activate: version received on next sync.", B),

    h1("8. Admins, recovery & settings"),
    h2("Admins & groups"),
    bullet(
      "Multiple administrators; one or more principals (full access).",
      B
    ),
    bullet(
      "Edit account · New password · Unlock · delete (by role).",
      B
    ),
    bullet("Groups link agents and policy profiles.", B),
    h2("Vendor recovery"),
    table(
      ["Phase", "Practice"],
      [
        [
          "Current",
          "Strong secret OPSGATE_VENDOR_RECOVERY; offline delay ≥ 2 h"
        ],
        [
          "Recommended V1.x",
          "One-time code pool (bottom of Admins & groups, principal only)"
        ]
      ],
      [2400, 7680]
    ),
    spacer(),
    h2("Useful settings"),
    bullet(
      "Language FR / EN (Settings → General) — applies to the whole console.",
      B
    ),
    bullet("Log retention (default 90 days) and log types.", B),
    bullet("Login failure threshold (account lockout).", B),
    bullet(
      "Monitoring: online / long offline thresholds; work-hours schedule.",
      B
    ),

    h1("9. Events (logs) & export"),
    p(
      "Typical decisions: mask_send, send_anyway, cancel, enroll / unenroll."
    ),
    h2("Retention"),
    bullet("Set by the organization (Settings → logs).", B),
    bullet("Beyond retention: automatic purge.", B),
    bullet("Export week, all, or a custom range (CSV / JSON).", B),
    bullet("Optional weekly archive before purge.", B),
    h2("Admin audit"),
    p(
      "Journal of console actions (policy, profiles, admins, packs…). Principal only. Export available."
    ),

    h1("10. Monitoring & schedule"),
    bullet("Online / not connected long time thresholds", B),
    bullet(
      "Schedule (timezone, days, breaks) to avoid off-hours alerts",
      B
    ),
    bullet("Log retention + weekly archive", B),
    spacer(),
    p(
      "Timezones: Europe, Cameroon (Africa/Douala), Madagascar (Africa/Antananarivo), etc."
    ),

    h1("11. Assignment rules"),
    p(
      "Auto rules (label / hostname → group), AND conditions, ordered priority. Applied at enroll and via “Re-evaluate”."
    ),

    h1('12. Data & database — why everything can "disappear"'),
    table(
      ["Cause", "Effect", "Prevention"],
      [
        [
          "API without Postgres",
          "Memory store → empty on restart",
          "Always start Postgres"
        ],
        [
          "docker compose down -v",
          "Postgres volume destroyed",
          "Do not use -v in pilot"
        ],
        [
          "New volume / other machine",
          "“Empty” DB + DEMO re-seed",
          "Check Docker volume"
        ],
        [
          "Short log retention",
          "Old events purged",
          "Adjust retention; export first"
        ],
        [
          "API restart in memory mode",
          "Loss of agents, events, admins",
          "Move to Postgres"
        ]
      ],
      [3000, 3540, 3540]
    ),
    spacer(),
    p(
      "The DEMO-OPSGATE seed runs only if the org does not exist yet: it does not overwrite an existing org."
    ),
    h2("Durable startup checklist"),
    ...codeBlock([
      "docker compose up -d",
      '$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"',
      "pnpm api:dev",
      "pnpm console:dev"
    ]),
    spacer(),
    p("Check the API log: store=postgres (not memory)."),

    h1("13. Console shortcuts (V1)"),
    table(
      ["Action", "Detail"],
      [
        ["/", "Focus events search / filter (Events tab)"],
        ["Theme", "Light / dark on the status strip"]
      ],
      [2200, 7880]
    ),

    h1("14. Support & related docs"),
    table(
      ["Document", "Content"],
      [
        ["GUIDE-STACK-LOCALE", "Docker, ports, extension build"],
        ["RECOVERY-CONCEPTEUR", "One-time pool, offline"],
        ["RULE-PACKS", "Rule packs"],
        ["RUNBOOK-OPS", "Operations"],
        ["PRIVACY", "Modes & privacy"]
      ],
      [3200, 6880]
    ),
    spacer(),
    p(
      "Support contact: contact@dailyops.tech (include organization code and version)."
    ),
    spacer(),
    new Paragraph({
      spacing: { before: 200 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "OpsGate V1 · User guide · product reference",
          size: 16,
          font: "Arial",
          color: muted,
          italics: true
        })
      ]
    })
  ]
}

function buildDoc({ headerTitle, bulletsRef, children }) {
  return new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 26, bold: true, font: "Arial", color: navy },
          paragraph: {
            spacing: { before: 280, after: 120 },
            outlineLevel: 0
          }
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 22, bold: true, font: "Arial", color: navy },
          paragraph: {
            spacing: { before: 180, after: 80 },
            outlineLevel: 1
          }
        }
      ]
    },
    numbering: {
      config: [
        {
          reference: bulletsRef,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            // A4
            size: { width: 11906, height: 16838 },
            margin: { top: 1008, right: 912, bottom: 1008, left: 912 }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [
                  new TextRun({
                    text: headerTitle,
                    bold: true,
                    size: 18,
                    font: "Arial",
                    color: navy
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "Page ",
                    size: 16,
                    font: "Arial",
                    color: muted
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    font: "Arial",
                    color: muted
                  }),
                  new TextRun({
                    text: "/",
                    size: 16,
                    font: "Arial",
                    color: muted
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    font: "Arial",
                    color: muted
                  }),
                  new TextRun({
                    text: " - DailyOps.Tech",
                    size: 16,
                    font: "Arial",
                    color: muted
                  })
                ]
              })
            ]
          })
        },
        children
      }
    ]
  })
}

async function writeDoc(doc, filename) {
  const out = path.join(docs, filename)
  const buf = await Packer.toBuffer(doc)
  fs.writeFileSync(out, buf)
  console.log("Wrote", out, buf.length, "bytes")
  return out
}

const fr = buildDoc({
  headerTitle: "OpsGate | Guide utilisateur V1",
  bulletsRef: "bullets-fr",
  children: contentFr("bullets-fr")
})

const en = buildDoc({
  headerTitle: "OpsGate | User Guide V1",
  bulletsRef: "bullets-en",
  children: contentEn("bullets-en")
})

await writeDoc(fr, "GUIDE-UTILISATEUR.docx")
await writeDoc(en, "GUIDE-UTILISATEUR-EN.docx")
console.log("DOCX OK")
