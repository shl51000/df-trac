// Plain text wordmark — no graphical logo for now. `dark` controls
// contrast when it sits on the sidebar's #1C2620 background.
export default function Logo({ size = 44, dark = false }) {
  return (
    <div style={{ color: dark ? '#F5F0E8' : '#1C1917', fontSize: size * 0.36, fontFamily: 'var(--font-wordmark)', letterSpacing: '0.5px' }}>
      SOUTH HANDLOOMS
    </div>
  )
}
