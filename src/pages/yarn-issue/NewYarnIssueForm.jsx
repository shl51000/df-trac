import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { withDenierSuffix, stripDenierSuffix } from '../../lib/suffix'
import { fmt } from '../../lib/format'
import { todayISO, getFY } from '../../lib/fy'
import { PAYMENT_TERMS } from '../../lib/issueHelpers'
import { useFY } from '../../context/FYContext'
import { Card, Label, Input, Select, Btn, AddBtn } from '../../components/ui'
import { QuickAddWeaverModal, QuickAddYarnTypeModal, QuickAddColourModal } from '../production-orders/QuickAddModals'

const emptyItem = () => ({ id: crypto.randomUUID(), yarnTypeId: '', colourId: '', qty: '', rate: '' })

export default function NewYarnIssueForm({ editingIssue, existingIssues, onCancel, onSaved }) {
  const { currentFY } = useFY()
  const [weavers, setWeavers] = useState([])
  const [yarnTypes, setYarnTypes] = useState([]) // each with .colours
  const [loaded, setLoaded] = useState(false)

  const loadMasters = async () => {
    const [{ data: w }, { data: yt }, { data: yc }] = await Promise.all([
      supabase.from('weavers').select('*').eq('is_active', true).order('name'),
      supabase.from('yarn_types').select('*').eq('is_active', true).order('name'),
      supabase.from('yarn_colours').select('*'),
    ])
    setWeavers(w ?? [])
    setYarnTypes((yt ?? []).map((y) => ({ ...y, colours: (yc ?? []).filter((c) => c.yarn_type_id === y.id) })))
    setLoaded(true)
  }
  useEffect(() => {
    loadMasters()
  }, [])

  const [issueNo, setIssueNo] = useState(editingIssue?.issue_no || '')
  const [issueDate, setIssueDate] = useState(editingIssue?.issue_date || todayISO())
  const [weaverId, setWeaverId] = useState(editingIssue?.weaver_id || '')
  const [remarks, setRemarks] = useState(editingIssue?.remarks || '')
  const [items, setItems] = useState(
    editingIssue?.items?.length
      ? editingIssue.items.map((it) => ({ id: crypto.randomUUID(), yarnTypeId: it.yarn_type_id, colourId: it.colour_id, qty: String(it.qty ?? ''), rate: it.rate != null ? String(it.rate) : '' }))
      : [emptyItem()]
  )
  const [supplierName, setSupplierName] = useState(editingIssue?.supplier_name || '')
  const [transportName, setTransportName] = useState(editingIssue?.transport_name || '')
  const [lrNo, setLrNo] = useState(editingIssue?.lr_no || '')
  const [lrDate, setLrDate] = useState(editingIssue?.lr_date || '')
  const [paymentTerm, setPaymentTerm] = useState(editingIssue?.payment_term || PAYMENT_TERMS[0])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [addModal, setAddModal] = useState(null)

  const updateItem = (id, patch) => setItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addItemRow = () => setItems((rows) => [...rows, emptyItem()])
  const removeItemRow = (id) => setItems((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows))

  const amountFor = (row) => (Number(row.qty) || 0) * (Number(row.rate) || 0)
  const totalQty = items.reduce((s, r) => s + (Number(r.qty) || 0), 0)
  const totalAmount = items.reduce((s, r) => s + amountFor(r), 0)

  const isDuplicateIssueNo = (n) =>
    existingIssues.some((i) => (!editingIssue || i.id !== editingIssue.id) && i.issue_no.trim().toLowerCase() === n.trim().toLowerCase())

  // Quick-add handlers write straight to the real Yarn Library / Weavers
  // master, then apply the new id to whichever select opened the modal —
  // same pattern as Production Orders' quick-add.
  const createYarnType = async (name, denier) => {
    const dNorm = withDenierSuffix(denier)
    const dup = yarnTypes.some((y) => y.name.trim().toLowerCase() === name.toLowerCase() && stripDenierSuffix(y.denier).toLowerCase() === stripDenierSuffix(dNorm).toLowerCase())
    if (dup) return `${name} — ${dNorm} already exists.`
    const { data, error: insErr } = await supabase.from('yarn_types').insert({ name, denier: dNorm }).select().single()
    if (insErr) return friendlyError(insErr)
    await loadMasters()
    if (addModal.kind === 'itemYarn') updateItem(addModal.itemId, { yarnTypeId: data.id, colourId: '' })
    setAddModal(null)
    return null
  }
  const createColour = async (colourName) => {
    const yt = yarnTypes.find((y) => y.id === addModal.yarnTypeId)
    if (!yt) return 'Select a yarn quality first.'
    const dup = yt.colours.some((c) => c.colour_name.trim().toLowerCase() === colourName.toLowerCase())
    if (dup) return `"${colourName}" already exists for this yarn.`
    const { data, error: insErr } = await supabase.from('yarn_colours').insert({ yarn_type_id: yt.id, colour_name: colourName }).select().single()
    if (insErr) return friendlyError(insErr)
    await loadMasters()
    if (addModal.kind === 'itemColour') updateItem(addModal.itemId, { colourId: data.id })
    setAddModal(null)
    return null
  }
  const createWeaver = async (name, address, whatsapp, email) => {
    const { data, error: insErr } = await supabase.from('weavers').insert({ name, address, whatsapp, email }).select().single()
    if (insErr) return friendlyError(insErr)
    await loadMasters()
    setWeaverId(data.id)
    setAddModal(null)
    return null
  }

  const submit = async () => {
    const n = issueNo.trim()
    if (!n) return setError('RMDC No is required.')
    if (isDuplicateIssueNo(n)) return setError(`RMDC No "${n}" already exists — enter a different one.`)
    if (!issueDate) return setError('RMDC date is required.')
    if (getFY(issueDate) !== currentFY) return setError(`RMDC date must fall within the selected FY (${currentFY}) — switch FY in the sidebar first if this date belongs to a different year.`)
    if (!weaverId) return setError('Select a weaver.')
    if (items.some((r) => !r.yarnTypeId || !r.colourId || !String(r.qty).trim())) return setError('Every row needs a yarn quality, colour and quantity.')

    setSaving(true)
    const weaver = weavers.find((w) => w.id === weaverId)

    const issuePayload = {
      issue_no: n,
      issue_date: issueDate,
      weaver_id: weaver.id,
      weaver_name: weaver.name,
      remarks: remarks.trim(),
      supplier_name: supplierName.trim(),
      transport_name: transportName.trim(),
      lr_no: lrNo.trim(),
      lr_date: lrDate || null,
      payment_term: paymentTerm,
      total_qty: totalQty,
      total_amount: totalAmount,
    }

    let issueId
    if (editingIssue) {
      const { error: updErr } = await supabase.from('yarn_issues').update(issuePayload).eq('id', editingIssue.id)
      if (updErr) {
        setError(friendlyError(updErr, { onDuplicate: `RMDC No "${n}" already exists — enter a different one.` }))
        setSaving(false)
        return
      }
      issueId = editingIssue.id
      const { error: delErr } = await supabase.from('yarn_issue_items').delete().eq('yarn_issue_id', issueId)
      if (delErr) {
        setError(friendlyError(delErr))
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error: insErr } = await supabase.from('yarn_issues').insert(issuePayload).select().single()
      if (insErr) {
        setError(friendlyError(insErr, { onDuplicate: `RMDC No "${n}" already exists — enter a different one.` }))
        setSaving(false)
        return
      }
      issueId = inserted.id
    }

    const itemRows = items.map((r, i) => {
      const yt = yarnTypes.find((y) => y.id === r.yarnTypeId)
      const col = yt?.colours.find((c) => c.id === r.colourId)
      return {
        yarn_issue_id: issueId,
        sl: i + 1,
        yarn_type_id: r.yarnTypeId,
        yarn_type_name: yt ? `${yt.name} ${yt.denier}` : '',
        colour_id: r.colourId,
        colour_name: col ? col.colour_name : '',
        qty: r.qty,
        rate: r.rate || null,
        amount: amountFor(r),
      }
    })
    const { error: itemsErr } = await supabase.from('yarn_issue_items').insert(itemRows)
    if (itemsErr) {
      setError(`Issue saved, but items couldn't be saved: ${friendlyError(itemsErr)} Please try saving again.`)
      setSaving(false)
      return
    }

    setSaving(false)
    onSaved(issueId)
  }

  if (!loaded) return null

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
        <ArrowLeft size={15} /> Back
      </button>
      <h1 className="text-2xl font-semibold text-stone-900 mb-6">{editingIssue ? `Edit Yarn Issue — ${editingIssue.issue_no}` : 'New Yarn Issue'}</h1>

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>RMDC No</Label>
            <Input
              placeholder="e.g. YI-118"
              value={issueNo}
              onChange={(e) => {
                setIssueNo(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>RMDC date</Label>
            <Input
              type="date"
              value={issueDate}
              onChange={(e) => {
                setIssueDate(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Weaver name</Label>
            <div className="flex gap-1.5">
              <Select
                value={weaverId}
                onChange={(e) => {
                  setWeaverId(e.target.value)
                  setError('')
                }}
              >
                <option value="">Select weaver…</option>
                {weavers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <AddBtn title="Add weaver" onClick={() => setAddModal({ kind: 'weaver' })} />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Label>Remarks</Label>
          <Input placeholder="—" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </Card>

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Items</h2>
          <Btn variant="ghost" onClick={addItemRow}>
            <Plus size={13} /> Add row
          </Btn>
        </div>
        <div className="overflow-x-auto yll-scrollbar">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-stone-400 text-xs">
                <th className="text-left font-semibold px-4 py-2">SL</th>
                <th className="text-left font-semibold px-2 py-2">Name of Yarn</th>
                <th className="text-left font-semibold px-2 py-2">Colour / Shade</th>
                <th className="text-right font-semibold px-2 py-2">Qty (kg)</th>
                <th className="text-right font-semibold px-2 py-2">Rate</th>
                <th className="text-right font-semibold px-3 py-2">Amount</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => {
                const yt = yarnTypes.find((y) => y.id === row.yarnTypeId)
                return (
                  <tr key={row.id} className="border-t border-stone-100">
                    <td className="px-4 py-1.5 text-stone-500 font-mono">{i + 1}</td>
                    <td className="px-2 py-1.5 min-w-[190px]">
                      <div className="flex gap-1.5">
                        <Select value={row.yarnTypeId} onChange={(e) => updateItem(row.id, { yarnTypeId: e.target.value, colourId: '' })}>
                          <option value="">Select…</option>
                          {yarnTypes.map((y) => (
                            <option key={y.id} value={y.id}>
                              {y.name} {y.denier}
                            </option>
                          ))}
                        </Select>
                        <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: 'itemYarn', itemId: row.id })} />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 min-w-[170px]">
                      <div className="flex gap-1.5">
                        <Select value={row.colourId} onChange={(e) => updateItem(row.id, { colourId: e.target.value })} disabled={!yt}>
                          <option value="">{yt ? 'Select…' : 'Pick yarn first'}</option>
                          {(yt?.colours || []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.colour_name}
                            </option>
                          ))}
                        </Select>
                        <AddBtn
                          title="Add colour"
                          disabled={!yt}
                          onClick={() => setAddModal({ kind: 'itemColour', itemId: row.id, yarnTypeId: yt?.id, yarnLabel: yt ? `${yt.name} ${yt.denier}` : '' })}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 w-24">
                      <Input className="text-right" value={row.qty} onChange={(e) => updateItem(row.id, { qty: e.target.value })} placeholder="0" />
                    </td>
                    <td className="px-2 py-1.5 w-24">
                      <Input className="text-right" value={row.rate} onChange={(e) => updateItem(row.id, { rate: e.target.value })} placeholder="0" />
                    </td>
                    <td className="px-3 py-1.5 w-28 text-right font-mono text-stone-600">{fmt(amountFor(row))}</td>
                    <td className="px-2 py-1.5">{items.length > 1 && (
                      <button onClick={() => removeItemRow(row.id)} className="text-stone-400 hover:text-[#0D9488]">
                        <X size={14} />
                      </button>
                    )}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200">
                <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={3}>
                  Total
                </td>
                <td className="px-2 py-2 text-right text-sm font-semibold text-stone-800 font-mono">{fmt(totalQty)}</td>
                <td></td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 font-mono">{fmt(totalAmount)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="p-5 max-w-2xl mb-5">
        <Label>Dispatch details</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Supplier Name</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="—" />
          </div>
          <div>
            <Label>Transport Name</Label>
            <Input value={transportName} onChange={(e) => setTransportName(e.target.value)} placeholder="—" />
          </div>
          <div>
            <Label>LR No.</Label>
            <Input value={lrNo} onChange={(e) => setLrNo(e.target.value)} placeholder="—" />
          </div>
          <div>
            <Label>LR Date</Label>
            <Input type="date" value={lrDate} onChange={(e) => setLrDate(e.target.value)} />
          </div>
          <div>
            <Label>To-Pay / Paid</Label>
            <Select value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)}>
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>
          <Check size={15} /> {saving ? 'Saving…' : editingIssue ? 'Save changes' : 'Save issue'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
      </div>

      {addModal?.kind === 'weaver' && <QuickAddWeaverModal onClose={() => setAddModal(null)} onCreate={createWeaver} />}
      {addModal?.kind === 'itemYarn' && <QuickAddYarnTypeModal onClose={() => setAddModal(null)} onCreate={createYarnType} />}
      {addModal?.kind === 'itemColour' && <QuickAddColourModal yarnLabel={addModal.yarnLabel} onClose={() => setAddModal(null)} onCreate={createColour} />}
    </div>
  )
}
