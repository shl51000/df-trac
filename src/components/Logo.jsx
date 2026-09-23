// DF / SOUTH HANDLOOMS logo: open square frame with "DF" breaking out of its
// lower-left, "SOUTH" over "HANDLOOMS" to the right. Built from plain divs
// (not SVG) so html2canvas captures it with the web font on slip JPGs.
//
// `size` is the frame height in px; everything else scales from it.
// `dark` = on the app's #1C2620 chrome (teal + white); default = print/report
// (teal + black).
//
// Text boxes use line-height 0.662 — Tinos's cap height — so each box runs
// from cap top to baseline, letting flex/absolute layout align baselines.
const CAP = 0.662

export default function Logo({ size = 44, dark = false }) {
  const u = size
  const accent = dark ? '#2DD4BF' : '#0D9488'
  const ink = dark ? '#FFFFFF' : '#1C1917'
  const stroke = Math.max(1, Math.round(u * 0.028))
  const text = { fontFamily: 'var(--font-wordmark)', lineHeight: CAP, whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'flex-end', verticalAlign: 'middle' }} aria-label="DF South Handlooms">
      <div style={{ position: 'relative', width: u * 1.08, height: u, marginLeft: u * 0.07, flexShrink: 0 }}>
        {/* top */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: stroke, background: ink }} />
        {/* left, stops short of the DF */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: stroke, height: u * 0.41, background: ink }} />
        {/* right */}
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: stroke, background: ink }} />
        {/* bottom-right tick */}
        <div style={{ position: 'absolute', right: 0, bottom: 0, width: u * 0.08, height: stroke, background: ink }} />
        <div style={{ ...text, position: 'absolute', left: -u * 0.07, bottom: 0, fontSize: u * 0.79, color: accent }}>DF</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: u * 0.115 }}>
        <div style={{ ...text, fontSize: u * 0.445, color: accent }}>SOUTH</div>
        <div style={{ ...text, fontSize: u * 0.232, color: ink, marginTop: u * 0.115 }}>HANDLOOMS</div>
      </div>
    </div>
  )
}
