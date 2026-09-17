import { useState } from 'react'
import { fmt } from '../../lib/format'
import { Card, Label, Input, Header } from '../../components/ui'

export default function ConsumptionNorms() {
  const [tab, setTab] = useState('weft') // "weft" | "warp"
  const [denier, setDenier] = useState('150')
  const [width, setWidth] = useState('48')
  const [pick, setPick] = useState('60')
  const [qty, setQty] = useState('100')
  const [warpDenier, setWarpDenier] = useState('150')
  const [warpWidth, setWarpWidth] = useState('48')
  const [reed, setReed] = useState('96')
  const [totalMts, setTotalMts] = useState('100')

  const kg = ((Number(denier) || 0) * (Number(width) || 0) * 110 * (Number(pick) || 0)) / 9000000 / 100 * (Number(qty) || 0)
  const warpKg = ((Number(warpDenier) || 0) * ((Number(warpWidth) || 0) * 1.04 * (Number(reed) || 0) + 100) * (Number(totalMts) || 0)) / 9000000 * 1.1

  return (
    <div>
      <Header title="Yarn Consumption Norms" subtitle="The formulas Yarn Required is built on — and a quick calculator for checking a figure by hand." />

      <div className="flex rounded-md overflow-hidden mb-5 max-w-xs" style={{ border: '1px solid #E7E2DC' }}>
        <button
          onClick={() => setTab('weft')}
          className="flex-1 py-2 text-sm font-semibold transition-colors"
          style={tab === 'weft' ? { backgroundColor: '#0D9488', color: '#fff' } : { backgroundColor: 'transparent', color: '#78716C' }}
        >
          Weft
        </button>
        <button
          onClick={() => setTab('warp')}
          className="flex-1 py-2 text-sm font-semibold transition-colors"
          style={tab === 'warp' ? { backgroundColor: '#0D9488', color: '#fff' } : { backgroundColor: 'transparent', color: '#78716C' }}
        >
          Warp
        </button>
      </div>

      {tab === 'weft' ? (
        <>
          <Card className="p-5 max-w-2xl mb-5">
            <Label>Formula</Label>
            <div className="text-sm font-medium font-mono text-stone-700 mb-1">kg = (Denier × Width × 110 × Pick) ÷ 9,000,000 ÷ 100 × Qty</div>
            <p className="text-xs text-stone-500">
              This is exactly what Yarn Required runs per feeder, per colourway line, on every Production Order — Denier from the feeder's Yarn Quality, Pick from that
              feeder's own row on the Design (not the order's overall Base Pick), Width from the order (plus a design's Salvage, if any), and Qty in metres.
            </p>
          </Card>

          <Card className="p-5 max-w-2xl">
            <Label>Try it</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
              <div>
                <Label>Denier</Label>
                <Input value={denier} onChange={(e) => setDenier(e.target.value)} />
              </div>
              <div>
                <Label>Width</Label>
                <Input value={width} onChange={(e) => setWidth(e.target.value)} />
              </div>
              <div>
                <Label>Pick</Label>
                <Input value={pick} onChange={(e) => setPick(e.target.value)} />
              </div>
              <div>
                <Label>Qty (mtrs)</Label>
                <Input value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-stone-200 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Result</span>
              <span className="text-lg font-semibold font-mono" style={{ color: '#0D9488' }}>
                {fmt(kg)} kg
              </span>
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card className="p-5 max-w-2xl mb-5">
            <Label>Formula</Label>
            <div className="text-sm font-medium font-mono text-stone-700 mb-1">kg = Denier × ((Width × 1.04 × Reed) + 100) × Total Mts ÷ 9,000,000 × 1.10</div>
            <p className="text-xs text-stone-500">
              This runs once per Production Order (not per feeder or colourway) — Denier and Colour from the order's own Warp Yarn, Reed from the underlying Design, Width
              from the order as entered (no Salvage allowance here — that only applies to Weft), and Total Mts from the order's own total across every colourway line.
            </p>
          </Card>

          <Card className="p-5 max-w-2xl">
            <Label>Try it</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
              <div>
                <Label>Denier</Label>
                <Input value={warpDenier} onChange={(e) => setWarpDenier(e.target.value)} />
              </div>
              <div>
                <Label>Width</Label>
                <Input value={warpWidth} onChange={(e) => setWarpWidth(e.target.value)} />
              </div>
              <div>
                <Label>Reed</Label>
                <Input value={reed} onChange={(e) => setReed(e.target.value)} />
              </div>
              <div>
                <Label>Total Mts</Label>
                <Input value={totalMts} onChange={(e) => setTotalMts(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-stone-200 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Result</span>
              <span className="text-lg font-semibold font-mono" style={{ color: '#0D9488' }}>
                {fmt(warpKg)} kg
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
