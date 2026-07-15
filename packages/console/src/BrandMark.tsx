/** Marque porte/bouclier (même visuelle que bandeau sites IA / enrollment) */

export function BrandMark({
  size = 40,
  title = "OpsGate"
}: {
  size?: number
  title?: string
}) {
  return (
    <div
      className="brand-mark-gate"
      title={title}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.22)),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #0a1128 0%, #0f766e 100%)",
        boxShadow: "inset 0 0 0 1px rgba(43, 217, 197, 0.4)",
        flexShrink: 0
      }}>
      <svg
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        viewBox="0 0 32 32">
        <path
          fill="none"
          stroke="#2bd9c5"
          strokeWidth="2"
          strokeLinecap="round"
          d="M8 22V12c0-4 3.5-7 8-7s8 3 8 7v10"
        />
        <path
          fill="#2bd9c5"
          d="M16 14.5c-1.8 0-3.2 1.3-3.2 3v1.2h6.4V17.5c0-1.7-1.4-3-3.2-3z"
        />
        <path
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1.6"
          d="M12.5 18.5h7v4.2c0 1.6-1.6 3-3.5 3s-3.5-1.4-3.5-3v-4.2z"
        />
      </svg>
    </div>
  )
}
