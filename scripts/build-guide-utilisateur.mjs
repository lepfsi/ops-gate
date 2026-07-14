/**
 * Génère docs/GUIDE-UTILISATEUR.docx depuis le contenu produit.
 * Usage: node scripts/build-guide-utilisateur.mjs
 */
import { writeFileSync, mkdirSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  LevelFormat,
  Header,
  Footer,
  PageNumber,
  BorderStyle
} from "docx"

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, "..", "docs", "GUIDE-UTILISATEUR.docx")

const navy = "0A1128"
const teal = "2BD9C5"

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, size: 32, font: "Arial", color: navy })]
  })
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, font: "Arial", color: navy })]
  })
}
function p(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 22, font: "Arial" })]
  })
}
function bullet(text, ref = "bullets") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, font: "Arial" })]
  })
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: navy },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: navy },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }
        ]
      }
    ]
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1008, right: 1008, bottom: 1008, left: 1008 }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 12, color: teal, space: 4 }
              },
              children: [
                new TextRun({
                  text: "OpsGate · Guide utilisateur V1",
                  size: 18,
                  font: "Arial",
                  color: "64748B"
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
                new TextRun({ text: "Page ", size: 18, font: "Arial", color: "64748B" }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 18,
                  font: "Arial",
                  color: "64748B"
                })
              ]
            })
          ]
        })
      },
      children: [
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: "OpsGate",
              bold: true,
              size: 48,
              font: "Arial",
              color: navy
            })
          ]
        }),
        new Paragraph({
          spacing: { after: 240 },
          children: [
            new TextRun({
              text: "Guide utilisateur — Console, extension, policies, licences, logs & recovery",
              size: 24,
              font: "Arial",
              color: "334155"
            })
          ]
        }),
        p(
          "Public : administrateurs console, pilotes, support. Version produit 1.2. Pour l’installation technique (Docker, ports), voir GUIDE-STACK-LOCALE.md."
        ),

        h1("1. Vue d’ensemble"),
        bullet("Extension : détection sur sites IA, application de la policy, journal des décisions"),
        bullet("API (control plane) : enroll, sync, events, authentification console"),
        bullet("Console : dashboard, policy, agents, packs, événements, audit"),
        bullet("Postgres : stockage durable (recommandé en pilote / production)"),
        p(
          "Sans DATABASE_URL, l’API utilise un store mémoire : toutes les données sont perdues au redémarrage."
        ),

        h1("2. Connexion console"),
        bullet("Démarrer l’API (et Postgres si utilisé)"),
        bullet("Ouvrir la console, se connecter avec l’email principal"),
        bullet("Changer le mot de passe à la première connexion si demandé"),
        bullet("Options avancées : afficher l’URL API uniquement si besoin"),
        p("Session unique par compte ; une seconde session propose de forcer la déconnexion."),

        h1("3. Enrôlement (extension)"),
        h2("Organisation"),
        bullet("Options OpsGate → URL API + code organisation + label appareil → Enrôler"),
        bullet("Après sync : policies gérées par l’org ; hors ligne = dernière policy reçue"),
        h2("Désinscription"),
        p(
          "Si la policy l’exige : identifiant + mot de passe administrateur. Recovery concepteur réservé au principal / support (voir RECOVERY-CONCEPTEUR.md)."
        ),

        h1("4. Policy"),
        bullet("Policy org par défaut : agents licenciés sans profil / groupe"),
        bullet("Sites IA, action (warn / mask_recommend / mask_force / block), events, messages bandeau"),
        bullet("Profils département : créer un profil, l’assigner via groupes"),
        p("Enregistrer puis synchroniser (ou attendre le poll ≤ 2 min)."),

        h1("5. Licences"),
        bullet("Un siège = un agent protégé"),
        bullet("Sans siège : grâce puis unlicensed (protection inactive)"),
        bullet("Dashboard : listes Licensed / Grace / UNLICENSED"),

        h1("6. Packs de règles"),
        p(
          "Jeu de signatures de détection poussé aux agents sans rebuild. Publier = nouvelle version ; Activer = version reçue au sync."
        ),

        h1("7. Événements & export"),
        bullet("Décisions : mask_send, send_anyway, cancel, enroll, unenroll"),
        bullet("Rétention définie par l’entreprise (Monitoring → jours)"),
        bullet("Export CSV semaine / tout ; archives auto fin de semaine si activées"),
        bullet("Audit admin (principal) : export CSV des actions console"),
        p("Raccourci console : touche / pour focus du filtre de recherche événements."),

        h1("8. Recovery concepteur"),
        bullet("Secret fort OPSGATE_VENDOR_RECOVERY ; délai offline ≥ 2 h"),
        bullet("Cible V1.x : pool de codes one-time (RECOVERY-CONCEPTEUR.md)"),
        p("OTP principal et Recovery : bas de page Admins & groupes (principal uniquement)."),

        h1("9. Pourquoi les données peuvent disparaître"),
        bullet("API sans DATABASE_URL → mémoire → vide au restart"),
        bullet("docker compose down -v → volume Postgres détruit"),
        bullet("Rétention logs courte → purge des anciens events"),
        bullet("Le seed DEMO ne s’exécute que si l’org n’existe pas encore"),
        p(
          "Checklist durable : docker compose up -d ; DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate ; pnpm api:dev ; vérifier store=postgres dans les logs."
        ),

        h1("10. Documents liés"),
        bullet("GUIDE-STACK-LOCALE.md — Docker, ports, build"),
        bullet("RECOVERY-CONCEPTEUR.md — pool one-time offline"),
        bullet("RULE-PACKS.md, RUNBOOK-OPS.md, PRIVACY.md"),

        new Paragraph({
          spacing: { before: 400 },
          children: [
            new TextRun({
              text: "OpsGate V1 · Guide utilisateur · référence produit",
              italics: true,
              size: 18,
              font: "Arial",
              color: "64748B"
            })
          ]
        })
      ]
    }
  ]
})

mkdirSync(dirname(out), { recursive: true })
const buf = await Packer.toBuffer(doc)
writeFileSync(out, buf)
console.log("Wrote", out)
