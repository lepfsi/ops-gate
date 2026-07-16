import React from "react"
import ReactDOM from "react-dom/client"

import App from "./App"
import VendorDesk from "./VendorDesk"
import "./styles.css"

/**
 * Bureau concepteur (licences) : URL réservée, hors nav client.
 *   http://host:5173/?desk=vendor
 *   http://host:5173/#vendor-desk
 */
function isVendorDesk(): boolean {
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isVendorDesk() ? <VendorDesk /> : <App />}
  </React.StrictMode>
)
