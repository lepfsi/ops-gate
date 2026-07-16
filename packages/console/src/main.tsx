import React from "react"
import ReactDOM from "react-dom/client"

import App from "./App"
import "./styles.css"

/**
 * Bureau concepteur (licences) :
 * - Uniquement si build interne : VITE_OPSGATE_VENDOR_DESK=true
 * - ET URL ?desk=vendor (ou #vendor-desk)
 *
 * Build client final : ne PAS définir VITE_OPSGATE_VENDOR_DESK
 * → le code VendorDesk n'est pas importé (moins de surface reverse-engineering).
 */
const vendorDeskEnabled =
  import.meta.env.VITE_OPSGATE_VENDOR_DESK === "true" ||
  import.meta.env.VITE_OPSGATE_VENDOR_DESK === "1"

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

async function boot() {
  const root = document.getElementById("root")!
  if (vendorDeskEnabled && wantsVendorUrl()) {
    const { default: VendorDesk } = await import("./VendorDesk")
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <VendorDesk />
      </React.StrictMode>
    )
    return
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
