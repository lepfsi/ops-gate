/** HostPicker  -  sites IA en chips groupées (UI compacte, pas un brouillon textarea) */
import { useMemo, useState } from "react"

const AI_HOST_PRESETS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "aistudio.google.com",
  "poe.com",
  "you.com",
  "chat.mistral.ai",
  "lechat.mistral.ai",
  "console.groq.com",
  "grok.x.ai",
  "grok.com",
  "huggingface.co",
  "phind.com",
  "meta.ai",
  "pi.ai",
  "character.ai",
  "notebooklm.google.com",
  "openrouter.ai",
  "together.ai",
  "fireworks.ai",
  "blackbox.ai",
  "chat.lmsys.org",
  "lmarena.ai",
  "typingmind.com",
  "chat.qwen.ai",
  "writesonic.com",
  "jasper.ai",
  "copy.ai",
  "notion.so",
  "platform.openai.com",
  "labs.google",
  "deepai.org",
  "sider.ai",
  "monica.im",
  "chatpdf.com",
  "consensus.app",
  "elicit.com"
]

const GROUPS: { title: string; hosts: string[] }[] = [
  {
    title: "Grands modèles",
    hosts: [
      "chatgpt.com",
      "chat.openai.com",
      "claude.ai",
      "gemini.google.com",
      "bard.google.com",
      "copilot.microsoft.com",
      "grok.com",
      "grok.x.ai",
      "meta.ai",
      "perplexity.ai"
    ]
  },
  {
    title: "Open source / cloud",
    hosts: [
      "chat.deepseek.com",
      "chat.mistral.ai",
      "lechat.mistral.ai",
      "console.groq.com",
      "huggingface.co",
      "openrouter.ai",
      "together.ai",
      "fireworks.ai",
      "aistudio.google.com",
      "labs.google"
    ]
  },
  {
    title: "Assistants & autres",
    hosts: [
      "poe.com",
      "you.com",
      "phind.com",
      "pi.ai",
      "character.ai",
      "notebooklm.google.com",
      "blackbox.ai",
      "chat.lmsys.org",
      "lmarena.ai",
      "typingmind.com",
      "chat.qwen.ai",
      "writesonic.com",
      "jasper.ai",
      "copy.ai",
      "notion.so",
      "platform.openai.com",
      "deepai.org",
      "sider.ai",
      "monica.im",
      "chatpdf.com",
      "consensus.app",
      "elicit.com"
    ]
  }
]

function normalizeHost(raw: string): string | null {
  const h = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
  if (!h || !h.includes(".")) return null
  return h
}

export function HostPicker({
  value,
  onChange
}: {
  value: string[]
  onChange: (hosts: string[]) => void
}) {
  const [custom, setCustom] = useState("")
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const set = useMemo(() => new Set(value), [value])
  const customHosts = value.filter((h) => !AI_HOST_PRESETS.includes(h))

  const toggle = (h: string) => {
    if (set.has(h)) onChange(value.filter((x) => x !== h))
    else onChange([...value, h])
  }

  const addCustom = () => {
    const h = normalizeHost(custom)
    if (!h) return
    if (!set.has(h)) onChange([...value, h])
    setCustom("")
  }

  const q = filter.trim().toLowerCase()
  const groupsFiltered = GROUPS.map((g) => ({
    ...g,
    hosts: q ? g.hosts.filter((h) => h.includes(q)) : g.hosts
  })).filter((g) => g.hosts.length > 0)

  return (
    <div className="host-picker">
      <div className="host-picker-head">
        <div className="host-picker-head-text">
          <span className="host-count-pill">
            {value.length} site{value.length !== 1 ? "s" : ""} actif
            {value.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="host-picker-actions">
          <button
            type="button"
            className={`btn secondary btn-sm ${open ? "host-manage-open" : ""}`}
            onClick={() => setOpen((v) => !v)}>
            {open ? "Replier" : "Gérer les sites"}
          </button>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => onChange([...AI_HOST_PRESETS])}
            title="Activer tous les presets">
            Tout
          </button>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => onChange([])}
            title="Vider la sélection">
            Aucun
          </button>
        </div>
      </div>

      {value.length > 0 ? (
        <div className="host-active-row" aria-label="Sites actuellement surveillés">
          {value.map((h) => (
            <button
              key={`act-${h}`}
              type="button"
              className="host-chip on"
              onClick={() => toggle(h)}
              title={`Retirer ${h}`}>
              {h}
              <span className="host-chip-x" aria-hidden>
                ×
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="host-empty muted">Aucun site  -  ouvrez « Gérer les sites ».</p>
      )}

      {open && (
        <div className="host-picker-body">
          <div className="host-picker-toolbar">
            <input
              className="input host-filter"
              placeholder="Filtrer (ex. claude, mistral…)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="host-add-row">
              <input
                className="input"
                placeholder="domaine-custom.ai"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addCustom()
                  }
                }}
              />
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={addCustom}>
                + Add AI
              </button>
            </div>
          </div>

          {groupsFiltered.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Aucun preset ne correspond au filtre.
            </p>
          ) : (
            groupsFiltered.map((g) => {
              const selectedInGroup = g.hosts.filter((h) => set.has(h)).length
              return (
                <div key={g.title} className="host-group">
                  <div className="host-group-title">
                    <span>{g.title}</span>
                    <span className="host-group-count">
                      {selectedInGroup}/{g.hosts.length}
                    </span>
                  </div>
                  <div className="host-chip-row">
                    {g.hosts.map((h) => (
                      <button
                        key={h}
                        type="button"
                        className={`host-chip ${set.has(h) ? "on" : ""}`}
                        onClick={() => toggle(h)}
                        aria-pressed={set.has(h)}>
                        {set.has(h) ? "✓ " : ""}
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })
          )}

          {customHosts.length > 0 && (
            <div className="host-group">
              <div className="host-group-title">
                <span>Personnalisés</span>
                <span className="host-group-count">{customHosts.length}</span>
              </div>
              <div className="host-chip-row">
                {customHosts.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="host-chip on"
                    onClick={() => toggle(h)}
                    title="Retirer">
                    ✓ {h}
                    <span className="host-chip-x" aria-hidden>
                      ×
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { AI_HOST_PRESETS }
