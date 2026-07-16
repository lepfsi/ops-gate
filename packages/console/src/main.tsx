import React from "react"
import ReactDOM from "react-dom/client"

import App from "./App"
import "./styles.css"

/**
 * Bureau concepteur (licences) :
 *
 * Dev (recommandé) :
 *   pnpm --filter @opsgate/console dev:vendor
 *   → http://127.0.0.1:5173/?desk=vendor
 *
 * Ou dev normal + flag (redémarrer Vite après export) :
 *   $env:VITE_OPSGATE_VENDOR_DESK="true"; pnpm console:dev
 *
 * Build client final : `pnpm console:build` SANS .env.vendor
 *   → VendorDesk non embarqué si VITE_OPSGATE_VENDOR_DESK absent.
 *
 * En dev (import.meta.env.DEV), ?desk=vendor active le bureau même sans flag
 * pour éviter les oublis d’env. En production, le flag est obligatoire.
 */
function wantsVendorUrl(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get("desk") === "vendor") return true
    const h = (window.location.hash || "").replace(/^#/, "")
    if (h === "vendor-desk" || h === "vendor") return true
  } catch {
    /* ignore */
  }
  return false
}

function vendorDeskAllowed(): boolean {
  const flag =
    import.meta.env.VITE_OPSGATE_VENDOR_DESK === "true" ||
    import.meta.env.VITE_OPSGATE_VENDOR_DESK === "1"
  // Lab / DailyOps : URL suffit en mode dev Vite
  if (import.meta.env.DEV && wantsVendorUrl()) return true
  return flag && wantsVendorUrl()
}

async function boot() {
  const root = document.getElementById("root")!
  if (vendorDeskAllowed()) {
    const { default: VendorDesk } = await import("./VendorDesk")
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <VendorDesk />
      </React.StrictMode>
    )
    return
  }
  // Si l’URL demande vendor mais le build client l’interdit → message clair
  if (wantsVendorUrl() && !import.meta.env.DEV) {
    root.innerHTML = `
      <div style="font-family:Segoe UI,sans-serif;max-width:480px;margin:48px auto;padding:24px">
        <h1 style="font-size:18px">Bureau concepteur indisponible</h1>
        <p style="color:#64748b;font-size:14px;line-height:1.5">
          Ce build console n’inclut pas le desk vendor (build client).
          Relancez avec le mode vendor :
        </p>
        <pre style="background:#f1f5f9;padding:12px;border-radius:8px;font-size:12px">pnpm --filter @opsgate/console dev:vendor
# puis http://127.0.0.1:5173/?desk=vendor</pre>
      </div>`
    return
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
