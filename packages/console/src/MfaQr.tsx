import { useEffect, useState } from "react"
import QRCode from "qrcode"

/**
 * QR code pour enrollment TOTP (otpauth://…).
 */
export function MfaQr({
  otpauthUrl,
  size = 180
}: {
  otpauthUrl: string
  size?: number
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    setErr(null)
    if (!otpauthUrl.trim()) return
    void QRCode.toDataURL(otpauthUrl, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0a1128", light: "#ffffff" }
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [otpauthUrl, size])

  if (err) {
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        QR indisponible — saisissez le secret manuellement.
      </p>
    )
  }
  if (!dataUrl) {
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        Génération du QR…
      </p>
    )
  }

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: 12,
        background: "#fff",
        border: "1px solid var(--line, #e2e8f0)",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(15,23,42,0.06)"
      }}>
      <img
        src={dataUrl}
        width={size}
        height={size}
        alt="QR code Authenticator MFA"
        style={{ display: "block", imageRendering: "pixelated" }}
      />
      <span className="muted" style={{ fontSize: 11, textAlign: "center" }}>
        Scannez avec Google / Microsoft Authenticator
      </span>
    </div>
  )
}
