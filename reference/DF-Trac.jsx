import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Pencil, Trash2, X, ChevronDown, ChevronRight, Palette,
  Boxes, Users, PackageMinus, AlertTriangle,
  Search, Check, Menu, LayoutGrid, Upload, FileEdit, Loader2, ArrowLeft, Grid3x3,
  Image as ImageIcon, LogOut, KeyRound, Eye, EyeOff, ArrowUpDown, Phone, Mail,
  Printer, Download, Share2, FileText, MapPin, PackageCheck, Hourglass, Scale, Tag, Warehouse, Calculator, Calendar, Lock,
} from "lucide-react";

/* =================================================================
   SOUTH HANDLOOMS — PO & Yarn Ledger
   STEP 1: Yarn Types Master
   STEP 2: Design Library

   Colour theme, UI atoms, and the left sidebar nav are copied
   exactly from yarn-loom-ledger.jsx so this app drops straight
   into that codebase as later steps (Weavers, Purchase Orders,
   Yarn Issued, Stock) are added.

   YARN TYPES: a "Yarn Type" = Name of Yarn + Denier. Every Yarn
   Type carries a subset of Colours — this is the level at which
   yarn requirement, issue, and stock with the weaver will be
   tracked in later steps.

   DESIGN LIBRARY: a design spec sheet (Design No, Hooks, Reed,
   Panno, and a Feeder table of Colour/Card/Pick for F1-F8) can
   list more than one base Pick value side by side, e.g. 60 and
   56. Each Pick value becomes its own design record — "MS-147
   (60)" and "MS-147 (56)" — sharing the same header fields but
   with its own per-feeder pick numbers and its own Average Pick
   (the sum of that column's feeder picks).
==================================================================*/

const STORAGE_KEY = "sh-app-data-v1";

const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* Denier is always shown/stored with a trailing "D" (e.g. "150D"). Users only
   ever type the number; the suffix is fixed in the UI and re-applied on save
   so older records typed without it still normalize. Reed ("r") and base
   Pick values ("p") follow the exact same pattern. */
const stripSuffix = (v, letter) => String(v || "").trim().replace(new RegExp(`\\s*${letter}$`, "i"), "").trim();
const withSuffix = (v, letter) => {
  const n = stripSuffix(v, letter);
  return n ? `${n}${letter}` : "";
};
const stripDenierSuffix = (d) => stripSuffix(d, "D");
const withDenierSuffix = (d) => withSuffix(d, "D");
const stripReedSuffix = (r) => stripSuffix(r, "r");
const withReedSuffix = (r) => withSuffix(r, "r");
const stripPickSuffix = (p) => stripSuffix(p, "p");
const withPickSuffix = (p) => withSuffix(p, "p");

const FEEDER_COUNT = 8;
/* A feeder counts as "active" only when its Card is a real value — blank,
   "-", and "0" all mean "not used" (the same convention the spec-sheet
   extraction already follows for unused feeders), so any of those never
   inflate a design's feeder count on the Production Order screen. */
const isActiveCard = (card) => {
  const c = String(card || "").trim();
  return c !== "" && c !== "-" && c !== "0";
};

/* Referential-integrity checks — a Design, Yarn Type, Colour, or Weaver
   that's been used in a saved Production Order can't be deleted, even
   by Admin, since deleting it would orphan/misrepresent that order.
   Editing is still allowed; only delete is blocked. */
const isDesignInUse = (designId, productionOrders) => productionOrders.some((o) => o.designId === designId);
const isYarnTypeInUse = (yarnTypeId, productionOrders) =>
  productionOrders.some((o) => o.warpYarnTypeId === yarnTypeId || o.feederQuality.some((f) => f.yarnTypeId === yarnTypeId));
const isColourInUse = (colourId, productionOrders) =>
  productionOrders.some((o) => o.warpColourId === colourId || o.lines.some((l) => l.colours.some((c) => c.colourId === colourId)));
const isWeaverInUse = (weaverId, productionOrders) => productionOrders.some((o) => o.weaverId === weaverId);
/* A PO with any goods receipt recorded against it can't be deleted either
   — same reasoning as the other in-use checks above. */
const isOrderInUse = (poId, receipts) => receipts.some((r) => r.poId === poId);
const orderStatus = (o) => o.status || "pending"; // orders saved before this field existed default to pending
const receivedQtyForOrder = (poId, receipts) =>
  // .mts is the metres-equivalent (raw qty for an Mts receipt, Pcs × Cut
  // Size for a Pcs one) — always compare like-for-like against a PO's own
  // totalMtrs. Older receipts saved before .mts existed fall back to .qty,
  // which was always metres back then anyway.
  receipts.filter((r) => r.poId === poId).reduce((sum, r) => sum + (Number(r.mts != null ? r.mts : r.qty) || 0), 0);

/* Primary qty for a PO: Pcs with the auto Mts alongside for a Pcs-measured
   order, otherwise just Mts — used everywhere a PO shows up as a list row. */
const formatOrderQty = (order) => {
  if (order.unit === "Pcs") {
    const totalPcs = order.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    return `${fmt(totalPcs)} pcs (${fmt(order.totalMtrs)} mts)`;
  }
  return `${fmt(order.totalMtrs)} mts`;
};

/* Keyword search across a PO's own identifying text — PO No, Design No,
   Weaver, Warp Yarn/Colour — used wherever a Production Order list has
   its own search box. */
const orderMatchesQuery = (o, q) => {
  if (!q) return true;
  const hay = `${o.poNo} ${o.designNo} ${o.designLabel} ${o.weaverName} ${o.warpYarnTypeName || ""} ${o.warpColourName || ""} ${o.remarks || ""}`.toLowerCase();
  return hay.includes(q);
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDateDMY = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
};

/* Indian financial year: 1 Apr – 31 Mar, labelled "2026-27" for the year
   starting April 2026. Every transaction's FY is derived on the fly from
   its own date field — nothing is stored — so editing a date always
   keeps its FY correct with no migration to worry about. */
const getFY = (dateStr) => {
  if (!dateStr) return null;
  const [y, m] = dateStr.split("-").map(Number);
  if (!y || !m) return null;
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};
const currentFYLabel = () => getFY(todayISO());

const emptyData = () => ({
  yarnTypes: [], designs: [], sheets: [], users: [], weavers: [], productionOrders: [], receipts: [],
  fabricTypes: [], yarnIssues: [], currentFY: currentFYLabel(), closedFYs: [],
});
/* yarnTypes: [{ id, name, denier, colours: [{ id, colourName }] }]
   designs:   [{ id, label, designNo, hooks, reed, panno, pick, materialType, cutSize,
                 feeders: [{ feeder, card, pick }], averagePick, sheetId, createdAt }] —
              materialType and cutSize are design-level (same for every
              feeder), not per-feeder.
   sheets:    [{ id, fileName, uploadedAt }] — metadata only; the actual
              photo bytes are saved under their own storage key (see
              saveSheetImage) so the design library's main record never
              grows large enough to risk a storage size limit.
   users:     [{ id, name, mobile, email, password }] — login accounts
              managed from the Users tab.
   weavers:   [{ id, name, address, whatsapp, email }]
   productionOrders: [{ id, poNo, poDate, width, remarks, designId, designNo, designLabel, reed, pick,
                 weaverId, weaverName, weaverAddress, weaverWhatsapp, weaverEmail,
                 warpYarnTypeId, warpYarnTypeName, warpColourId, warpColourName,
                 unit, cutSizeUsed, feederQuality: [{ feeder, yarnTypeId, yarnTypeName }],
                 lines: [{ sl, colours: [{ feeder, colourId, colourName }], qty, mts }],
                 totalMtrs, sheetId, status, closedAt, createdAt }] — weaver
              and design details are snapshotted at save time so a PO stays
              correct even if the source weaver or design record changes
              later. status is "pending" (default when absent, for orders
              saved before this field existed), "closed", or "short-closed".
              unit is the Fabric Type's measuring term ("Mts"/"Pcs") at the
              time of saving; when it's "Pcs", each line's qty is a piece
              count and its mts is qty × cutSizeUsed — the design's own
              (single, not per-feeder) Cut Size, see designCutSize.
   receipts:  [{ id, invNo, invDate, weaverId, weaverName, poId, poNo,
                 designLabel, qty, createdAt }] — goods received from a
              weaver against a PO, design-wise rather than split by
              colourway; a PO's own line-level colours/qty are what was
              ordered, receipts track what's actually come back, in
              however many lots it arrives.
   fabricTypes: [{ id, code, name, measuringTerm }] — a Design No's leading
              letters (e.g. "MS" in "MS-147") are matched against `code`
              here to work out what kind of fabric it is and which unit
              ("Mts"/"Pcs") its quantities are in.
   yarnIssues: [{ id, issueNo, issueDate, weaverId, weaverName,
                 items: [{ sl, yarnTypeId, yarnTypeName, colourId, colourName, qty, rate, amount }],
                 totalQty, totalAmount, supplierName, transportName, lrNo,
                 lrDate, paymentTerm, createdAt }] — yarn (kg) issued to a
              weaver; qty here is what's netted against Yarn Required's kg
              figures to work out remaining requirement and any stock
              excess sitting with that weaver.
   currentFY: "2026-27" style label for the financial year every
              transaction tab is currently scoped to — Production Orders,
              Goods Receipts and Yarn Issues all filter to whichever FY a
              transaction's own date falls into (see getFY), not to a
              stored field, so editing a date always keeps it correct.
   closedFYs: FY labels marked closed from the sidebar's FY switcher —
              read-only there: no new/edited/deleted transactions, and no
              order status changes, while that FY is the active one. */

/* Reads the leading letters off a Design No — "MS" from "MS-147" — used to
   look the design up in Fabric Types. Falls back to "" if there aren't any. */
const getDesignPrefix = (designNo) => (String(designNo || "").match(/^[A-Za-z]+/) || [""])[0];
const findFabricType = (designNo, fabricTypes) => {
  const prefix = getDesignPrefix(designNo).toUpperCase();
  if (!prefix) return null;
  return fabricTypes.find((f) => f.code.trim().toUpperCase() === prefix) || null;
};
/* Falls back to "Mts" wherever no Fabric Type is set up yet for a prefix,
   so nothing breaks before the Fabric Types master has been filled in. */
const measuringTermFor = (designNo, fabricTypes) => findFabricType(designNo, fabricTypes)?.measuringTerm || "Mts";


/* ---------- persistence ----------
   Saved through the artifact's own persistent storage (window.storage)
   when it's available — that's what actually survives a refresh inside
   Claude.ai, since plain localStorage does not persist there. Falls
   back to localStorage so the same file still works once it's hosted
   as a normal web page outside Claude.

   The uploaded spec-sheet photo for each design is kept under its own
   key rather than inside the main data blob, so a growing library of
   photos never risks hitting one key's storage limit. */
async function storageGet(key) {
  if (typeof window !== "undefined" && window.storage) {
    try {
      const r = await window.storage.get(key);
      return r ? r.value : null;
    } catch { return null; }
  }
  try { return localStorage.getItem(key); } catch { return null; }
}
async function storageSet(key, value) {
  if (typeof window !== "undefined" && window.storage) {
    try { await window.storage.set(key, value); return true; } catch {}
  }
  try { localStorage.setItem(key, value); return true; } catch {}
  return false;
}

async function loadData() {
  const raw = await storageGet(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          yarnTypes: Array.isArray(parsed.yarnTypes) ? parsed.yarnTypes : [],
          designs: Array.isArray(parsed.designs) ? parsed.designs : [],
          sheets: Array.isArray(parsed.sheets) ? parsed.sheets : [],
          users: Array.isArray(parsed.users) ? parsed.users : [],
          weavers: Array.isArray(parsed.weavers) ? parsed.weavers : [],
          productionOrders: Array.isArray(parsed.productionOrders) ? parsed.productionOrders : [],
          receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
          fabricTypes: Array.isArray(parsed.fabricTypes) ? parsed.fabricTypes : [],
          yarnIssues: Array.isArray(parsed.yarnIssues) ? parsed.yarnIssues : [],
          currentFY: typeof parsed.currentFY === "string" ? parsed.currentFY : currentFYLabel(),
          closedFYs: Array.isArray(parsed.closedFYs) ? parsed.closedFYs : [],
        };
      }
    } catch {}
  }
  return emptyData();
}
async function saveData(data) {
  await storageSet(STORAGE_KEY, JSON.stringify(data));
}
async function loadSheetImage(id) {
  return storageGet(`${STORAGE_KEY}:sheet:${id}`);
}
async function saveSheetImage(id, dataUrl) {
  return storageSet(`${STORAGE_KEY}:sheet:${id}`, dataUrl);
}
/* Phone-camera photos routinely come in at several MB, which risks the
   storage layer's per-key size limit and is why a saved sheet could
   silently fail to persist. Downscaling to a reasonable print/read size
   before it's ever stored (or sent to the API) keeps it comfortably
   inside that limit. */
function compressImageDataUrl(dataUrl, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not process image"));
    img.src = dataUrl;
  });
}

/* ---------- print / JPG export / WhatsApp share ----------
   html2canvas is loaded on demand from cdnjs (never bundled) so a
   Download or Share click is the only thing that pays for it. */
const HTML2CANVAS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
function loadScriptOnce(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    const timer = setTimeout(() => {
      reject(new Error("Timed out loading a required script — this environment may be blocking external scripts, or the network is slow."));
    }, timeoutMs);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Could not load a required script — this environment may be blocking external scripts."));
    };
    document.body.appendChild(s);
  });
}
async function ensureCanvasLib() {
  if (typeof window.html2canvas !== "function") {
    await loadScriptOnce(HTML2CANVAS_SRC);
  }
  if (typeof window.html2canvas !== "function") {
    throw new Error("The image-generation library didn't load correctly.");
  }
}
async function captureElementAsJPG(el) {
  await ensureCanvasLib();
  let canvas;
  try {
    canvas = await window.html2canvas(el, { backgroundColor: "#ffffff", scale: 2 });
  } catch (e) {
    throw new Error(`Couldn't render this to an image (${e?.message || "unknown error"}).`);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}
/* PDF download — same html2canvas render, then dropped into a one-page
   jsPDF document sized to the canvas so nothing gets cropped. */
const JSPDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
async function downloadElementAsPDF(el, fileName) {
  await ensureCanvasLib();
  if (typeof window.jspdf === "undefined") {
    await loadScriptOnce(JSPDF_SRC);
  }
  if (typeof window.jspdf === "undefined" || typeof window.jspdf.jsPDF !== "function") {
    throw new Error("The PDF library didn't load correctly.");
  }
  let canvas;
  try {
    canvas = await window.html2canvas(el, { backgroundColor: "#ffffff", scale: 2 });
  } catch (e) {
    throw new Error(`Couldn't render this to a PDF (${e?.message || "unknown error"}).`);
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
    unit: "pt",
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(fileName);
}
function downloadDataUrl(dataUrl, fileName) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
/* CSV export — Excel opens this natively, and it needs no external
   library or script load, so it works even where the JPG/PDF paths
   above might not (see the html2canvas/jsPDF notes on those). */
function downloadCSV(fileName, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel reads UTF-8 correctly
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/* Tries the native share sheet (where WhatsApp shows up as a target on
   phones) with the actual image file attached. Where that's not
   supported — most desktop browsers — falls back to opening WhatsApp
   with the order details as text, since a browser can't attach a file
   to that link on its own; the JPG still needs to be downloaded and
   attached by hand in that case. */
async function shareJPGOnWhatsApp(dataUrl, fileName, captionText) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], fileName, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName, text: captionText });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
  }
  downloadDataUrl(dataUrl, fileName);
  window.open(`https://wa.me/?text=${encodeURIComponent(captionText)}`, "_blank");
  return "fallback";
}
/* A browser can't attach a file to a mailto: link on its own — same
   limitation as the WhatsApp fallback above — so this tries the native
   share sheet first (Mail shows up there on phones, with the file
   actually attached), and otherwise downloads the file and opens a
   pre-filled email for the file to be attached to by hand. */
async function shareFileByEmail(dataUrl, fileName, mimeType, subject, bodyText) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], fileName, { type: mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: subject, text: bodyText });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
  }
  downloadDataUrl(dataUrl, fileName);
  window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`, "_blank");
  return "fallback";
}

/* ---------- fonts (same imports as yarn-loom-ledger.jsx, plus Bevan for the wordmark) ---------- */
const FontStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Bevan&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    .yll-root{ font-family:'Inter',ui-sans-serif,system-ui,sans-serif; }
    .yll-display{ font-family:'Inter',ui-sans-serif,system-ui,sans-serif; }
    .yll-mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }
    .yll-wordmark{ font-family:'Bevan',ui-serif,serif; letter-spacing:0.5px; }
    .yll-scrollbar::-webkit-scrollbar{ height:6px; width:6px; }
    .yll-scrollbar::-webkit-scrollbar-thumb{ background:#D6D3D1; border-radius:4px; }
    @media print{
      body *{ visibility:hidden; }
      .print-area, .print-area *{ visibility:visible; }
      .print-area{ position:absolute; left:0; top:0; width:100%; margin:0; border:none; }
    }
  `}</style>
);

/* Plain text wordmark — no graphical logo for now. `dark` controls
   contrast when it sits on the sidebar's #1C2620 background. */
function Logo({ size = 44, dark = false }) {
  return (
    <div className="yll-wordmark" style={{ color: dark ? "#F5F0E8" : "#1C1917", fontSize: size * 0.36 }}>
      SOUTH HANDLOOMS
    </div>
  );
}

/* ---------- UI atoms — copied 1:1 from yarn-loom-ledger.jsx ---------- */
const Card = ({ children, className = "" }) => (
  <div className={`bg-white border border-stone-200 rounded-md shadow-sm ${className}`}>{children}</div>
);
const Label = ({ children }) => <label className="block text-[11px] font-semibold tracking-wide uppercase text-stone-500 mb-1">{children}</label>;
const Input = (props) => (
  <input {...props} className={`w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] placeholder:text-stone-400 ${props.className || ""}`} />
);
const Select = (props) => (
  <select {...props} className={`w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] disabled:opacity-50 disabled:cursor-not-allowed ${props.className || ""}`} />
);
const Btn = ({ variant = "primary", className = "", style = {}, ...props }) => {
  const styles = {
    primary: "text-white transition-colors",
    ghost: "bg-transparent text-stone-700 hover:bg-stone-100 border border-stone-300",
    danger: "bg-transparent transition-colors",
  };
  const inlineStyle = {
    primary: { backgroundColor: "#0D9488" },
    danger: { color: "#0D9488" },
  }[variant] || {};
  const [hover, setHover] = useState(false);
  const hoverStyle = variant === "primary" && hover ? { backgroundColor: "#0F766E" } : variant === "danger" && hover ? { backgroundColor: "#F0FDFA" } : {};
  return (
    <button
      {...props}
      onMouseEnter={(e) => { setHover(true); props.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); props.onMouseLeave?.(e); }}
      style={{ ...inlineStyle, ...hoverStyle, ...style }}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    />
  );
};
const Badge = ({ children, tone = "neutral" }) => {
  const tones = {
    neutral: "bg-stone-100 text-stone-600",
    good: "bg-emerald-50 text-emerald-700",
    bad: "",
    warn: "bg-amber-50 text-amber-700",
  };
  const inlineStyle = tone === "bad" ? { backgroundColor: "#F0FDFA", color: "#0F766E" } : {};
  return <span style={inlineStyle} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
};
const Empty = ({ icon: Icon, title, hint }) => (
  <div className="flex flex-col items-center justify-center py-14 text-center px-6">
    <div className="w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center mb-3"><Icon size={20} className="text-stone-400" /></div>
    <p className="text-sm font-semibold text-stone-800">{title}</p>
    {hint && <p className="text-xs text-stone-500 mt-1 max-w-xs">{hint}</p>}
  </div>
);
const Header = ({ title, subtitle }) => (
  <div className="mb-6">
    <h1 className="yll-display text-2xl font-semibold text-stone-900">{title}</h1>
    {subtitle && <p className="text-sm text-stone-500 mt-1 max-w-2xl">{subtitle}</p>}
  </div>
);

const SuffixedInput = ({ suffix, ...props }) => (
  <div className="relative">
    <Input {...props} className={`pr-7 ${props.className || ""}`} />
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-400 pointer-events-none">{suffix}</span>
  </div>
);
const IconBtn = ({ title, onClick, children, danger, disabled }) => (
  <button title={title} onClick={onClick} disabled={disabled}
    className={`p-1.5 rounded-md transition-colors hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent ${danger ? "text-[#0D9488]" : "text-stone-400 hover:text-stone-600"}`}>
    {children}
  </button>
);
function ConfirmBar({ text, onConfirm, onCancel }) {
  return (
    <div style={{ backgroundColor: "#F0FDFA" }} className="flex items-center gap-2 rounded px-3 py-2 text-xs text-[#0F766E]">
      <AlertTriangle size={14} />
      <span className="flex-1">{text}</span>
      <button onClick={onConfirm} className="font-semibold underline">Delete</button>
      <button onClick={onCancel} className="font-semibold">Cancel</button>
    </div>
  );
}

/* =================================================================
   YARN TYPES MASTER
==================================================================*/
function YarnTypesMaster({ data, setData, canDelete }) {
  const [name, setName] = useState("");
  const [denier, setDenier] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [error, setError] = useState("");

  const yarnTypes = data.yarnTypes;
  const productionOrders = data.productionOrders;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return yarnTypes;
    return yarnTypes.filter((y) =>
      y.name.toLowerCase().includes(q) ||
      String(y.denier).toLowerCase().includes(q) ||
      y.colours.some((c) => (c.colourName || "").toLowerCase().includes(q))
    );
  }, [yarnTypes, query]);

  const startEdit = (y) => { setEditingId(y.id); setName(y.name); setDenier(stripDenierSuffix(y.denier)); setError(""); };
  const cancelEdit = () => { setEditingId(null); setName(""); setDenier(""); setError(""); };

  const isDuplicate = (n, d, ignoreId) =>
    yarnTypes.some((y) => y.id !== ignoreId && y.name.trim().toLowerCase() === n.trim().toLowerCase() && stripDenierSuffix(y.denier).toLowerCase() === stripDenierSuffix(d).toLowerCase());

  const submit = () => {
    const n = name.trim(), dRaw = denier.trim();
    if (!n) { setError("Name of yarn is required."); return; }
    if (!dRaw) { setError("Denier is required."); return; }
    const d = withDenierSuffix(dRaw);
    if (isDuplicate(n, d, editingId)) { setError(`${n} — ${d} already exists as a yarn type.`); return; }
    if (editingId) {
      setData({ ...data, yarnTypes: yarnTypes.map((y) => (y.id === editingId ? { ...y, name: n, denier: d } : y)) });
    } else {
      const id = uid("yt");
      setData({ ...data, yarnTypes: [...yarnTypes, { id, name: n, denier: d, colours: [] }] });
      setExpanded((e) => ({ ...e, [id]: true }));
    }
    cancelEdit();
  };

  const removeYarnType = (id) => {
    setData({ ...data, yarnTypes: yarnTypes.filter((y) => y.id !== id) });
    setConfirmDeleteId(null);
  };

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const updateColours = (yarnTypeId, colours) => {
    setData({ ...data, yarnTypes: yarnTypes.map((y) => (y.id === yarnTypeId ? { ...y, colours } : y)) });
  };

  return (
    <div>
      <Header title="Yarn Library" subtitle="Define each yarn by name and denier, then add its colour subsets. Requirement, issue, and stock with the weaver will all be tracked at colour level under each yarn type." />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? "Edit yarn type" : "Add yarn type"}</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name of yarn</Label>
            <Input placeholder="e.g. Viscose Filament" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Denier</Label>
            <SuffixedInput suffix="D" placeholder="e.g. 150" value={denier} onChange={(e) => { setDenier(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>{editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? "Update" : "Add"} yarn type</Btn>
          {editingId && <Btn variant="ghost" onClick={cancelEdit}><X size={15} /> Cancel</Btn>}
        </div>
      </Card>

      {yarnTypes.length > 0 && (
        <div className="relative max-w-sm mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search yarn, denier or colour…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
      )}

      {yarnTypes.length === 0 ? (
        <Card><Empty icon={Boxes} title="No yarn types yet" hint="Add your first yarn above — for example, Viscose Filament, 150D." /></Card>
      ) : filtered.length === 0 ? (
        <Card><Empty icon={Search} title="No matches" hint="Try a different search term." /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((y) => (
            <YarnTypeCard
              key={y.id}
              yarnType={y}
              expanded={!!expanded[y.id]}
              onToggle={() => toggleExpand(y.id)}
              onEdit={() => startEdit(y)}
              onDeleteRequest={() => setConfirmDeleteId(y.id)}
              confirmingDelete={confirmDeleteId === y.id}
              onConfirmDelete={() => removeYarnType(y.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onUpdateColours={(colours) => updateColours(y.id, colours)}
              canDelete={canDelete}
              inUse={isYarnTypeInUse(y.id, productionOrders)}
              productionOrders={productionOrders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function YarnTypeCard({ yarnType, expanded, onToggle, onEdit, onDeleteRequest, confirmingDelete, onConfirmDelete, onCancelDelete, onUpdateColours, canDelete, inUse, productionOrders }) {
  const [colourName, setColourName] = useState("");
  const [editingColourId, setEditingColourId] = useState(null);
  const [colourError, setColourError] = useState("");
  const [confirmDeleteColourId, setConfirmDeleteColourId] = useState(null);

  const colours = yarnType.colours;

  const startEditColour = (c) => { setEditingColourId(c.id); setColourName(c.colourName); setColourError(""); };
  const cancelEditColour = () => { setEditingColourId(null); setColourName(""); setColourError(""); };

  const submitColour = () => {
    const c = colourName.trim();
    if (!c) { setColourError("Enter a colour name."); return; }
    const dup = colours.some((row) => row.id !== editingColourId && row.colourName.trim().toLowerCase() === c.toLowerCase());
    if (dup) { setColourError(`"${c}" already exists for this yarn.`); return; }
    if (editingColourId) {
      onUpdateColours(colours.map((row) => (row.id === editingColourId ? { ...row, colourName: c } : row)));
    } else {
      onUpdateColours([...colours, { id: uid("col"), colourName: c }]);
    }
    cancelEditColour();
  };

  const removeColour = (id) => {
    onUpdateColours(colours.filter((row) => row.id !== id));
    setConfirmDeleteColourId(null);
  };

  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-center gap-2.5">
          {expanded ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
          <span className="text-sm font-semibold text-stone-800">{yarnType.name}</span>
          <Badge tone="warn">{yarnType.denier}</Badge>
          <Badge tone="neutral">{colours.length} colour{colours.length === 1 ? "" : "s"}</Badge>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Edit yarn type" onClick={onEdit}><Pencil size={14} /></IconBtn>
          {canDelete && (
            <IconBtn
              title={inUse ? "Used in a Production Order — can't delete" : "Delete yarn type"}
              danger onClick={onDeleteRequest} disabled={inUse}
            ><Trash2 size={14} /></IconBtn>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="px-4 pb-3">
          <ConfirmBar
            text={colours.length > 0 ? `Delete "${yarnType.name}" and all ${colours.length} colour(s) under it?` : `Delete "${yarnType.name}"?`}
            onConfirm={onConfirmDelete} onCancel={onCancelDelete}
          />
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 border-t border-stone-200">
          <div className="pt-3 flex items-center gap-2 text-stone-500">
            <Palette size={13} />
            <span className="text-xs font-medium">Colours</span>
          </div>

          {colours.length > 0 && (
            <div className="mt-2 divide-y divide-stone-100">
              {colours.map((c) => {
                const colourInUse = isColourInUse(c.id, productionOrders);
                return (
                  <div key={c.id} className="py-2 flex items-center justify-between">
                    <span className="text-sm text-stone-800">{c.colourName}</span>
                    <div className="flex items-center gap-1">
                      <IconBtn title="Edit" onClick={() => startEditColour(c)}><Pencil size={13} /></IconBtn>
                      {canDelete && (confirmDeleteColourId === c.id ? (
                        <div className="flex items-center gap-1 text-xs">
                          <button onClick={() => removeColour(c.id)} className="font-semibold underline text-[#0D9488]">Delete</button>
                          <button onClick={() => setConfirmDeleteColourId(null)} className="font-semibold text-stone-500">Cancel</button>
                        </div>
                      ) : (
                        <IconBtn
                          title={colourInUse ? "Used in a Production Order — can't delete" : "Delete"}
                          danger onClick={() => setConfirmDeleteColourId(c.id)} disabled={colourInUse}
                        ><Trash2 size={13} /></IconBtn>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <Label>Colour name</Label>
              <Input placeholder="e.g. Maroon" value={colourName} onChange={(e) => { setColourName(e.target.value); setColourError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitColour(); }} />
            </div>
            <Btn onClick={submitColour}>{editingColourId ? <Check size={14} /> : <Plus size={14} />} {editingColourId ? "Update" : "Add"}</Btn>
            {editingColourId && <Btn variant="ghost" onClick={cancelEditColour}><X size={14} /></Btn>}
          </div>
          {colourError && <div className="text-xs mt-1.5 text-[#0D9488]">{colourError}</div>}
        </div>
      )}
    </Card>
  );
}

/* =================================================================
   USERS
   Login accounts: name, mobile number, email, password. Password is
   masked by default in both the form and the list, with a per-row
   reveal toggle.
==================================================================*/
function UsersMaster({ data, setData, canDelete }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [revealedId, setRevealedId] = useState(null);
  const [error, setError] = useState("");

  const users = data.users;

  const startEdit = (u) => {
    setEditingId(u.id); setName(u.name); setMobile(u.mobile); setEmail(u.email); setPassword(u.password);
    setShowPassword(false); setError("");
  };
  const cancelEdit = () => {
    setEditingId(null); setName(""); setMobile(""); setEmail(""); setPassword(""); setShowPassword(false); setError("");
  };

  const isDuplicateEmail = (e, ignoreId) =>
    users.some((u) => u.id !== ignoreId && u.email.trim().toLowerCase() === e.trim().toLowerCase());

  const submit = () => {
    const n = name.trim(), m = mobile.trim(), e = email.trim(), p = password.trim();
    if (!n) { setError("Name is required."); return; }
    if (!m) { setError("Mobile number is required."); return; }
    if (!e) { setError("Email is required."); return; }
    if (!p) { setError("Password is required."); return; }
    if (isDuplicateEmail(e, editingId)) { setError(`"${e}" is already in use by another user.`); return; }

    if (editingId) {
      setData({ ...data, users: users.map((u) => (u.id === editingId ? { ...u, name: n, mobile: m, email: e, password: p } : u)) });
    } else {
      setData({ ...data, users: [...users, { id: uid("user"), name: n, mobile: m, email: e, password: p }] });
    }
    cancelEdit();
  };

  const removeUser = (id) => {
    setData({ ...data, users: users.filter((u) => u.id !== id) });
    setConfirmDeleteId(null);
  };

  return (
    <div>
      <Header title="Users" subtitle="Login accounts — name, mobile number, email and password." />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? "Edit user" : "Add user"}</Label>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Name</Label>
            <Input placeholder="e.g. Priya Kumar" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Mobile number</Label>
            <Input placeholder="e.g. 9876543210" value={mobile} onChange={(e) => { setMobile(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" placeholder="e.g. priya@southhandlooms.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} />
          </div>
          <div className="sm:col-span-2 relative">
            <Label>Password</Label>
            <Input
              type={showPassword ? "text" : "password"} className="pr-9" placeholder="Password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2.5 top-[30px] text-stone-400 hover:text-stone-600">
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>{editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? "Update" : "Add"} user</Btn>
          {editingId && <Btn variant="ghost" onClick={cancelEdit}><X size={15} /> Cancel</Btn>}
        </div>
      </Card>

      <Card>
        {users.length === 0 ? (
          <Empty icon={KeyRound} title="No users yet" hint="Add your first login account above." />
        ) : (
          <div className="divide-y divide-stone-100">
            {users.map((u) => (
              <div key={u.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-semibold text-stone-800">{u.name}</div>
                  <div className="text-xs text-stone-500 mt-0.5 flex flex-wrap gap-x-3">
                    <span>{u.mobile}</span>
                    <span>{u.email}</span>
                    <span className="flex items-center gap-1 yll-mono">
                      {revealedId === u.id ? u.password : "•".repeat(Math.max(u.password.length, 6))}
                      <button onClick={() => setRevealedId(revealedId === u.id ? null : u.id)} className="text-stone-400 hover:text-stone-600">
                        {revealedId === u.id ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn title="Edit" onClick={() => startEdit(u)}><Pencil size={14} /></IconBtn>
                  {canDelete && (confirmDeleteId === u.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <button onClick={() => removeUser(u.id)} className="font-semibold underline text-[#0D9488]">Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">Cancel</button>
                    </div>
                  ) : (
                    <IconBtn title="Delete" danger onClick={() => setConfirmDeleteId(u.id)}><Trash2 size={14} /></IconBtn>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* =================================================================
   WEAVERS
==================================================================*/
function WeaversMaster({ data, setData, canDelete }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [error, setError] = useState("");

  const weavers = data.weavers;
  const productionOrders = data.productionOrders;

  const startEdit = (w) => {
    setEditingId(w.id); setName(w.name); setAddress(w.address); setWhatsapp(w.whatsapp); setEmail(w.email || "");
    setError("");
  };
  const cancelEdit = () => {
    setEditingId(null); setName(""); setAddress(""); setWhatsapp(""); setEmail(""); setError("");
  };

  const submit = () => {
    const n = name.trim(), a = address.trim(), w = whatsapp.trim(), e = email.trim();
    if (!n) { setError("Weaver name is required."); return; }
    if (editingId) {
      setData({ ...data, weavers: weavers.map((row) => (row.id === editingId ? { ...row, name: n, address: a, whatsapp: w, email: e } : row)) });
    } else {
      setData({ ...data, weavers: [...weavers, { id: uid("weaver"), name: n, address: a, whatsapp: w, email: e }] });
    }
    cancelEdit();
  };

  const removeWeaver = (id) => {
    setData({ ...data, weavers: weavers.filter((w) => w.id !== id) });
    setConfirmDeleteId(null);
  };

  return (
    <div>
      <Header title="Weavers" subtitle="Weaver name, address, WhatsApp number and email — used when creating Production Orders." />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? "Edit weaver" : "Add weaver"}</Label>
        <div className="grid gap-3">
          <div>
            <Label>Weaver name</Label>
            <Input placeholder="e.g. Murugan Weaves" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Address (optional)</Label>
            <Input placeholder="e.g. 12 Weavers Colony, Kanchipuram" value={address} onChange={(e) => { setAddress(e.target.value); setError(""); }} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>WhatsApp number (optional)</Label>
              <Input placeholder="e.g. 9876543210" value={whatsapp} onChange={(e) => { setWhatsapp(e.target.value); setError(""); }} />
            </div>
            <div>
              <Label>Email (optional)</Label>
              <Input type="email" placeholder="optional" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} />
            </div>
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>{editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? "Update" : "Add"} weaver</Btn>
          {editingId && <Btn variant="ghost" onClick={cancelEdit}><X size={15} /> Cancel</Btn>}
        </div>
      </Card>

      <Card>
        {weavers.length === 0 ? (
          <Empty icon={Users} title="No weavers yet" hint="Add your first weaver above." />
        ) : (
          <div className="divide-y divide-stone-100">
            {weavers.map((w) => {
              const weaverInUse = isWeaverInUse(w.id, productionOrders);
              return (
                <div key={w.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-semibold text-stone-800">{w.name}</div>
                    {(w.address || w.whatsapp || w.email) && (
                      <div className="text-xs text-stone-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        {w.address && <span className="flex items-center gap-1"><MapPin size={11} />{w.address}</span>}
                        {w.whatsapp && <span className="flex items-center gap-1"><Phone size={11} />{w.whatsapp}</span>}
                        {w.email && <span className="flex items-center gap-1"><Mail size={11} />{w.email}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconBtn title="Edit" onClick={() => startEdit(w)}><Pencil size={14} /></IconBtn>
                    {canDelete && (confirmDeleteId === w.id ? (
                      <div className="flex items-center gap-2 text-xs">
                        <button onClick={() => removeWeaver(w.id)} className="font-semibold underline text-[#0D9488]">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">Cancel</button>
                      </div>
                    ) : (
                      <IconBtn
                        title={weaverInUse ? "Used in a Production Order — can't delete" : "Delete"}
                        danger onClick={() => setConfirmDeleteId(w.id)} disabled={weaverInUse}
                      ><Trash2 size={14} /></IconBtn>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* =================================================================
   FABRIC TYPES

   A Design No's leading letters (e.g. "MS" in "MS-147") are matched
   against a Fabric Type's Code to work out what kind of fabric an
   order is, and which unit ("Mts"/"Pcs") its quantities are in — used
   throughout Production Orders and the printed slip.
==================================================================*/
const MEASURING_TERMS = ["Mts", "Pcs"];

function FabricTypesMaster({ data, setData, canDelete }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [measuringTerm, setMeasuringTerm] = useState(MEASURING_TERMS[0]);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("codeAsc");

  const fabricTypes = data.fabricTypes;
  const designs = data.designs;

  const FABRIC_SORTS = {
    codeAsc: { label: "Code (A–Z)", fn: (a, b) => a.code.localeCompare(b.code) },
    nameAsc: { label: "Name (A–Z)", fn: (a, b) => a.name.localeCompare(b.name) },
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? fabricTypes.filter((f) => f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) : fabricTypes;
    return [...filtered].sort(FABRIC_SORTS[sortKey].fn);
  }, [fabricTypes, query, sortKey]);

  const startEdit = (f) => {
    setEditingId(f.id); setCode(f.code); setName(f.name); setMeasuringTerm(f.measuringTerm); setError("");
  };
  const cancelEdit = () => {
    setEditingId(null); setCode(""); setName(""); setMeasuringTerm(MEASURING_TERMS[0]); setError("");
  };

  const submit = () => {
    const c = code.trim(), n = name.trim();
    if (!c) { setError("Code is required."); return; }
    if (!n) { setError("Name is required."); return; }
    const dup = fabricTypes.some((f) => f.id !== editingId && f.code.trim().toUpperCase() === c.toUpperCase());
    if (dup) { setError(`Code "${c.toUpperCase()}" already exists.`); return; }

    if (editingId) {
      setData({ ...data, fabricTypes: fabricTypes.map((f) => (f.id === editingId ? { ...f, code: c, name: n, measuringTerm } : f)) });
    } else {
      setData({ ...data, fabricTypes: [...fabricTypes, { id: uid("fabric"), code: c, name: n, measuringTerm }] });
    }
    cancelEdit();
  };

  const removeFabricType = (id) => {
    setData({ ...data, fabricTypes: fabricTypes.filter((f) => f.id !== id) });
    setConfirmDeleteId(null);
  };

  const isFabricTypeInUse = (code) => designs.some((d) => getDesignPrefix(d.designNo).toUpperCase() === code.trim().toUpperCase());

  return (
    <div>
      <Header title="Fabric Types" />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? "Edit fabric type" : "Add fabric type"}</Label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Code</Label>
            <Input placeholder="e.g. DS" value={code} onChange={(e) => { setCode(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Name</Label>
            <Input placeholder="e.g. Material" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Measuring term</Label>
            <Select value={measuringTerm} onChange={(e) => setMeasuringTerm(e.target.value)}>
              {MEASURING_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>{editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? "Update" : "Add"} fabric type</Btn>
          {editingId && <Btn variant="ghost" onClick={cancelEdit}><X size={15} /> Cancel</Btn>}
        </div>
      </Card>

      {fabricTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Filter by code or name…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <div className="relative">
            <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
              className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
              {Object.entries(FABRIC_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <Card>
        {fabricTypes.length === 0 ? (
          <Empty icon={Boxes} title="No fabric types yet" hint='Add one above — e.g. Code "DS", Name "Material", Mts.' />
        ) : visible.length === 0 ? (
          <Empty icon={Search} title="No matches" hint="Try a different search term." />
        ) : (
          <div className="divide-y divide-stone-100">
            {visible.map((f) => {
              const inUse = isFabricTypeInUse(f.code);
              return (
                <div key={f.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-bold text-stone-800">{f.code}</span>
                    <span className="text-sm text-stone-800">{f.name}</span>
                    <Badge tone="neutral">{f.measuringTerm}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconBtn title="Edit" onClick={() => startEdit(f)}><Pencil size={14} /></IconBtn>
                    {canDelete && (confirmDeleteId === f.id ? (
                      <div className="flex items-center gap-2 text-xs">
                        <button onClick={() => removeFabricType(f.id)} className="font-semibold underline text-[#0D9488]">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">Cancel</button>
                      </div>
                    ) : (
                      <IconBtn
                        title={inUse ? "Used by a Design No — can't delete" : "Delete"}
                        danger onClick={() => setConfirmDeleteId(f.id)} disabled={inUse}
                      ><Trash2 size={14} /></IconBtn>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* =================================================================
   DESIGN LIBRARY
==================================================================*/
const emptyFeeders = () => Array.from({ length: FEEDER_COUNT }, () => ({ card: "", picks: {} }));

/* Calls the Anthropic API to read a spec-sheet image and return the
   fields below as JSON. The result always comes back into the Manual
   Entry form for review — nothing is saved without a look first. */
async function extractSpecSheet(base64, mediaType) {
  const schemaHint = `{"designNo":"MS-147","hooks":"2640","reed":"96","panno":"48\\"","materialType":"","cutSize":"3.66","pickValues":["60","56"],"feeders":[{"feeder":1,"card":"840","picks":{"60":"60.00","56":"56.00"}}]}`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You read handloom design specification sheets and return ONLY valid JSON — no markdown fences, no commentary. Match this exact shape: ${schemaHint}. Read DESIGN NO, HOOK, REED and PANNO from the header. The field labelled TOTAL CUT (sometimes just CUT) on the sheet is the Cut Size — read its number into "cutSize" exactly as printed; it applies to the whole design, not per feeder. If the sheet also names a Material Type elsewhere, read that once into "materialType", also for the whole design. If TOTAL CUT isn't shown anywhere on the sheet, default cutSize to "1" rather than leaving it blank. The PICK row and the FEEDER table share the same base pick values (e.g. 60 and 56) as separate columns — list those values, in the order shown, as "pickValues". For each of the 8 feeder rows (F1-F8) read the CARD number and that feeder's PICK value under each pick-value column, exactly as printed (keep trailing zeros as printed, e.g. "60.00"). Do not read the COLOUR column. If a feeder row is blank or shows "-", use an empty string for card and "0" for its picks. If any field is unreadable, use an empty string rather than guessing.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Extract this design spec sheet as JSON matching the schema." },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No response text from model");
  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function computeAveragePick(feeders, pickValue) {
  return feeders.reduce((sum, f) => sum + (Number(f.picks?.[pickValue]) || 0), 0);
}

/* Pcs → Mts conversion for a fabric measured in pieces. Cut Size is a
   design-level field (same for every feeder of that design), used both
   for the order's headline Mts total and, in Yarn Required, for each
   feeder's own consumption — same single figure either way. */
const designCutSize = (design) => Number(design?.cutSize) || 1;
const lineMtsEquivalent = (qty, unit, cutSize) => {
  const q = Number(qty) || 0;
  return unit === "Pcs" ? q * cutSize : q;
};

const DESIGN_SORTS = {
  newest: { label: "Newest first", fn: (a, b) => b.createdAt - a.createdAt },
  oldest: { label: "Oldest first", fn: (a, b) => a.createdAt - b.createdAt },
  designAsc: { label: "Design No (A–Z)", fn: (a, b) => a.designNo.localeCompare(b.designNo) },
  pickAsc: { label: "Pick (low–high)", fn: (a, b) => parseFloat(a.pick) - parseFloat(b.pick) },
};

function DesignLibrary({ data, setData, canDelete }) {
  const [view, setView] = useState("list"); // "list" | "new" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [viewingSheetId, setViewingSheetId] = useState(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("newest");
  const designs = data.designs;
  const sheets = data.sheets;

  /* sheetDraft (if any) is stored once as its own record and every design
     created from this upload — one per base pick value — links to it by id. */
  const addDesigns = async (records, sheetDraft) => {
    let sheetId = null;
    let nextSheets = sheets;
    if (sheetDraft) {
      const candidateId = uid("sheet");
      const saved = await saveSheetImage(candidateId, sheetDraft.dataUrl);
      // Only link a sheet the save actually confirmed — otherwise "View Sheet"
      // would show up and just fail every time it's clicked.
      if (saved) {
        sheetId = candidateId;
        nextSheets = [{ id: sheetId, fileName: sheetDraft.fileName, uploadedAt: Date.now() }, ...sheets];
      }
    }
    setData({ ...data, designs: [...records.map((r) => ({ ...r, sheetId })), ...designs], sheets: nextSheets });
    setView("list");
  };
  const updateDesign = (id, patch) => {
    setData({ ...data, designs: designs.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    setView("list");
    setEditingId(null);
  };
  const removeDesign = (id) => setData({ ...data, designs: designs.filter((d) => d.id !== id) });

  const viewingSheet = viewingSheetId ? sheets.find((s) => s.id === viewingSheetId) : null;
  const editingDesign = editingId ? designs.find((d) => d.id === editingId) : null;

  const visibleDesigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? designs.filter((d) => d.label.toLowerCase().includes(q) || d.designNo.toLowerCase().includes(q)) : designs;
    return [...filtered].sort(DESIGN_SORTS[sortKey].fn);
  }, [designs, query, sortKey]);

  return (
    <div>
      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <Header title="Design Library" subtitle="Every design spec sheet, one record per base pick value." />
            <Btn onClick={() => setView("new")}><Plus size={15} /> New Design</Btn>
          </div>
          {designs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <div className="relative max-w-xs flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input placeholder="Filter by design no…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
              </div>
              <div className="relative">
                <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                  className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
                  {Object.entries(DESIGN_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          )}
          <DesignsList
            designs={visibleDesigns}
            onDelete={removeDesign}
            onViewSheet={setViewingSheetId}
            onEdit={(id) => { setEditingId(id); setView("edit"); }}
            canDelete={canDelete}
            productionOrders={data.productionOrders}
            emptyHint={designs.length === 0 ? 'Add one with "New Design" — upload a spec sheet or enter it manually.' : "No designs match that filter."}
          />
        </>
      )}
      {view === "new" && <NewDesignFlow existingDesigns={designs} fabricTypes={data.fabricTypes} onCancel={() => setView("list")} onSave={addDesigns} />}
      {view === "edit" && editingDesign && (
        <EditDesignForm
          design={editingDesign}
          existingDesigns={designs}
          fabricTypes={data.fabricTypes}
          onCancel={() => { setView("list"); setEditingId(null); }}
          onSave={(patch) => updateDesign(editingDesign.id, patch)}
        />
      )}
      {viewingSheet && <SheetViewerModal sheet={viewingSheet} onClose={() => setViewingSheetId(null)} />}
    </div>
  );
}

function SheetViewerModal({ sheet, onClose }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImgUrl(null);
    setFailed(false);
    loadSheetImage(sheet.id).then((url) => {
      if (cancelled) return;
      if (url) setImgUrl(url); else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [sheet.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0">
          <span className="text-sm font-semibold text-stone-800">{sheet.fileName || "Uploaded spec sheet"}</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={18} /></button>
        </div>
        <div className="overflow-auto yll-scrollbar flex items-center justify-center min-h-[160px]">
          {imgUrl ? (
            <img src={imgUrl} alt="Uploaded spec sheet" className="w-full h-auto block" />
          ) : failed ? (
            <p className="text-sm text-stone-500 py-10">Couldn't load this sheet.</p>
          ) : (
            <Loader2 className="animate-spin text-stone-400 my-10" size={22} />
          )}
        </div>
      </div>
    </div>
  );
}

/* Collapsed one-line-per-design list — label, a teal pick pill, and
   text actions. No expanded feeder breakdown here; open Edit to see
   or change the full record. */
function DesignsList({ designs, onDelete, onViewSheet, onEdit, canDelete, productionOrders, emptyHint }) {
  const [confirmId, setConfirmId] = useState(null);
  if (designs.length === 0) {
    return <Card><Empty icon={Grid3x3} title="No designs found" hint={emptyHint} /></Card>;
  }
  return (
    <div className="flex flex-col gap-2">
      {designs.map((d) => {
        const designInUse = isDesignInUse(d.id, productionOrders);
        return (
          <Card key={d.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-sm font-semibold text-stone-800">{d.label}</span>
              <span style={{ backgroundColor: "#F0FDFA", color: "#0F766E" }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">{d.pick}</span>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              {d.sheetId && (
                <button onClick={() => onViewSheet(d.sheetId)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
                  <ImageIcon size={13} /> View Sheet
                </button>
              )}
              <button onClick={() => onEdit(d.id)} className="flex items-center gap-1 text-stone-500 hover:text-stone-700">
                <Pencil size={13} /> Edit
              </button>
              {canDelete && (confirmId === d.id ? (
                <span className="flex items-center gap-2">
                  <button onClick={() => { onDelete(d.id); setConfirmId(null); }} className="font-semibold underline text-[#0D9488]">Delete</button>
                  <button onClick={() => setConfirmId(null)} className="font-semibold text-stone-500">Cancel</button>
                </span>
              ) : designInUse ? (
                <span title="Used in a Production Order — can't delete" className="flex items-center gap-1 text-stone-300 cursor-not-allowed">
                  <Trash2 size={13} /> Delete
                </span>
              ) : (
                <button onClick={() => setConfirmId(d.id)} className="flex items-center gap-1 text-stone-400 hover:text-[#0D9488]">
                  <Trash2 size={13} /> Delete
                </button>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/* Edits a single already-saved design record in place. Only one Pick
   value applies here (a design was already split per pick value when
   created), so Pick is a plain suffixed field rather than the chip
   list used during creation. */
function EditDesignForm({ design, existingDesigns, fabricTypes, onCancel, onSave }) {
  const [designNo, setDesignNo] = useState(design.designNo);
  const [hooks, setHooks] = useState(design.hooks);
  const [reed, setReed] = useState(stripReedSuffix(design.reed));
  const [panno, setPanno] = useState(design.panno);
  const [salvage, setSalvage] = useState(design.salvage || "");
  const [pick, setPick] = useState(stripPickSuffix(design.pick));
  const [materialType, setMaterialType] = useState(design.materialType || "");
  const [cutSize, setCutSize] = useState(design.cutSize || "1");
  const matchedFabricType = findFabricType(designNo, fabricTypes);
  useEffect(() => {
    if (matchedFabricType) setMaterialType(matchedFabricType.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designNo, matchedFabricType?.name]);
  const [feeders, setFeeders] = useState(() => {
    const base = Array.from({ length: FEEDER_COUNT }, () => ({ card: "", pickValue: "" }));
    design.feeders.forEach((f, i) => {
      if (i < FEEDER_COUNT) base[i] = { card: f.card || "", pickValue: f.pick || "" };
    });
    return base;
  });
  const [error, setError] = useState("");

  const updateFeeder = (idx, patch) => setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const averagePick = feeders.reduce((sum, f) => sum + (Number(f.pickValue) || 0), 0);

  const submit = () => {
    const n = designNo.trim();
    const reedRaw = reed.trim();
    const pickRaw = pick.trim();
    if (!n) { setError("Design No is required."); return; }
    if (!hooks.trim()) { setError("Hooks is required."); return; }
    if (!reedRaw) { setError("Reed is required."); return; }
    if (!panno.trim()) { setError("Panno / width is required."); return; }
    if (!pickRaw) { setError("Pick is required."); return; }
    if (!feeders.some((f) => isActiveCard(f.card))) { setError("Add at least one feeder card number."); return; }

    const hasSibling = existingDesigns.some((d) => d.id !== design.id && d.designNo.trim().toLowerCase() === n.toLowerCase());
    const pickLabel = withPickSuffix(pickRaw);
    const label = hasSibling ? `${n} (${pickLabel})` : n;
    if (existingDesigns.some((d) => d.id !== design.id && d.label === label)) {
      setError(`"${label}" already exists in the Design Library.`);
      return;
    }

    onSave({
      label, designNo: n, hooks: hooks.trim(), reed: withReedSuffix(reedRaw), panno: panno.trim(),
      salvage: salvage.trim(),
      pick: pickLabel, materialType: materialType.trim(), cutSize: cutSize.trim() || "1",
      feeders: feeders.map((f, i) => ({ feeder: i + 1, card: f.card.trim(), pick: f.pickValue || "" })),
      averagePick,
    });
  };

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
        <ArrowLeft size={15} /> Back
      </button>
      <Header title={`Edit Design — ${design.label}`} />

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Design No</Label><Input value={designNo} onChange={(e) => { setDesignNo(e.target.value); setError(""); }} /></div>
          <div><Label>Hooks</Label><Input value={hooks} onChange={(e) => { setHooks(e.target.value); setError(""); }} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div><Label>Width</Label><Input value={panno} onChange={(e) => { setPanno(e.target.value); setError(""); }} /></div>
          <div><Label>Reed</Label><SuffixedInput suffix="r" value={reed} onChange={(e) => { setReed(e.target.value); setError(""); }} /></div>
          <div><Label>Salvage (if any)</Label><Input value={salvage} onChange={(e) => setSalvage(e.target.value)} placeholder="—" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="max-w-[160px]">
            <Label>Pick</Label>
            <SuffixedInput suffix="p" value={pick} onChange={(e) => { setPick(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Material Type</Label>
            <Input
              value={materialType} onChange={(e) => setMaterialType(e.target.value)}
              disabled={!!matchedFabricType} placeholder={matchedFabricType ? "" : "Not set up in Fabric Types"}
            />
          </div>
          <div><Label>Cut Size</Label><Input value={cutSize} onChange={(e) => setCutSize(e.target.value)} placeholder="1" /></div>
        </div>
      </Card>

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-stone-200">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Feeders</h2>
        </div>
        <div className="overflow-x-auto yll-scrollbar">
          <table className="w-full text-sm min-w-[360px]">
            <thead>
              <tr className="text-stone-400 text-xs">
                <th className="text-left font-semibold px-4 py-2">Feeder</th>
                <th className="text-left font-semibold px-2 py-2">Card</th>
                <th className="text-right font-semibold px-3 py-2">{withPickSuffix(pick)}</th>
              </tr>
            </thead>
            <tbody>
              {feeders.map((f, idx) => (
                <tr key={idx} className="border-t border-stone-100">
                  <td className="px-4 py-1.5 text-stone-500 yll-mono">F{idx + 1}</td>
                  <td className="px-2 py-1.5 w-28"><Input value={f.card} onChange={(e) => updateFeeder(idx, { card: e.target.value })} placeholder="—" /></td>
                  <td className="px-3 py-1.5 w-24"><Input className="text-right" value={f.pickValue} onChange={(e) => updateFeeder(idx, { pickValue: e.target.value })} placeholder="0.00" /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200">
                <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={2}>Average pick</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 yll-mono">{fmt(averagePick)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit}><Check size={15} /> Save changes</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function NewDesignFlow({ existingDesigns, fabricTypes, onCancel, onSave }) {
  const [step, setStep] = useState("choose"); // "choose" | "manual"
  const [prefill, setPrefill] = useState(null);
  const [sheetDraft, setSheetDraft] = useState(null); // { dataUrl, fileName }
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setUploadError(""); setUploadNotice(""); setUploading(true);
    let dataUrl;
    try {
      dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error("Could not read file"));
        r.readAsDataURL(file);
      });
      dataUrl = await compressImageDataUrl(dataUrl); // keeps storage & the API call well under size limits
    } catch (e) {
      setUploadError("Couldn't read that file — please try another photo.");
      setUploading(false);
      return;
    }
    // The photo itself is kept regardless of whether auto-read succeeds.
    setSheetDraft({ dataUrl, fileName: file.name });
    try {
      const extracted = await extractSpecSheet(dataUrl.split(",")[1], file.type || "image/jpeg");
      setPrefill(extracted);
    } catch (e) {
      setPrefill(null);
      setUploadNotice("Couldn't read the fields automatically — the photo is attached below; please fill them in.");
    } finally {
      setUploading(false);
      setStep("manual");
    }
  };

  const handleSave = (records) => onSave(records, sheetDraft);

  if (step === "choose") {
    return (
      <div>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
          <ArrowLeft size={15} /> Back to Design Library
        </button>
        <Header title="New Design" subtitle="Upload a spec sheet photo and let it read the fields, or enter everything by hand." />
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-left">
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                {uploading ? <Loader2 size={18} className="text-[#0D9488] animate-spin" /> : <Upload size={18} className="text-[#0D9488]" />}
              </div>
              <div className="text-sm font-semibold text-stone-800">Upload Spec Sheet</div>
              <div className="text-xs text-stone-500 mt-1">{uploading ? "Reading the sheet…" : "Photo or scan of the design sheet — fields are read automatically for you to review, and the photo is saved for later."}</div>
            </Card>
          </button>
          <button onClick={() => { setPrefill(null); setSheetDraft(null); setStep("manual"); }} className="text-left">
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                <FileEdit size={18} className="text-[#0D9488]" />
              </div>
              <div className="text-sm font-semibold text-stone-800">Manual Entry</div>
              <div className="text-xs text-stone-500 mt-1">Type in Design No, Hooks, Reed, Panno and the feeder table yourself.</div>
            </Card>
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        {uploadError && <div className="text-xs mt-3 text-[#0D9488] max-w-2xl">{uploadError}</div>}
      </div>
    );
  }

  return <ManualDesignForm prefill={prefill} uploadNotice={uploadNotice} sheetDraft={sheetDraft} existingDesigns={existingDesigns} fabricTypes={fabricTypes} onBack={() => setStep("choose")} onCancel={onCancel} onSave={handleSave} />;
}

function ManualDesignForm({ prefill, uploadNotice, sheetDraft, existingDesigns, fabricTypes, onBack, onCancel, onSave }) {
  const [designNo, setDesignNo] = useState(prefill?.designNo || "");
  const [hooks, setHooks] = useState(prefill?.hooks || "");
  const [reed, setReed] = useState(stripReedSuffix(prefill?.reed || ""));
  const [panno, setPanno] = useState(prefill?.panno || "");
  const [salvage, setSalvage] = useState(prefill?.salvage || "");
  const [materialType, setMaterialType] = useState(prefill?.materialType || "");
  const [cutSize, setCutSize] = useState(prefill?.cutSize || "1");
  const matchedFabricType = findFabricType(designNo, fabricTypes);
  // Material Type is captured automatically from the Fabric Type whose Code
  // matches the Design No's prefix (e.g. "JM" in JM-3) — it isn't typed in
  // by hand once that match exists.
  useEffect(() => {
    if (matchedFabricType) setMaterialType(matchedFabricType.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designNo, matchedFabricType?.name]);
  const [pickValues, setPickValues] = useState(
    prefill?.pickValues?.length ? prefill.pickValues.map(stripPickSuffix) : [""]
  );
  const [pickDraft, setPickDraft] = useState("");
  const [feeders, setFeeders] = useState(() => {
    const base = emptyFeeders();
    if (prefill?.feeders) {
      prefill.feeders.forEach((f, i) => {
        if (i < FEEDER_COUNT) base[i] = { card: f.card || "", picks: { ...(f.picks || {}) } };
      });
    }
    return base;
  });
  const [error, setError] = useState("");

  const addPickValue = () => {
    const v = stripPickSuffix(pickDraft);
    if (!v) return;
    if (pickValues.includes(v)) { setPickDraft(""); return; }
    setPickValues([...pickValues.filter(Boolean), v]);
    setPickDraft("");
  };
  const removePickValue = (v) => {
    if (pickValues.length <= 1) return;
    setPickValues(pickValues.filter((p) => p !== v));
  };

  const updateFeeder = (idx, patch) => setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const updateFeederPick = (idx, pickValue, val) =>
    setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, picks: { ...r.picks, [pickValue]: val } } : r)));

  const activePickValues = pickValues.filter(Boolean);

  const submit = () => {
    const n = designNo.trim();
    const reedRaw = reed.trim();
    if (!n) { setError("Design No is required."); return; }
    if (!hooks.trim()) { setError("Hooks is required."); return; }
    if (!reedRaw) { setError("Reed is required."); return; }
    if (!panno.trim()) { setError("Panno / width is required."); return; }
    if (activePickValues.length === 0) { setError("Add at least one base pick value."); return; }
    if (!feeders.some((f) => isActiveCard(f.card))) { setError("Add at least one feeder card number."); return; }

    const multi = activePickValues.length > 1;
    let records;
    try {
      records = activePickValues.map((pv) => {
        const pickLabel = withPickSuffix(pv);
        const label = multi ? `${n} (${pickLabel})` : n;
        if (existingDesigns.some((d) => d.label === label)) {
          throw new Error(`"${label}" already exists in the Design Library.`);
        }
        return {
          id: uid("design"),
          label, designNo: n, hooks: hooks.trim(), reed: withReedSuffix(reedRaw), panno: panno.trim(),
          salvage: salvage.trim(),
          pick: pickLabel, materialType: materialType.trim(), cutSize: cutSize.trim() || "1",
          feeders: feeders.map((f, i) => ({ feeder: i + 1, card: f.card.trim(), pick: f.picks[pv] || "" })),
          averagePick: computeAveragePick(feeders, pv),
          createdAt: Date.now(),
        };
      });
    } catch (e) {
      setError(e.message);
      return;
    }
    onSave(records);
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
        <ArrowLeft size={15} /> Back
      </button>
      <Header title="New Design — Manual Entry" />
      {prefill && (
        <div style={{ backgroundColor: "#F0FDFA" }} className="rounded px-3 py-2 text-xs text-[#0F766E] mb-5 max-w-2xl">
          Read from the uploaded sheet — check every field below before saving.
        </div>
      )}
      {uploadNotice && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 max-w-2xl">{uploadNotice}</div>
      )}
      {sheetDraft && (
        <div className="mb-5 max-w-2xl">
          <Label>Uploaded sheet</Label>
          <img src={sheetDraft.dataUrl} alt="Uploaded spec sheet" className="rounded border border-stone-200 max-h-64 w-auto" />
        </div>
      )}

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Design No</Label>
            <Input placeholder="e.g. MS-147" value={designNo} onChange={(e) => { setDesignNo(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Hooks</Label>
            <Input placeholder="e.g. 2640" value={hooks} onChange={(e) => { setHooks(e.target.value); setError(""); }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <Label>Width</Label>
            <Input placeholder="e.g. 48&quot;" value={panno} onChange={(e) => { setPanno(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Reed</Label>
            <SuffixedInput suffix="r" placeholder="e.g. 96" value={reed} onChange={(e) => { setReed(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Salvage (if any)</Label>
            <Input placeholder="—" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4 items-start">
          <div>
            <Label>Base pick values</Label>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {activePickValues.map((v) => (
                <span key={v} className="inline-flex items-center gap-1.5 bg-stone-100 text-stone-700 text-sm font-medium px-2.5 py-1 rounded-full">
                  {withPickSuffix(v)}
                  {pickValues.length > 1 && <button onClick={() => removePickValue(v)} className="text-stone-400 hover:text-[#0D9488]"><X size={12} /></button>}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="e.g. 60" value={pickDraft} onChange={(e) => setPickDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPickValue(); } }} />
              <Btn variant="ghost" onClick={addPickValue}><Plus size={14} /> Add</Btn>
            </div>
          </div>
          <div>
            <Label>Material Type</Label>
            <Input
              value={materialType} onChange={(e) => setMaterialType(e.target.value)}
              disabled={!!matchedFabricType} placeholder={matchedFabricType ? "" : "Not set up in Fabric Types"}
            />
          </div>
          <div><Label>Cut Size</Label><Input value={cutSize} onChange={(e) => setCutSize(e.target.value)} placeholder="1" /></div>
        </div>
        {activePickValues.length > 1 && (
          <p className="text-xs text-stone-500 mt-2">This will create {activePickValues.length} separate designs — {activePickValues.map((v) => `"${designNo || "…"} (${withPickSuffix(v)})"`).join(", ")}.</p>
        )}
      </Card>

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-stone-200">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Feeders</h2>
        </div>
        <div className="overflow-x-auto yll-scrollbar">
          <table className="w-full text-sm min-w-[440px]">
            <thead>
              <tr className="text-stone-400 text-xs">
                <th className="text-left font-semibold px-4 py-2">Feeder</th>
                <th className="text-left font-semibold px-2 py-2">Card</th>
                {activePickValues.map((v) => <th key={v} className="text-right font-semibold px-3 py-2">{withPickSuffix(v)}</th>)}
              </tr>
            </thead>
            <tbody>
              {feeders.map((f, idx) => (
                <tr key={idx} className="border-t border-stone-100">
                  <td className="px-4 py-1.5 text-stone-500 yll-mono">F{idx + 1}</td>
                  <td className="px-2 py-1.5 w-28"><Input value={f.card} onChange={(e) => updateFeeder(idx, { card: e.target.value })} placeholder="—" /></td>
                  {activePickValues.map((v) => (
                    <td key={v} className="px-3 py-1.5 w-24">
                      <Input className="text-right" value={f.picks[v] || ""} onChange={(e) => updateFeederPick(idx, v, e.target.value)} placeholder="0.00" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200">
                <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={2}>Average pick (total of feeder picks)</td>
                {activePickValues.map((v) => (
                  <td key={v} className="px-3 py-2 text-right text-sm font-semibold text-stone-800 yll-mono">{fmt(computeAveragePick(feeders, v))}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit}><Check size={15} /> Save design{activePickValues.length > 1 ? "s" : ""}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* =================================================================
   PRODUCTION ORDERS

   PO No/date, weaver, width and design are captured up front. Reed
   and Base Pick are pulled straight from the selected design record,
   and the feeder grid's row count follows that design's own active
   feeder count. Each feeder row picks a Yarn Quality (a Yarn Library
   type) and then a Colour — restricted to that type's own colour
   subset — plus a quantity in metres.

   A saved order opens straight into a printable/downloadable slip
   with the company letterhead and the weaver's "To" block.
==================================================================*/

/* Best-effort read of a PO screenshot. Sheets with several colourway
   groups for the same design (like a multi-feeder-set photo) only
   have their first group read — the rest still need separate orders,
   since each order here is one feeder set. */
async function extractProductionOrder(base64, mediaType) {
  const schemaHint = `{"poNo":"2219","poDate":"2026-09-09","width":"48","designNo":"MS-147","pick":"56","warpYarnQuality":"30S KOTA BLACK","feederQuality":[{"feeder":1,"yarnQuality":"30 S EXCEL"}],"lines":[{"sl":1,"colours":[{"feeder":1,"colourText":"MEROON 1606B"}],"qty":"200"}]}`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: `You read handloom production order sheets and return ONLY valid JSON — no markdown fences, no commentary. Match this exact shape: ${schemaHint}. Read the order/PO number, the order date (convert it to YYYY-MM-DD), the width, and the design number. Also read the base Pick value shown near the top of the sheet (often labelled "PICK" or "PICK (GROUND)") as "pick" — this single number is NOT the same as the per-row quantities inside the feeder/colourway table further down, and the same design number can exist at more than one base Pick, so read it carefully. If a base/warp yarn (often labelled "BASE WARP" or similar) is shown, read its full text as "warpYarnQuality" — it usually includes both a yarn quality and a colour in one phrase. Each feeder has one yarn quality text (e.g. "30 S EXCEL", "150 POLY", "JARI") that stays the same for every colourway — list that once per feeder in "feederQuality". Then list every colourway row as an entry in "lines": a serial number, the colour/shade text for each feeder in that row, and the quantity in metres for that row. If a field is unreadable, use an empty string rather than guessing.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Extract this production order as JSON matching the schema." },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No response text from model");
  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function ProductionOrders({ data, setData, canDelete }) {
  const [view, setView] = useState("list"); // "list" | "new" | "edit" | "slip"
  const [slipOrderId, setSlipOrderId] = useState(null);
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [viewingSheetId, setViewingSheetId] = useState(null);
  const [weaverFilter, setWeaverFilter] = useState("");
  const [sortKey, setSortKey] = useState("dateNewest");
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [query, setQuery] = useState("");
  const orders = data.productionOrders.filter((o) => getFY(o.poDate) === data.currentFY);
  const sheets = data.sheets;
  const weavers = data.weavers;
  const fyLocked = (data.closedFYs || []).includes(data.currentFY);

  /* sheetDraft (if any) is stored once as its own record, same pattern as
     Design uploads — only linked to the order once the save is confirmed,
     so "View Sheet" never points at an image that isn't actually there. */
  const addOrder = async (order, sheetDraft) => {
    let sheetId = null;
    let nextSheets = sheets;
    if (sheetDraft) {
      const candidateId = uid("sheet");
      const saved = await saveSheetImage(candidateId, sheetDraft.dataUrl);
      if (saved) {
        sheetId = candidateId;
        nextSheets = [{ id: sheetId, fileName: sheetDraft.fileName, uploadedAt: Date.now() }, ...sheets];
      }
    }
    const withSheet = { ...order, sheetId };
    setData({ ...data, productionOrders: [withSheet, ...data.productionOrders], sheets: nextSheets });
    setSlipOrderId(order.id);
    setView("slip");
  };
  const updateOrder = (updated) => {
    setData({ ...data, productionOrders: data.productionOrders.map((o) => (o.id === updated.id ? updated : o)) });
    setSlipOrderId(updated.id);
    setView("slip");
    setEditingOrderId(null);
  };
  const removeOrder = (id) => setData({ ...data, productionOrders: data.productionOrders.filter((o) => o.id !== id) });

  const slipOrder = slipOrderId ? orders.find((o) => o.id === slipOrderId) : null;
  const editingOrder = editingOrderId ? orders.find((o) => o.id === editingOrderId) : null;
  const viewingSheet = viewingSheetId ? sheets.find((s) => s.id === viewingSheetId) : null;

  const filteredSorted = useMemo(() => {
    let list = weaverFilter ? orders.filter((o) => o.weaverId === weaverFilter) : orders;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((o) => orderMatchesQuery(o, q));
    return [...list].sort(ORDER_SORTS[sortKey].fn);
  }, [orders, weaverFilter, sortKey, query]);
  const activeOrders = filteredSorted.filter((o) => orderStatus(o) === "pending");
  const closedOrders = filteredSorted.filter((o) => orderStatus(o) !== "pending");

  return (
    <div>
      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <Header title="Production Orders" subtitle="Weaver, design, and a colour + quantity per feeder — Reed and Base Pick come from the design automatically." />
            <Btn onClick={() => setView("new")} disabled={fyLocked}><Plus size={15} /> New Production Order</Btn>
          </div>
          {fyLocked && (
            <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 flex items-center gap-1.5">
              <Lock size={13} /> FY {data.currentFY} is closed — read-only. Switch to an open year from the sidebar to make changes.
            </div>
          )}

          {orders.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-5">
              <div className="relative max-w-xs flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input placeholder="Search PO no, design no…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
              </div>
              <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
                <option value="">All weavers</option>
                {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              <div className="relative">
                <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                  className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
                  {Object.entries(ORDER_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {orders.length === 0 ? (
            <Card><Empty icon={FileText} title="No production orders yet" hint='Add one with "New Production Order" — upload a screenshot or enter it manually.' /></Card>
          ) : (
            <>
              <button onClick={() => setActiveExpanded((v) => !v)} className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-stone-700">
                {activeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Active ({activeOrders.length})
              </button>
              {activeExpanded && (
                <ProductionOrdersList
                  orders={activeOrders}
                  onDelete={removeOrder}
                  onView={(id) => { setSlipOrderId(id); setView("slip"); }}
                  onEdit={(id) => { setEditingOrderId(id); setView("edit"); }}
                  onViewSheet={setViewingSheetId}
                  canDelete={canDelete && !fyLocked}
                  canEdit={!fyLocked}
                  receipts={data.receipts}
                  emptyHint="No active orders match this filter."
                />
              )}

              <button onClick={() => setClosedExpanded((v) => !v)} className="mt-6 mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-stone-700">
                {closedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Closed ({closedOrders.length})
              </button>
              {closedExpanded && (
                <ProductionOrdersList
                  orders={closedOrders}
                  onDelete={removeOrder}
                  onView={(id) => { setSlipOrderId(id); setView("slip"); }}
                  onEdit={(id) => { setEditingOrderId(id); setView("edit"); }}
                  onViewSheet={setViewingSheetId}
                  canDelete={canDelete && !fyLocked}
                  canEdit={!fyLocked}
                  receipts={data.receipts}
                  emptyHint="No closed orders match this filter."
                />
              )}
            </>
          )}
        </>
      )}
      {view === "new" && (
        <NewProductionOrderFlow data={data} setData={setData} existingOrders={orders} onCancel={() => setView("list")} onSave={addOrder} />
      )}
      {view === "edit" && editingOrder && (
        <ManualProductionOrderForm
          data={data} setData={setData} existingOrders={orders}
          editingOrder={editingOrder}
          onBack={() => { setView("list"); setEditingOrderId(null); }}
          onCancel={() => { setView("list"); setEditingOrderId(null); }}
          onSave={updateOrder}
        />
      )}
      {view === "slip" && slipOrder && (
        <OrderSlip order={slipOrder} fabricTypes={data.fabricTypes} onBack={() => { setView("list"); setSlipOrderId(null); }} onViewSheet={setViewingSheetId} />
      )}
      {viewingSheet && <SheetViewerModal sheet={viewingSheet} onClose={() => setViewingSheetId(null)} />}
    </div>
  );
}

/* Pending / Closed / Short-Closed — shared between the Production Orders
   list and the Pending Orders tab. */
function StatusBadge({ status }) {
  const styles = {
    pending: { backgroundColor: "#FFFBEB", color: "#B45309" },
    closed: { backgroundColor: "#F0FDFA", color: "#0F766E" },
    "short-closed": { backgroundColor: "#F5F5F4", color: "#57534E" },
  };
  const labels = { pending: "Pending", closed: "Closed", "short-closed": "Short-Closed" };
  return <span style={styles[status]} className="px-2 py-0.5 rounded-full text-[11px] font-semibold">{labels[status]}</span>;
}

function ProductionOrdersList({ orders, onDelete, onView, onEdit, onViewSheet, canDelete, canEdit = true, receipts, emptyHint }) {
  const [confirmId, setConfirmId] = useState(null);
  if (orders.length === 0) {
    return <Card><Empty icon={FileText} title="No orders" hint={emptyHint} /></Card>;
  }
  return (
    <div className="flex flex-col gap-2">
      {orders.map((o) => {
        const orderInUse = isOrderInUse(o.id, receipts);
        return (
        <Card key={o.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-sm font-semibold text-stone-800">PO {o.poNo}</span>
              <span style={{ backgroundColor: "#F0FDFA", color: "#0F766E" }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">{o.designLabel}</span>
              <StatusBadge status={orderStatus(o)} />
            </div>
            <div className="text-xs text-stone-500 mt-1">
              {o.weaverName} · {fmtDateDMY(o.poDate)} · {formatOrderQty(o)} · {o.warpYarnTypeName} ({o.warpColourName}){o.remarks && <> · {o.remarks}</>}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            {o.sheetId && (
              <button onClick={() => onViewSheet(o.sheetId)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
                <ImageIcon size={13} /> View Sheet
              </button>
            )}
            <button onClick={() => onView(o.id)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
              <Printer size={13} /> View / Print
            </button>
            <button onClick={() => onEdit(o.id)} disabled={!canEdit} className="flex items-center gap-1 text-stone-500 hover:text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Pencil size={13} /> Edit
            </button>
            {canDelete && (confirmId === o.id ? (
              <span className="flex items-center gap-2">
                <button onClick={() => { onDelete(o.id); setConfirmId(null); }} className="font-semibold underline text-[#0D9488]">Delete</button>
                <button onClick={() => setConfirmId(null)} className="font-semibold text-stone-500">Cancel</button>
              </span>
            ) : orderInUse ? (
              <span title="Has goods receipts recorded against it — can't delete" className="flex items-center gap-1 text-stone-300 cursor-not-allowed">
                <Trash2 size={13} /> Delete
              </span>
            ) : (
              <button onClick={() => setConfirmId(o.id)} className="flex items-center gap-1 text-stone-400 hover:text-[#0D9488]">
                <Trash2 size={13} /> Delete
              </button>
            ))}
          </div>
        </Card>
        );
      })}
    </div>
  );
}

function NewProductionOrderFlow({ data, setData, existingOrders, onCancel, onSave }) {
  const [step, setStep] = useState("choose"); // "choose" | "manual"
  const [prefill, setPrefill] = useState(null);
  const [sheetDraft, setSheetDraft] = useState(null); // { dataUrl, fileName }
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setUploadError(""); setUploadNotice(""); setUploading(true);
    let dataUrl;
    try {
      dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error("Could not read file"));
        r.readAsDataURL(file);
      });
      dataUrl = await compressImageDataUrl(dataUrl);
    } catch (e) {
      setUploadError("Couldn't read that file — please try another photo.");
      setUploading(false);
      return;
    }
    // The photo itself is kept regardless of whether auto-read succeeds.
    setSheetDraft({ dataUrl, fileName: file.name });
    try {
      const extracted = await extractProductionOrder(dataUrl.split(",")[1], file.type || "image/jpeg");
      setPrefill(extracted);
    } catch (e) {
      setPrefill(null);
      setUploadNotice("Couldn't read this automatically — please fill in the fields below.");
    } finally {
      setUploading(false);
      setStep("manual");
    }
  };

  if (step === "choose") {
    return (
      <div>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
          <ArrowLeft size={15} /> Back to Production Orders
        </button>
        <Header title="New Production Order" subtitle="Upload a PO screenshot and let it read the fields, or enter everything by hand." />
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-left">
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                {uploading ? <Loader2 size={18} className="text-[#0D9488] animate-spin" /> : <Upload size={18} className="text-[#0D9488]" />}
              </div>
              <div className="text-sm font-semibold text-stone-800">Upload Screenshot</div>
              <div className="text-xs text-stone-500 mt-1">{uploading ? "Reading…" : "A photo or screenshot of the order — fields are read automatically for you to review."}</div>
            </Card>
          </button>
          <button onClick={() => { setPrefill(null); setStep("manual"); }} className="text-left">
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                <FileEdit size={18} className="text-[#0D9488]" />
              </div>
              <div className="text-sm font-semibold text-stone-800">Manual Entry</div>
              <div className="text-xs text-stone-500 mt-1">Type in the PO details and feeder quantities yourself.</div>
            </Card>
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        {uploadError && <div className="text-xs mt-3 text-[#0D9488] max-w-2xl">{uploadError}</div>}
      </div>
    );
  }

  return <ManualProductionOrderForm data={data} setData={setData} existingOrders={existingOrders} prefill={prefill} uploadNotice={uploadNotice} sheetDraft={sheetDraft} onBack={() => setStep("choose")} onCancel={onCancel} onSave={onSave} />;
}

/* ---------- inline "quick add" for Yarn Quality / Colour / Weaver ----------
   Used from New Production Order so a missing master record never has to
   send anyone off to another tab mid-form. Each modal's onCreate returns
   an error string to keep it open, or null on success (the caller closes
   it and applies the new id to whichever select triggered it). */
const AddBtn = ({ title, onClick, disabled }) => (
  <button type="button" title={title} onClick={onClick} disabled={disabled}
    className="shrink-0 w-9 rounded border border-stone-300 text-stone-500 flex items-center justify-center hover:text-[#0D9488] hover:border-[#0D9488] disabled:opacity-40 disabled:cursor-not-allowed">
    <Plus size={14} />
  </button>
);
function QuickAddModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-stone-800">{title}</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function QuickAddYarnTypeModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [denier, setDenier] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!denier.trim()) { setError("Denier is required."); return; }
    const err = onCreate(name.trim(), denier.trim());
    if (err) setError(err);
  };
  return (
    <QuickAddModal title="Add yarn quality" onClose={onClose}>
      <div className="grid gap-3">
        <div><Label>Name of yarn</Label><Input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Viscose Filament" /></div>
        <div><Label>Denier</Label><SuffixedInput suffix="D" value={denier} onChange={(e) => { setDenier(e.target.value); setError(""); }} placeholder="e.g. 150"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} /></div>
      </div>
      {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn onClick={submit}><Plus size={14} /> Add</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </QuickAddModal>
  );
}
function QuickAddColourModal({ yarnLabel, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (!name.trim()) { setError("Colour name is required."); return; }
    const err = onCreate(name.trim());
    if (err) setError(err);
  };
  return (
    <QuickAddModal title={`Add colour — ${yarnLabel}`} onClose={onClose}>
      <div>
        <Label>Colour name</Label>
        <Input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Maroon"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>
      {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn onClick={submit}><Plus size={14} /> Add</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </QuickAddModal>
  );
}
function QuickAddWeaverModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (!name.trim()) { setError("Weaver name is required."); return; }
    const err = onCreate(name.trim(), address.trim(), whatsapp.trim(), email.trim());
    if (err) setError(err);
  };
  return (
    <QuickAddModal title="Add weaver" onClose={onClose}>
      <div className="grid gap-3">
        <div><Label>Weaver name</Label><Input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Murugan Weaves" /></div>
        <div><Label>Address (optional)</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>WhatsApp (optional)</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} /></div>
          <div><Label>Email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
      </div>
      {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn onClick={submit}><Plus size={14} /> Add</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </QuickAddModal>
  );
}

function ManualProductionOrderForm({ data, setData, existingOrders, prefill, uploadNotice, sheetDraft, editingOrder, onBack, onCancel, onSave }) {
  const weavers = data.weavers;
  const designs = data.designs;
  const yarnTypes = data.yarnTypes;

  const [poNo, setPoNo] = useState(editingOrder?.poNo || prefill?.poNo || "");
  const [poDate, setPoDate] = useState(editingOrder?.poDate || prefill?.poDate || todayISO());
  const [weaverId, setWeaverId] = useState(editingOrder?.weaverId || "");
  const [width, setWidth] = useState(editingOrder?.width || prefill?.width || "");
  const [remarks, setRemarks] = useState(editingOrder?.remarks || "");
  const [designId, setDesignId] = useState(() => {
    if (editingOrder) return editingOrder.designId;
    if (!prefill?.designNo) return "";
    // A Design No can exist at more than one base Pick (each pick is its own
    // record) — only auto-pick when there's exactly one candidate, or the
    // sheet's own Pick value narrows it down to exactly one. Guessing wrong
    // between pick variants is worse than leaving it for a manual choice.
    const candidates = designs.filter((d) => d.designNo.trim().toLowerCase() === prefill.designNo.trim().toLowerCase());
    if (candidates.length === 0) return "";
    if (candidates.length === 1) return candidates[0].id;
    const wantPick = prefill.pick ? stripPickSuffix(prefill.pick).toLowerCase() : "";
    const exact = wantPick ? candidates.find((d) => stripPickSuffix(d.pick).toLowerCase() === wantPick) : null;
    return exact ? exact.id : "";
  });
  /* Grid 1 — one Yarn Quality per feeder, entered once for the whole order. */
  const [feederQuality, setFeederQuality] = useState(() =>
    editingOrder ? editingOrder.feederQuality.map((f) => ({ yarnTypeId: f.yarnTypeId })) : []
  ); // [{ yarnTypeId }]
  /* Grid 2 — SL | colour per feeder | qty, any number of colourway rows. */
  const [lines, setLines] = useState(() =>
    editingOrder
      ? editingOrder.lines.map((l) => ({ id: uid("line"), qty: l.qty, colours: l.colours.map((c) => c.colourId) }))
      : []
  ); // [{ id, colours: [colourId,...], qty }]
  const [warpYarnTypeId, setWarpYarnTypeId] = useState(editingOrder?.warpYarnTypeId || "");
  const [warpColourId, setWarpColourId] = useState(editingOrder?.warpColourId || "");
  const [error, setError] = useState("");
  const [addModal, setAddModal] = useState(null); // see the handlers below for the shapes used
  const [viewingUploadedSheet, setViewingUploadedSheet] = useState(false);
  // The design-change effect below normally resets the two grids — skip it
  // just once, on mount, so an edit's seeded rows survive the first render.
  const skipNextGridReset = useRef(!!editingOrder);

  const warpYarnType = warpYarnTypeId ? yarnTypes.find((y) => y.id === warpYarnTypeId) : null;

  const selectedDesign = designId ? designs.find((d) => d.id === designId) : null;
  const fabricType = selectedDesign ? findFabricType(selectedDesign.designNo, data.fabricTypes) : null;
  const unit = fabricType?.measuringTerm || "Mts";
  const activeFeeders = selectedDesign ? selectedDesign.feeders.filter((f) => isActiveCard(f.card)) : [];

  const emptyLine = () => ({ id: uid("line"), colours: activeFeeders.map(() => ""), qty: "" });

  // Grid shape always follows the selected design's own active feeder count
  // — except immediately after mounting into an edit, where it's already
  // been seeded from the saved order above. Width auto-fills from the
  // design's own Panno the same way, for the same reason.
  useEffect(() => {
    if (skipNextGridReset.current) { skipNextGridReset.current = false; return; }
    if (!selectedDesign) { setFeederQuality([]); setLines([]); return; }
    setFeederQuality(activeFeeders.map(() => ({ yarnTypeId: "" })));
    setLines([emptyLine()]);
    setWidth(selectedDesign.panno.replace(/["\s]+$/, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId]);

  // Warp yarn/colour match doesn't depend on the selected design, so it
  // resolves as soon as prefill text is available.
  useEffect(() => {
    const word = (prefill?.warpYarnQuality || "").toLowerCase().trim();
    if (!word) return;
    const yt = yarnTypes.find((y) => word.includes(y.name.toLowerCase()));
    if (!yt) return;
    setWarpYarnTypeId(yt.id);
    const col = yt.colours.find((c) => word.includes(c.colourName.toLowerCase()));
    if (col) setWarpColourId(col.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Best-effort match of an uploaded sheet's text onto existing Yarn
  // Library names/colours — anything unmatched is just left blank to pick.
  useEffect(() => {
    if (!prefill || !selectedDesign) return;
    if (prefill.feederQuality?.length) {
      setFeederQuality((prev) =>
        prev.map((row, i) => {
          const word = (prefill.feederQuality[i]?.yarnQuality || "").toLowerCase().trim();
          if (!word) return row;
          const yt = yarnTypes.find((y) => word.includes(y.name.toLowerCase()) || `${y.name} ${y.denier}`.toLowerCase().includes(word));
          return yt ? { yarnTypeId: yt.id } : row;
        })
      );
    }
    if (prefill.lines?.length) {
      setLines(
        prefill.lines.map((srcLine) => ({
          id: uid("line"),
          qty: srcLine.qty || "",
          colours: activeFeeders.map(() => ""), // filled in by the next effect, once feederQuality resolves
        }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDesign]);

  // Second pass: once feederQuality has resolved yarn types, try to match
  // each prefilled line's colour text against that feeder's colour subset.
  useEffect(() => {
    if (!prefill?.lines?.length || feederQuality.every((r) => !r.yarnTypeId)) return;
    setLines((prev) =>
      prev.map((line, li) => {
        const src = prefill.lines[li];
        if (!src) return line;
        const colours = line.colours.map((existing, fi) => {
          if (existing) return existing;
          const yt = yarnTypes.find((y) => y.id === feederQuality[fi]?.yarnTypeId);
          if (!yt) return existing;
          const text = (src.colours?.find((c) => c.feeder === fi + 1)?.colourText || "").toLowerCase();
          const col = text ? yt.colours.find((c) => text.includes(c.colourName.toLowerCase())) : null;
          return col ? col.id : existing;
        });
        return { ...line, colours };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feederQuality]);

  const setFeederQualityAt = (fi, yarnTypeId) => {
    setFeederQuality((rows) => rows.map((r, i) => (i === fi ? { yarnTypeId } : r)));
    // clear that feeder's colour on every line — the colour list just changed
    setLines((rows) => rows.map((l) => ({ ...l, colours: l.colours.map((c, i) => (i === fi ? "" : c)) })));
  };
  const updateLine = (lineId, patch) => setLines((rows) => rows.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  const updateLineColour = (lineId, fi, colourId) =>
    setLines((rows) => rows.map((l) => (l.id === lineId ? { ...l, colours: l.colours.map((c, i) => (i === fi ? colourId : c)) } : l)));
  const addLine = () => setLines((rows) => [...rows, emptyLine()]);
  const removeLine = (lineId) => setLines((rows) => (rows.length > 1 ? rows.filter((l) => l.id !== lineId) : rows));

  /* Quick-add handlers — each writes straight to the real Yarn Library /
     Weavers master via setData (so the new record survives even if this
     order is later cancelled), then applies the new id to whichever
     select opened the modal. Returning a string keeps the modal open
     with that error; returning null/undefined closes it. */
  const createYarnType = (name, denier) => {
    const dNorm = withDenierSuffix(denier);
    const dup = yarnTypes.some((y) => y.name.trim().toLowerCase() === name.toLowerCase() && stripDenierSuffix(y.denier).toLowerCase() === stripDenierSuffix(dNorm).toLowerCase());
    if (dup) return `${name} — ${dNorm} already exists.`;
    const id = uid("yt");
    setData({ ...data, yarnTypes: [...yarnTypes, { id, name, denier: dNorm, colours: [] }] });
    if (addModal.kind === "warpYarn") { setWarpYarnTypeId(id); setWarpColourId(""); }
    if (addModal.kind === "feederYarn") setFeederQualityAt(addModal.feederIndex, id);
    setAddModal(null);
    return null;
  };
  const createColour = (colourName) => {
    const yt = yarnTypes.find((y) => y.id === addModal.yarnTypeId);
    if (!yt) return "Select a yarn quality first.";
    const dup = yt.colours.some((c) => c.colourName.trim().toLowerCase() === colourName.toLowerCase());
    if (dup) return `"${colourName}" already exists for this yarn.`;
    const id = uid("col");
    setData({ ...data, yarnTypes: yarnTypes.map((y) => (y.id === yt.id ? { ...y, colours: [...y.colours, { id, colourName }] } : y)) });
    if (addModal.kind === "warpColour") setWarpColourId(id);
    if (addModal.kind === "lineColour") updateLineColour(addModal.lineId, addModal.feederIndex, id);
    setAddModal(null);
    return null;
  };
  const createWeaver = (name, address, whatsapp, email) => {
    const id = uid("weaver");
    setData({ ...data, weavers: [...weavers, { id, name, address, whatsapp, email }] });
    setWeaverId(id);
    setAddModal(null);
    return null;
  };

  const cutSizeForTotals = designCutSize(selectedDesign);
  const totalMtrs = lines.reduce((sum, l) => sum + lineMtsEquivalent(l.qty, unit, cutSizeForTotals), 0);

  const isDuplicatePoNo = (n) =>
    existingOrders.some((o) => (!editingOrder || o.id !== editingOrder.id) && o.poNo.trim().toLowerCase() === n.trim().toLowerCase());

  const submit = () => {
    const n = poNo.trim();
    if (!n) { setError("PO No is required."); return; }
    if (isDuplicatePoNo(n)) { setError(`PO No "${n}" already exists — enter a different one.`); return; }
    if (!poDate) { setError("PO date is required."); return; }
    if (getFY(poDate) !== data.currentFY) { setError(`PO Date must fall within the selected FY (${data.currentFY}) — switch FY in the sidebar first if this date belongs to a different year.`); return; }
    if (!weaverId) { setError("Select a weaver."); return; }
    if (!width.trim()) { setError("Width is required."); return; }
    if (!warpYarnTypeId) { setError("Select a warp yarn."); return; }
    if (!warpColourId) { setError("Select a warp colour."); return; }
    if (!selectedDesign) { setError("Select a design."); return; }
    if (activeFeeders.length === 0) { setError("This design has no active feeders."); return; }
    if (feederQuality.some((r) => !r.yarnTypeId)) { setError("Select a yarn quality for every feeder."); return; }
    if (lines.some((l) => !String(l.qty).trim() || l.colours.some((c) => !c))) {
      setError("Every colourway row needs a colour for each feeder and a quantity.");
      return;
    }

    const weaver = weavers.find((w) => w.id === weaverId);
    const feederQualityOut = feederQuality.map((r, i) => {
      const yt = yarnTypes.find((y) => y.id === r.yarnTypeId);
      return { feeder: i + 1, yarnTypeId: r.yarnTypeId, yarnTypeName: yt ? `${yt.name} ${yt.denier}` : "" };
    });
    const linesOut = lines.map((l, li) => ({
      sl: li + 1,
      qty: l.qty,
      mts: lineMtsEquivalent(l.qty, unit, cutSizeForTotals),
      colours: l.colours.map((colourId, fi) => {
        const yt = yarnTypes.find((y) => y.id === feederQuality[fi]?.yarnTypeId);
        const col = yt?.colours.find((c) => c.id === colourId);
        return { feeder: fi + 1, colourId, colourName: col ? col.colourName : "" };
      }),
    }));

    const order = {
      id: editingOrder ? editingOrder.id : uid("po"),
      poNo: n, poDate, width: width.trim(), remarks: remarks.trim(),
      unit, cutSizeUsed: cutSizeForTotals,
      warpYarnTypeId, warpYarnTypeName: `${warpYarnType.name} ${warpYarnType.denier}`,
      warpColourId, warpColourName: warpYarnType.colours.find((c) => c.id === warpColourId)?.colourName || "",
      designId: selectedDesign.id, designNo: selectedDesign.designNo, designLabel: selectedDesign.label,
      reed: selectedDesign.reed, pick: selectedDesign.pick,
      weaverId: weaver.id, weaverName: weaver.name, weaverAddress: weaver.address,
      weaverWhatsapp: weaver.whatsapp, weaverEmail: weaver.email,
      feederQuality: feederQualityOut,
      lines: linesOut,
      totalMtrs,
      sheetId: editingOrder ? editingOrder.sheetId : undefined,
      createdAt: editingOrder ? editingOrder.createdAt : Date.now(),
    };
    onSave(order, sheetDraft);
  };

  // No early-return for an empty weavers list — the Weaver field's own
  // "+" button below lets one be added right here.
  if (designs.length === 0) {
    return (
      <div>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4"><ArrowLeft size={15} /> Back</button>
        <Card><Empty icon={Grid3x3} title="Add a design first" hint="Production Orders pull Reed and Base Pick from a saved design — add one in the Design Library, then come back here." /></Card>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4"><ArrowLeft size={15} /> Back</button>
      <Header title={editingOrder ? `Edit Production Order — PO ${editingOrder.poNo}` : "New Production Order"} />
      {uploadNotice && <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 max-w-2xl">{uploadNotice}</div>}
      {prefill && !uploadNotice && (
        <div style={{ backgroundColor: "#F0FDFA" }} className="rounded px-3 py-2 text-xs text-[#0F766E] mb-5 max-w-2xl">
          Read from the uploaded sheet — check every field below, including the feeder and colour matches, before saving.
        </div>
      )}
      {prefill?.designNo && !designId && designs.filter((d) => d.designNo.trim().toLowerCase() === prefill.designNo.trim().toLowerCase()).length > 1 && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 max-w-2xl">
          "{prefill.designNo}" exists at more than one base Pick in your Design Library — pick the right one below rather than trusting an automatic match.
        </div>
      )}
      {sheetDraft && (
        <div className="mb-5 max-w-2xl">
          <Label>Uploaded sheet</Label>
          <img src={sheetDraft.dataUrl} alt="Uploaded PO screenshot" className="rounded border border-stone-200 max-h-64 w-auto" />
        </div>
      )}
      {editingOrder?.sheetId && (
        <button onClick={() => setViewingUploadedSheet(true)} className="flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline mb-5">
          <ImageIcon size={13} /> View uploaded sheet
        </button>
      )}

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>PO No</Label>
            <Input placeholder="e.g. 2219" value={poNo} onChange={(e) => { setPoNo(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>PO date</Label>
            <Input type="date" value={poDate} onChange={(e) => { setPoDate(e.target.value); setError(""); }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <Label>Weaver name</Label>
            <div className="flex gap-1.5">
              <Select value={weaverId} onChange={(e) => { setWeaverId(e.target.value); setError(""); }}>
                <option value="">Select weaver…</option>
                {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              <AddBtn title="Add weaver" onClick={() => setAddModal({ kind: "weaver" })} />
            </div>
          </div>
          <div>
            <Label>Design No</Label>
            <Select value={designId} onChange={(e) => { setDesignId(e.target.value); setError(""); }}>
              <option value="">Select design…</option>
              {designs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <Label>Width{selectedDesign ? " (from design, editable)" : ""}</Label>
            <Input placeholder="e.g. 48" value={width} onChange={(e) => { setWidth(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Warp yarn</Label>
            <div className="flex gap-1.5">
              <Select value={warpYarnTypeId} onChange={(e) => { setWarpYarnTypeId(e.target.value); setWarpColourId(""); setError(""); }}>
                <option value="">Select…</option>
                {yarnTypes.map((y) => <option key={y.id} value={y.id}>{y.name} {y.denier}</option>)}
              </Select>
              <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: "warpYarn" })} />
            </div>
          </div>
          <div>
            <Label>Warp colour</Label>
            <div className="flex gap-1.5">
              <Select value={warpColourId} onChange={(e) => { setWarpColourId(e.target.value); setError(""); }} disabled={!warpYarnType}>
                <option value="">{warpYarnType ? "Select…" : "Pick warp yarn first"}</option>
                {(warpYarnType?.colours || []).map((c) => <option key={c.id} value={c.id}>{c.colourName}</option>)}
              </Select>
              <AddBtn title="Add colour" disabled={!warpYarnType}
                onClick={() => setAddModal({ kind: "warpColour", yarnTypeId: warpYarnTypeId, yarnLabel: `${warpYarnType.name} ${warpYarnType.denier}` })} />
            </div>
          </div>
        </div>

        <div className="mt-3">
          <Label>Remarks (optional)</Label>
          <Input placeholder="e.g. Deliver by 20th, urgent" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {selectedDesign && (
          <div className="mt-3 flex gap-4 text-xs text-stone-500 flex-wrap">
            <span>Reed <span className="font-semibold text-stone-700 yll-mono">{selectedDesign.reed}</span> (auto)</span>
            <span>Base pick <span className="font-semibold text-stone-700 yll-mono">{selectedDesign.pick}</span> (auto)</span>
            <span>Fabric <span className="font-semibold text-stone-700">{fabricType ? `${fabricType.name} (${fabricType.measuringTerm})` : `Unregistered prefix "${getDesignPrefix(selectedDesign.designNo)}" — showing as Mts`}</span></span>
          </div>
        )}
      </Card>

      {selectedDesign && activeFeeders.length > 0 && (
        <>
          <Card className="mb-5">
            <div className="px-4 py-3 border-b border-stone-200">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Yarn quality — one per feeder</h2>
            </div>
            <div className="overflow-x-auto yll-scrollbar">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    {activeFeeders.map((f) => <th key={f.feeder} className="text-left font-semibold px-4 py-2">F{f.feeder}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-stone-100">
                    {activeFeeders.map((f, i) => (
                      <td key={f.feeder} className="px-4 py-1.5 min-w-[190px]">
                        <div className="flex gap-1.5">
                          <Select value={feederQuality[i]?.yarnTypeId || ""} onChange={(e) => setFeederQualityAt(i, e.target.value)}>
                            <option value="">Select…</option>
                            {yarnTypes.map((y) => <option key={y.id} value={y.id}>{y.name} {y.denier}</option>)}
                          </Select>
                          <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: "feederYarn", feederIndex: i })} />
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mb-5">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Colourways</h2>
              <Btn variant="ghost" onClick={addLine}><Plus size={13} /> Add colourway</Btn>
            </div>
            <div className="overflow-x-auto yll-scrollbar">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    <th className="text-left font-semibold px-4 py-2">SL</th>
                    {activeFeeders.map((f) => <th key={f.feeder} className="text-left font-semibold px-2 py-2">F{f.feeder}</th>)}
                    <th className="text-right font-semibold px-3 py-2">Qty ({unit})</th>
                    {unit === "Pcs" && <th className="text-right font-semibold px-3 py-2">Mts (auto)</th>}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, li) => (
                    <tr key={line.id} className="border-t border-stone-100">
                      <td className="px-4 py-1.5 text-stone-500 yll-mono">{li + 1}</td>
                      {activeFeeders.map((f, fi) => {
                        const yt = yarnTypes.find((y) => y.id === feederQuality[fi]?.yarnTypeId);
                        return (
                          <td key={f.feeder} className="px-2 py-1.5 min-w-[170px]">
                            <div className="flex gap-1.5">
                              <Select value={line.colours[fi] || ""} onChange={(e) => updateLineColour(line.id, fi, e.target.value)} disabled={!yt}>
                                <option value="">{yt ? "Select…" : "—"}</option>
                                {(yt?.colours || []).map((c) => <option key={c.id} value={c.id}>{c.colourName}</option>)}
                              </Select>
                              <AddBtn title="Add colour" disabled={!yt}
                                onClick={() => setAddModal({ kind: "lineColour", lineId: line.id, feederIndex: fi, yarnTypeId: yt?.id, yarnLabel: yt ? `${yt.name} ${yt.denier}` : "" })} />
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 w-24">
                        <Input className="text-right" value={line.qty} onChange={(e) => updateLine(line.id, { qty: e.target.value })} placeholder="0" />
                      </td>
                      {unit === "Pcs" && (
                        <td className="px-3 py-1.5 w-24 text-right yll-mono text-stone-500">
                          {fmt(lineMtsEquivalent(line.qty, unit, cutSizeForTotals))}
                        </td>
                      )}
                      <td className="px-2 py-1.5">
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(line.id)} className="text-stone-400 hover:text-[#0D9488]"><X size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-stone-200">
                    <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={activeFeeders.length + 1}>
                      Total {unit}{unit === "Pcs" && " / Mts (auto)"}
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 yll-mono" colSpan={unit === "Pcs" ? 1 : 2}>
                      {fmt(lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0))}
                    </td>
                    {unit === "Pcs" && (
                      <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 yll-mono" colSpan={2}>{fmt(totalMtrs)}</td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit}><Check size={15} /> {editingOrder ? "Save changes" : "Save order"}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>

      {addModal?.kind === "weaver" && (
        <QuickAddWeaverModal onClose={() => setAddModal(null)} onCreate={createWeaver} />
      )}
      {(addModal?.kind === "warpYarn" || addModal?.kind === "feederYarn") && (
        <QuickAddYarnTypeModal onClose={() => setAddModal(null)} onCreate={createYarnType} />
      )}
      {(addModal?.kind === "warpColour" || addModal?.kind === "lineColour") && (
        <QuickAddColourModal yarnLabel={addModal.yarnLabel} onClose={() => setAddModal(null)} onCreate={createColour} />
      )}
      {viewingUploadedSheet && editingOrder?.sheetId && (() => {
        const sheet = data.sheets.find((s) => s.id === editingOrder.sheetId);
        return sheet ? <SheetViewerModal sheet={sheet} onClose={() => setViewingUploadedSheet(false)} /> : null;
      })()}
    </div>
  );
}

/* Printable/downloadable/shareable order slip — the company letterhead,
   the weaver's "To" block, PO details, and the feeder/colour/qty grid.
   #order-slip-print is what the print stylesheet in FontStyles isolates,
   and what html2canvas captures for the JPG download / WhatsApp share. */
function OrderSlip({ order, fabricTypes, onBack, onViewSheet }) {
  const slipRef = useRef(null);
  const [busy, setBusy] = useState(""); // "" | "download" | "share"
  const [toast, setToast] = useState("");
  const unit = order.unit || findFabricType(order.designNo, fabricTypes)?.measuringTerm || "Mts";
  const totalRawQty = unit === "Pcs" ? order.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0) : order.totalMtrs;

  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      setToast("This environment blocked the print dialog — try opening this file in a regular browser tab instead of an embedded preview.");
    }
  };

  const handleDownload = async () => {
    setBusy("download"); setToast("");
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current);
      downloadDataUrl(dataUrl, `PO-${order.poNo}.jpg`);
    } catch (e) {
      setToast(`${e?.message || "Couldn't generate the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally { setBusy(""); }
  };

  const handleShare = async () => {
    setBusy("share"); setToast("");
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current);
      const result = await shareJPGOnWhatsApp(dataUrl, `PO-${order.poNo}.jpg`, `Production Order ${order.poNo} — ${order.designLabel}`);
      if (result === "fallback") setToast("Your browser can't attach the image automatically — it's downloaded, so just attach it in the WhatsApp chat that opened.");
    } catch (e) {
      setToast(`${e?.message || "Couldn't prepare the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally { setBusy(""); }
  };

  const handleEmail = async () => {
    setBusy("email"); setToast("");
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current);
      const result = await shareFileByEmail(dataUrl, `PO-${order.poNo}.jpg`, "image/jpeg",
        `Production Order ${order.poNo}`, `Production Order ${order.poNo} — ${order.designLabel}, for ${order.weaverName}.`);
      if (result === "fallback") setToast("The image is downloaded — attach it to the email draft that opened.");
    } catch (e) {
      setToast(`${e?.message || "Couldn't prepare the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally { setBusy(""); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2 print:hidden">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium"><ArrowLeft size={15} /> Back to Production Orders</button>
        <div className="flex gap-2 flex-wrap">
          {order.sheetId && (
            <Btn variant="ghost" onClick={() => onViewSheet(order.sheetId)}><ImageIcon size={14} /> View Sheet</Btn>
          )}
          <Btn variant="ghost" onClick={handlePrint}><Printer size={14} /> Print</Btn>
          <Btn variant="ghost" onClick={handleDownload} disabled={busy === "download"}>
            {busy === "download" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download JPG
          </Btn>
          <Btn variant="ghost" onClick={handleEmail} disabled={busy === "email"}>
            {busy === "email" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Share on Email
          </Btn>
          <Btn onClick={handleShare} disabled={busy === "share"}>
            {busy === "share" ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share on WhatsApp
          </Btn>
        </div>
      </div>
      {toast && <div className="text-xs mb-3 text-[#0D9488] print:hidden">{toast}</div>}

      <div id="order-slip-print" ref={slipRef} className="print-area bg-white border border-stone-200 rounded-md p-8 max-w-2xl mx-auto text-stone-800">
        <div className="text-center mb-1">
          <div className="yll-wordmark text-2xl" style={{ color: "#1C1917" }}>SOUTH HANDLOOMS</div>
        </div>
        <div className="text-center text-xs text-stone-500 mb-6">
          37, Rajamannar Street, T.Nagar, Chennai - 600017 &nbsp;·&nbsp; 9003251000 &nbsp;·&nbsp; mail@southhandlooms.com
        </div>

        <div className="flex justify-between text-sm mb-6 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">To</div>
            <div className="font-semibold">{order.weaverName}</div>
            {order.weaverAddress && <div className="text-stone-600">{order.weaverAddress}</div>}
            {order.weaverWhatsapp && <div className="text-stone-600">{order.weaverWhatsapp}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">Production Order</div>
            <div className="font-semibold">PO No {order.poNo}</div>
            <div className="text-stone-600">{fmtDateDMY(order.poDate)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs mb-4 border-y border-stone-200 py-3">
          <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Design No</div><div className="font-semibold">{order.designNo}</div></div>
          <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Width</div><div className="font-semibold">{order.width}"</div></div>
          <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Reed</div><div className="font-semibold">{order.reed}</div></div>
          <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Base Pick</div><div className="font-semibold">{order.pick}</div></div>
          <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Warp Yarn</div><div className="font-semibold">{order.warpYarnTypeName}</div></div>
          <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Warp Colour</div><div className="font-semibold">{order.warpColourName}</div></div>
        </div>

        {order.remarks && (
          <div className="text-xs mb-4">
            <span className="text-stone-400 uppercase tracking-wide mr-1.5">Remarks</span>
            <span className="font-semibold">{order.remarks}</span>
          </div>
        )}

        <table className="w-full text-sm mb-2" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="border border-stone-300 px-3 py-1.5 font-bold text-stone-800">SL</th>
              {order.feederQuality.map((f) => <th key={f.feeder} className="border border-stone-300 px-3 py-1.5 font-bold text-stone-800">F{f.feeder}</th>)}
              <th className="border border-stone-300 px-3 py-1.5 font-bold text-stone-800">QTY ({unit.toUpperCase()})</th>
            </tr>
            <tr>
              <th className="border border-stone-300 px-3 py-1.5"></th>
              {order.feederQuality.map((f) => <th key={f.feeder} className="border border-stone-300 px-3 py-1.5 font-bold text-stone-800">{f.yarnTypeName}</th>)}
              <th className="border border-stone-300 px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.sl}>
                <td className="border border-stone-300 px-3 py-1.5 text-center font-medium" style={{ color: "#0D9488" }}>{line.sl}</td>
                {line.colours.map((c) => (
                  <td key={c.feeder} className="border border-stone-300 px-3 py-1.5 text-center font-medium" style={{ color: "#0D9488" }}>{c.colourName}</td>
                ))}
                <td className="border border-stone-300 px-3 py-1.5 text-center">
                  <div className="font-medium yll-mono" style={{ color: "#0D9488" }}>{line.qty} {unit.toLowerCase()}</div>
                  {unit === "Pcs" && line.mts != null && (
                    <div className="text-xs text-stone-400 yll-mono">({fmt(line.mts)} mts)</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="border border-stone-300 px-3 py-1.5 font-bold text-stone-800 text-center" colSpan={2}>TOTAL</td>
              {order.feederQuality.slice(1).map((f) => <td key={f.feeder} className="border border-stone-300 px-3 py-1.5"></td>)}
              <td className="border border-stone-300 px-3 py-1.5 text-center">
                <div className="font-bold text-stone-800 yll-mono">{fmt(totalRawQty)} {unit.toLowerCase()}</div>
                {unit === "Pcs" && (
                  <div className="text-xs font-normal text-stone-400 yll-mono">({fmt(order.totalMtrs)} mts)</div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* Printable/downloadable/shareable slip for a Yarn Issue (RMDC) — same
   letterhead pattern as the Production Order slip: To block, RMDC
   No/Date, remarks, dispatch details, then the item grid with a total. */
function IssueSlip({ issue, onBack }) {
  const slipRef = useRef(null);
  const [busy, setBusy] = useState(""); // "" | "download" | "email" | "share"
  const [toast, setToast] = useState("");

  const handlePrint = () => {
    try { window.print(); } catch (e) {
      setToast("This environment blocked the print dialog — try opening this file in a regular browser tab instead of an embedded preview.");
    }
  };
  const handleDownload = async () => {
    setBusy("download"); setToast("");
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current);
      downloadDataUrl(dataUrl, `RMDC-${issue.issueNo}.jpg`);
    } catch (e) {
      setToast(`${e?.message || "Couldn't generate the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally { setBusy(""); }
  };
  const handleEmail = async () => {
    setBusy("email"); setToast("");
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current);
      const result = await shareFileByEmail(dataUrl, `RMDC-${issue.issueNo}.jpg`, "image/jpeg",
        `RMDC ${issue.issueNo}`, `RMDC ${issue.issueNo} — yarn issued to ${issue.weaverName}.`);
      if (result === "fallback") setToast("The image is downloaded — attach it to the email draft that opened.");
    } catch (e) {
      setToast(`${e?.message || "Couldn't prepare the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally { setBusy(""); }
  };
  const handleShare = async () => {
    setBusy("share"); setToast("");
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current);
      const result = await shareJPGOnWhatsApp(dataUrl, `RMDC-${issue.issueNo}.jpg`, `RMDC ${issue.issueNo} — yarn issued to ${issue.weaverName}`);
      if (result === "fallback") setToast("Your browser can't attach the image automatically — it's downloaded, so just attach it in the WhatsApp chat that opened.");
    } catch (e) {
      setToast(`${e?.message || "Couldn't prepare the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally { setBusy(""); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2 print:hidden">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium"><ArrowLeft size={15} /> Back to Yarn Issue</button>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="ghost" onClick={handlePrint}><Printer size={14} /> Print</Btn>
          <Btn variant="ghost" onClick={handleDownload} disabled={busy === "download"}>
            {busy === "download" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download JPG
          </Btn>
          <Btn variant="ghost" onClick={handleEmail} disabled={busy === "email"}>
            {busy === "email" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Share on Email
          </Btn>
          <Btn onClick={handleShare} disabled={busy === "share"}>
            {busy === "share" ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share on WhatsApp
          </Btn>
        </div>
      </div>
      {toast && <div className="text-xs mb-3 text-[#0D9488] print:hidden">{toast}</div>}

      <div id="issue-slip-print" ref={slipRef} className="print-area bg-white border border-stone-200 rounded-md p-8 max-w-2xl mx-auto text-stone-800">
        <div className="text-center mb-1">
          <div className="yll-wordmark text-2xl" style={{ color: "#1C1917" }}>SOUTH HANDLOOMS</div>
        </div>
        <div className="text-center text-xs text-stone-500 mb-6">
          37, Rajamannar Street, T.Nagar, Chennai - 600017 &nbsp;·&nbsp; 9003251000 &nbsp;·&nbsp; mail@southhandlooms.com
        </div>

        <div className="flex justify-between text-sm mb-6 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">To</div>
            <div className="font-semibold">{issue.weaverName}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">Yarn Issue</div>
            <div className="font-semibold">RMDC No {issue.issueNo}</div>
            <div className="text-stone-600">{fmtDateDMY(issue.issueDate)}</div>
          </div>
        </div>

        {issue.remarks && (
          <div className="text-xs mb-4">
            <span className="text-stone-400 uppercase tracking-wide mr-1.5">Remarks</span>
            <span className="font-semibold">{issue.remarks}</span>
          </div>
        )}

        {(issue.supplierName || issue.transportName || issue.lrNo || issue.lrDate || issue.paymentTerm) && (
          <div className="grid grid-cols-3 gap-3 text-xs mb-4 border-y border-stone-200 py-3">
            {issue.supplierName && <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Supplier</div><div className="font-semibold">{issue.supplierName}</div></div>}
            {issue.transportName && <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Transport</div><div className="font-semibold">{issue.transportName}</div></div>}
            {issue.lrNo && <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">LR No.</div><div className="font-semibold">{issue.lrNo}</div></div>}
            {issue.lrDate && <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">LR Date</div><div className="font-semibold">{fmtDateDMY(issue.lrDate)}</div></div>}
            {issue.paymentTerm && <div><div className="text-stone-400 uppercase tracking-wide mb-0.5">Payment</div><div className="font-semibold">{issue.paymentTerm}</div></div>}
          </div>
        )}

        <table className="w-full text-sm mb-2" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="border border-stone-300 px-2 py-1.5 font-bold text-stone-800">SL</th>
              <th className="border border-stone-300 px-2 py-1.5 font-bold text-stone-800">Name of Yarn</th>
              <th className="border border-stone-300 px-2 py-1.5 font-bold text-stone-800">Colour / Shade</th>
              <th className="border border-stone-300 px-2 py-1.5 font-bold text-stone-800 text-right">Qty (kg)</th>
              <th className="border border-stone-300 px-2 py-1.5 font-bold text-stone-800 text-right">Rate</th>
              <th className="border border-stone-300 px-2 py-1.5 font-bold text-stone-800 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {issue.items.map((it) => (
              <tr key={it.sl}>
                <td className="border border-stone-300 px-2 py-1 text-center" style={{ color: "#0D9488" }}>{it.sl}</td>
                <td className="border border-stone-300 px-2 py-1">{it.yarnTypeName}</td>
                <td className="border border-stone-300 px-2 py-1">{it.colourName}</td>
                <td className="border border-stone-300 px-2 py-1 text-right yll-mono">{fmt(it.qty)}</td>
                <td className="border border-stone-300 px-2 py-1 text-right yll-mono">{fmt(it.rate)}</td>
                <td className="border border-stone-300 px-2 py-1 text-right yll-mono">{fmt(it.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="border border-stone-300 px-2 py-1.5 text-right font-bold text-stone-800">Total</td>
              <td className="border border-stone-300 px-2 py-1.5 text-right font-bold yll-mono">{fmt(issue.totalQty)}</td>
              <td className="border border-stone-300 px-2 py-1.5"></td>
              <td className="border border-stone-300 px-2 py-1.5 text-right font-bold yll-mono">{fmt(issue.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* =================================================================
   GOODS RECEIPT

   Design-wise, not colour-wise: a receipt records how much fabric came
   back against a PO as a whole, in however many lots it arrives — not
   itemised per colourway. The running received total against a PO's
   own ordered total can end up a little short or a little over; that's
   expected and isn't validated against here. Resolving it (accepting a
   shortfall, or marking it complete) happens in Pending Orders.
==================================================================*/
function GoodsReceipts({ data, setData, canDelete }) {
  const weavers = data.weavers;
  const orders = data.productionOrders.filter((o) => getFY(o.poDate) === data.currentFY);
  const designs = data.designs;
  const receipts = data.receipts.filter((r) => getFY(r.invDate) === data.currentFY);
  const fyLocked = (data.closedFYs || []).includes(data.currentFY);

  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState(todayISO());
  const [weaverId, setWeaverId] = useState("");
  const [poId, setPoId] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [receiptWeaverFilter, setReceiptWeaverFilter] = useState("");
  const [receiptSortKey, setReceiptSortKey] = useState("dateNewest");
  const [receiptQuery, setReceiptQuery] = useState("");

  const RECEIPT_SORTS = {
    dateNewest: { label: "Date (newest)", fn: (a, b) => b.invDate.localeCompare(a.invDate) },
    dateOldest: { label: "Date (oldest)", fn: (a, b) => a.invDate.localeCompare(b.invDate) },
    invNoAsc: { label: "Invoice No (A–Z)", fn: (a, b) => a.invNo.localeCompare(b.invNo) },
  };
  const visibleReceipts = useMemo(() => {
    let list = receiptWeaverFilter ? receipts.filter((r) => r.weaverId === receiptWeaverFilter) : receipts;
    const q = receiptQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => `${r.invNo} ${r.poNo} ${r.designLabel} ${r.weaverName}`.toLowerCase().includes(q));
    }
    return [...list].sort(RECEIPT_SORTS[receiptSortKey].fn);
  }, [receipts, receiptWeaverFilter, receiptSortKey, receiptQuery]);

  const pendingOrdersForWeaver = weaverId
    ? orders.filter((o) => o.weaverId === weaverId && orderStatus(o) === "pending")
    : [];
  const selectedPo = poId ? orders.find((o) => o.id === poId) : null;
  const selectedDesign = selectedPo ? designs.find((d) => d.id === selectedPo.designId) : null;
  // The PO snapshots its own unit at save time — fall back to a live Fabric
  // Types lookup only for POs saved before that field existed.
  const unit = selectedPo ? (selectedPo.unit || findFabricType(selectedPo.designNo, data.fabricTypes)?.measuringTerm || "Mts") : "Mts";
  const cutSize = designCutSize(selectedDesign);
  const mtsPreview = unit === "Pcs" ? lineMtsEquivalent(qty, "Pcs", cutSize) : null;

  const submit = () => {
    if (fyLocked) { setError(`FY ${data.currentFY} is closed — switch to an open year to add receipts.`); return; }
    const n = invNo.trim();
    if (!n) { setError("Invoice No is required."); return; }
    if (!invDate) { setError("Invoice date is required."); return; }
    if (getFY(invDate) !== data.currentFY) { setError(`Invoice date must fall within the selected FY (${data.currentFY}) — switch FY in the sidebar first if this date belongs to a different year.`); return; }
    if (!weaverId) { setError("Select a weaver."); return; }
    if (!poId) { setError("Select a PO."); return; }
    const q = qty.trim();
    if (!q || Number(q) <= 0) { setError("Enter a quantity received."); return; }
    const dup = data.receipts.some((r) => r.weaverId === weaverId && r.invNo.trim().toLowerCase() === n.toLowerCase());
    if (dup) { setError(`Invoice "${n}" is already recorded for this weaver.`); return; }

    const weaver = weavers.find((w) => w.id === weaverId);
    setData({
      ...data,
      receipts: [{
        id: uid("receipt"), invNo: n, invDate,
        weaverId, weaverName: weaver.name,
        poId: selectedPo.id, poNo: selectedPo.poNo, designLabel: selectedPo.designLabel,
        unit, qty: q, mts: unit === "Pcs" ? lineMtsEquivalent(q, "Pcs", cutSize) : Number(q),
        createdAt: Date.now(),
      }, ...data.receipts],
    });
    setInvNo(""); setQty(""); setError("");
    // Weaver and PO stay selected — quick to log another lot against the same order.
  };

  const removeReceipt = (id) => {
    setData({ ...data, receipts: data.receipts.filter((r) => r.id !== id) });
    setConfirmDeleteId(null);
  };

  return (
    <div>
      <Header title="Goods Receipt" subtitle="Record fabric received from a weaver against a Production Order — design-wise, one entry per lot." />
      {fyLocked && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 flex items-center gap-1.5">
          <Lock size={13} /> FY {data.currentFY} is closed — read-only. Switch to an open year from the sidebar to make changes.
        </div>
      )}

      <Card className="p-5 max-w-lg mb-6">
        <Label>New receipt</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Invoice No</Label>
            <Input placeholder="e.g. INV-118" value={invNo} onChange={(e) => { setInvNo(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Invoice date</Label>
            <Input type="date" value={invDate} onChange={(e) => { setInvDate(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Weaver name</Label>
            <Select value={weaverId} onChange={(e) => { setWeaverId(e.target.value); setPoId(""); setError(""); }}>
              <option value="">Select weaver…</option>
              {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>PO number</Label>
            <Select value={poId} onChange={(e) => { setPoId(e.target.value); setError(""); }} disabled={!weaverId}>
              <option value="">{!weaverId ? "Pick weaver first" : pendingOrdersForWeaver.length ? "Select PO…" : "No pending POs for this weaver"}</option>
              {pendingOrdersForWeaver.map((o) => <option key={o.id} value={o.id}>PO {o.poNo} — {o.designLabel}</option>)}
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Qty received ({unit})</Label>
            <Input value={qty} onChange={(e) => { setQty(e.target.value); setError(""); }} placeholder={unit === "Pcs" ? "e.g. 100" : "e.g. 400"}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            {unit === "Pcs" && qty.trim() && (
              <div className="text-xs text-stone-500 mt-1">≈ {fmt(mtsPreview)} mts (auto, Cut Size {cutSize})</div>
            )}
          </div>
        </div>
        {selectedPo && (() => {
          const received = receivedQtyForOrder(selectedPo.id, receipts);
          return (
            <div className="mt-3 text-xs text-stone-500">
              Ordered <span className="font-semibold text-stone-700 yll-mono">{fmt(selectedPo.totalMtrs)}</span>
              {"  ·  "}Received so far <span className="font-semibold text-stone-700 yll-mono">{fmt(received)}</span>
              {"  ·  "}Balance <span className="font-semibold text-stone-700 yll-mono">{fmt(selectedPo.totalMtrs - received)}</span>
            </div>
          );
        })()}
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit} disabled={fyLocked}><Plus size={15} /> Add receipt</Btn>
        </div>
      </Card>

      <Card>
        {receipts.length === 0 ? (
          <Empty icon={PackageCheck} title="No receipts yet" hint="Record fabric received from a weaver above." />
        ) : null}
      </Card>

      {receipts.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative max-w-xs flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input placeholder="Search invoice, PO, design…" value={receiptQuery} onChange={(e) => setReceiptQuery(e.target.value)} className="pl-8" />
            </div>
            <Select value={receiptWeaverFilter} onChange={(e) => setReceiptWeaverFilter(e.target.value)} className="max-w-[220px]">
              <option value="">All weavers</option>
              {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <div className="relative">
              <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <select value={receiptSortKey} onChange={(e) => setReceiptSortKey(e.target.value)}
                className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
                {Object.entries(RECEIPT_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <Card>
            {visibleReceipts.length === 0 ? (
              <Empty icon={Search} title="No matches" hint="Try a different weaver filter." />
            ) : (
              <div className="divide-y divide-stone-100">
                {visibleReceipts.map((r) => {
                  const po = orders.find((o) => o.id === r.poId);
                  return (
                    <div key={r.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="text-sm font-semibold text-stone-800">{r.invNo} <span className="text-stone-400 font-normal">· {fmtDateDMY(r.invDate)}</span></div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {r.weaverName} · PO {r.poNo} · {r.designLabel}
                          {po && <> · {formatOrderQty(po)} · {po.warpYarnTypeName} ({po.warpColourName}){po.remarks && <> · {po.remarks}</>}</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold yll-mono" style={{ color: "#0D9488" }}>
                          {fmt(r.qty)} {(r.unit || "Mts").toLowerCase()}
                          {r.unit === "Pcs" && r.mts != null && <span className="text-stone-400 font-normal"> ({fmt(r.mts)} mts)</span>}
                        </span>
                        {canDelete && !fyLocked && (confirmDeleteId === r.id ? (
                          <span className="flex items-center gap-2 text-xs">
                            <button onClick={() => removeReceipt(r.id)} className="font-semibold underline text-[#0D9488]">Delete</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">Cancel</button>
                          </span>
                        ) : (
                          <IconBtn title="Delete" danger onClick={() => setConfirmDeleteId(r.id)}><Trash2 size={14} /></IconBtn>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* =================================================================
   PENDING ORDERS

   Every Production Order's ordered vs received balance, with filters
   and the actions that resolve a PO once it's done: Close (received in
   full) or Short Close (accepting whatever balance remains as final).
   Reopen undoes either if it was a mistake.
==================================================================*/
const ORDER_SORTS = {
  dateNewest: { label: "Date (newest)", fn: (a, b) => b.poDate.localeCompare(a.poDate) },
  dateOldest: { label: "Date (oldest)", fn: (a, b) => a.poDate.localeCompare(b.poDate) },
  poNoAsc: { label: "PO No (low–high)", fn: (a, b) => { const na = parseFloat(a.poNo), nb = parseFloat(b.poNo); return !isNaN(na) && !isNaN(nb) ? na - nb : a.poNo.localeCompare(b.poNo); } },
  designAsc: { label: "Design No (A–Z)", fn: (a, b) => a.designNo.localeCompare(b.designNo) },
};
const STATUS_FILTERS = { pending: "Pending", closed: "Closed", "short-closed": "Short-Closed", all: "All statuses" };

function PendingOrders({ data, setData }) {
  const orders = data.productionOrders.filter((o) => getFY(o.poDate) === data.currentFY);
  const receipts = data.receipts;
  const weavers = data.weavers;
  const fyLocked = (data.closedFYs || []).includes(data.currentFY);

  const [weaverFilter, setWeaverFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sortKey, setSortKey] = useState("dateNewest");
  const [confirmAction, setConfirmAction] = useState(null); // { id, action: "close" | "short-close" }
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    let list = orders;
    if (weaverFilter) list = list.filter((o) => o.weaverId === weaverFilter);
    if (statusFilter !== "all") list = list.filter((o) => orderStatus(o) === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((o) => orderMatchesQuery(o, q));
    return [...list].sort(ORDER_SORTS[sortKey].fn);
  }, [orders, weaverFilter, statusFilter, sortKey, query]);

  const setStatus = (id, status) => {
    setData({ ...data, productionOrders: data.productionOrders.map((o) => (o.id === id ? { ...o, status, closedAt: status === "pending" ? null : Date.now() } : o)) });
    setConfirmAction(null);
  };

  return (
    <div>
      <Header title="Pending Orders" subtitle="Ordered vs received for every Production Order — filter by weaver, and close one out once it's done." />
      {fyLocked && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-4 flex items-center gap-1.5">
          <Lock size={13} /> FY {data.currentFY} is closed — order status can't be changed. Switch to an open year from the sidebar.
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search PO, design…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
          <option value="">All weavers</option>
          {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[170px]">
          {Object.entries(STATUS_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </Select>
        <div className="relative">
          <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
            className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
            {Object.entries(ORDER_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card><Empty icon={Hourglass} title="No orders found" hint="Try a different weaver, status filter, or search term." /></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((o) => {
            const received = receivedQtyForOrder(o.id, receipts);
            const balance = (Number(o.totalMtrs) || 0) - received;
            const status = orderStatus(o);
            return (
              <Card key={o.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-semibold text-stone-800">PO {o.poNo}</span>
                    <span style={{ backgroundColor: "#F0FDFA", color: "#0F766E" }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">{o.designLabel}</span>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-xs text-stone-500 mt-1">{o.weaverName} · {fmtDateDMY(o.poDate)} · {o.warpYarnTypeName} ({o.warpColourName}){o.remarks && <> · {o.remarks}</>}</div>
                  <div className="text-xs text-stone-500 mt-1">
                    Ordered <span className="font-semibold text-stone-700 yll-mono">{fmt(o.totalMtrs)}</span>
                    {"  ·  "}Received <span className="font-semibold text-stone-700 yll-mono">{fmt(received)}</span>
                    {"  ·  "}Balance <span className="font-semibold yll-mono" style={{ color: balance > 0 ? "#B45309" : "#0D9488" }}>{fmt(balance)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium">
                  {fyLocked ? (
                    <span className="text-stone-300">Locked</span>
                  ) : status === "pending" ? (
                    confirmAction?.id === o.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-stone-500">{confirmAction.action === "close" ? "Mark fully closed?" : "Short close with this balance?"}</span>
                        <button onClick={() => setStatus(o.id, confirmAction.action === "close" ? "closed" : "short-closed")} className="font-semibold underline text-[#0D9488]">Confirm</button>
                        <button onClick={() => setConfirmAction(null)} className="font-semibold text-stone-500">Cancel</button>
                      </span>
                    ) : (
                      <>
                        <button onClick={() => setConfirmAction({ id: o.id, action: "close" })} className="text-[#0D9488] hover:underline">Close</button>
                        <button onClick={() => setConfirmAction({ id: o.id, action: "short-close" })} className="text-stone-500 hover:text-stone-700">Short Close</button>
                      </>
                    )
                  ) : (
                    <button onClick={() => setStatus(o.id, "pending")} className="text-stone-400 hover:text-[#0D9488]">Reopen</button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =================================================================
   YARN REQUIRED

   Auto-calculated, not entered by hand: for every feeder in a
   Production Order, its Yarn Quality gives the Denier, and the
   underlying Design's own feeder table gives that feeder's Pick
   (distinct from the order's overall Base Pick). Combined with the
   order's Width and each colourway line's Qty:

     kg = (Denier × Width × 110 × Feeder Pick) ÷ 9,000,000 ÷ 100 × Qty

   summed across every feeder and every colourway line in the order,
   then again across every order that matches the current filter.

   Width here is Width + that design's own Salvage (if any was set at
   design creation) — backend-only, so the Production Order's own
   Width field and the printed slip never show the extra allowance,
   only this kg figure is affected by it. */
function widthForYarnRequired(order, design) {
  const width = Number(order.width) || 0;
  const salvage = Number(design?.salvage) || 0;
  return width + salvage;
}

function computeOrderYarnRequirement(order, design, yarnTypes) {
  const width = widthForYarnRequired(order, design);
  const activeDesignFeeders = design ? design.feeders.filter((f) => isActiveCard(f.card)) : [];
  const cutSize = designCutSize(design);
  const rows = [];

  order.feederQuality.forEach((fq, fi) => {
    const yt = yarnTypes.find((y) => y.id === fq.yarnTypeId);
    const denier = yt ? Number(stripDenierSuffix(yt.denier)) || 0 : 0;
    const designFeeder = activeDesignFeeders[fi];
    const feederPick = Number(designFeeder?.pick) || 0;

    order.lines.forEach((line) => {
      const colourEntry = line.colours[fi];
      const qty = order.unit === "Pcs" ? lineMtsEquivalent(line.qty, "Pcs", cutSize) : (Number(line.qty) || 0);
      const kg = (denier * width * 110 * feederPick) / 9000000 / 100 * qty;
      rows.push({
        feeder: fi + 1,
        yarnTypeId: fq.yarnTypeId,
        yarnTypeName: fq.yarnTypeName,
        colourId: colourEntry?.colourId,
        colourName: colourEntry?.colourName,
        qtyMtrs: qty,
        kg,
      });
    });
  });

  // Warp — one row for the whole order, not per feeder/colourway, since
  // the warp is set up once for the entire run: kg = Denier × ((Width ×
  // 1.04 × Reed) + 100) × Total Mts ÷ 9,000,000 × 1.10.
  const warpYt = yarnTypes.find((y) => y.id === order.warpYarnTypeId);
  if (warpYt) {
    const warpDenier = Number(stripDenierSuffix(warpYt.denier)) || 0;
    const reed = design ? Number(stripReedSuffix(design.reed)) || 0 : 0;
    const totalMts = Number(order.totalMtrs) || 0;
    const widthWithoutSalvage = Number(order.width) || 0; // Warp uses the plain order Width — no Salvage allowance, unlike Weft
    const warpKg = warpDenier * ((widthWithoutSalvage * 1.04 * reed) + 100) * totalMts / 9000000 * 1.10;
    rows.push({
      feeder: "Warp",
      yarnTypeId: order.warpYarnTypeId,
      yarnTypeName: order.warpYarnTypeName,
      colourId: order.warpColourId,
      colourName: order.warpColourName,
      qtyMtrs: totalMts,
      kg: warpKg,
      isWarp: true,
    });
  }

  return rows;
}
function aggregateYarnRequirement(orders, designs, yarnTypes) {
  const totals = {};
  const perOrder = orders.map((order) => {
    const design = designs.find((d) => d.id === order.designId);
    const rows = computeOrderYarnRequirement(order, design, yarnTypes);
    rows.forEach((r) => {
      const key = `${r.yarnTypeId}|${r.colourId}`;
      if (!totals[key]) totals[key] = { yarnTypeId: r.yarnTypeId, colourId: r.colourId, yarnTypeName: r.yarnTypeName, colourName: r.colourName, kg: 0, qtyMtrs: 0 };
      totals[key].kg += r.kg;
      totals[key].qtyMtrs += r.qtyMtrs;
    });
    return { order, rows, totalKg: rows.reduce((s, r) => s + r.kg, 0) };
  });
  return { summary: Object.values(totals), perOrder };
}

/* Full ledger for one Yarn Type + Colour, optionally scoped to one
   weaver — used by both Yarn Required and Stock-in-Hand so the two
   tabs never disagree. Opening Balance is every prior FY's Required
   less Issued, telescoped down to one carried-forward figure; the two
   grid columns only ever show the *selected* FY's own PO/RMDC detail;
   Closing Balance = Opening Balance + this FY's Required − Issued —
   positive means still owed ("Yarn Required"), zero or negative means
   supplied beyond what was needed ("Excess in Hand"). */
function buildColourLedger({ yarnTypeId, colourId, yarnTypeName, colourName, weaverId, data, asOnDate }) {
  const currentFY = data.currentFY;
  const scopedOrders = weaverId ? data.productionOrders.filter((o) => o.weaverId === weaverId) : data.productionOrders;
  const scopedIssues = weaverId ? data.yarnIssues.filter((i) => i.weaverId === weaverId) : data.yarnIssues;

  let openingRequired = 0, openingIssued = 0, requiredThisFY = 0, issuedThisFY = 0;
  const requiredSources = [];
  const issuedSources = [];

  scopedOrders.forEach((o) => {
    const fy = getFY(o.poDate);
    if (!fy) return;
    const design = data.designs.find((d) => d.id === o.designId);
    const rows = computeOrderYarnRequirement(o, design, data.yarnTypes);
    const kg = rows.filter((r) => r.yarnTypeId === yarnTypeId && r.colourId === colourId).reduce((s, r) => s + r.kg, 0);
    if (!kg) return;
    if (fy < currentFY) openingRequired += kg;
    else if (fy === currentFY) { requiredThisFY += kg; requiredSources.push({ poId: o.id, poNo: o.poNo, poDate: o.poDate, kg }); }
  });
  scopedIssues.forEach((i) => {
    const fy = getFY(i.issueDate);
    if (!fy) return;
    const kg = i.items.filter((it) => it.yarnTypeId === yarnTypeId && it.colourId === colourId).reduce((s, it) => s + (Number(it.qty) || 0), 0);
    if (!kg) return;
    if (fy < currentFY) openingIssued += kg;
    else if (fy === currentFY) { issuedThisFY += kg; issuedSources.push({ issueId: i.id, issueNo: i.issueNo, issueDate: i.issueDate, kg }); }
  });

  const openingBalance = openingRequired - openingIssued;
  const closingBalance = openingBalance + requiredThisFY - issuedThisFY;

  return {
    yarnTypeName, colourName, fy: currentFY, reportDate: asOnDate || todayISO(),
    openingBalance, requiredThisFY, issuedThisFY, closingBalance,
    requiredSources, issuedSources,
  };
}

function YarnRequired({ data }) {
  const orders = data.productionOrders.filter((o) => getFY(o.poDate) === data.currentFY);
  const designs = data.designs;
  const yarnTypes = data.yarnTypes;
  const weavers = data.weavers;
  const yarnIssues = data.yarnIssues.filter((i) => getFY(i.issueDate) === data.currentFY);

  const [weaverFilter, setWeaverFilter] = useState("");
  const [sortKey, setSortKey] = useState("dateNewest");
  const [expandedYarnTypeId, setExpandedYarnTypeId] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [summaryQuery, setSummaryQuery] = useState("");
  const [orderQuery, setOrderQuery] = useState("");

  // Summary is always net of every order regardless of status — a status
  // filter would be redundant, since Yarn Issued already accounts for
  // what a closed order actually consumed.
  const weaverFilteredOrders = useMemo(
    () => (weaverFilter ? orders.filter((o) => o.weaverId === weaverFilter) : orders),
    [orders, weaverFilter]
  );
  const { perOrder } = useMemo(
    () => aggregateYarnRequirement(weaverFilteredOrders, designs, yarnTypes),
    [weaverFilteredOrders, designs, yarnTypes]
  );

  // Grouped by Yarn Type, each with every one of its registered Colours
  // (not just ones with activity) sub-sorted alphabetically — with the
  // sources behind each figure kept around for the ledger drill-down.
  const groupedSummary = useMemo(() => {
    const requiredByKey = {};
    perOrder.forEach(({ order, rows }) => {
      rows.forEach((r) => {
        if (!r.colourId) return;
        const key = `${r.yarnTypeId}|${r.colourId}`;
        if (!requiredByKey[key]) requiredByKey[key] = { kg: 0, sources: [] };
        requiredByKey[key].kg += r.kg;
        requiredByKey[key].sources.push({ poId: order.id, poNo: order.poNo, poDate: order.poDate, kg: r.kg });
      });
    });
    const issuedByKey = {};
    yarnIssues.filter((i) => !weaverFilter || i.weaverId === weaverFilter).forEach((i) => {
      i.items.forEach((it) => {
        const key = `${it.yarnTypeId}|${it.colourId}`;
        if (!issuedByKey[key]) issuedByKey[key] = { kg: 0, sources: [] };
        issuedByKey[key].kg += Number(it.qty) || 0;
        issuedByKey[key].sources.push({ issueId: i.id, issueNo: i.issueNo, issueDate: i.issueDate, weaverName: i.weaverName, kg: Number(it.qty) || 0 });
      });
    });
    const relevantYarnTypeIds = new Set([
      ...Object.keys(requiredByKey).map((k) => k.split("|")[0]),
      ...Object.keys(issuedByKey).map((k) => k.split("|")[0]),
    ]);

    return yarnTypes
      .filter((yt) => relevantYarnTypeIds.has(yt.id))
      .map((yt) => {
        const yarnTypeName = `${yt.name} ${yt.denier}`;
        const colours = [...yt.colours]
          .sort((a, b) => a.colourName.localeCompare(b.colourName))
          .map((c) => {
            const key = `${yt.id}|${c.id}`;
            const req = requiredByKey[key];
            const iss = issuedByKey[key];
            const requiredKg = req?.kg || 0;
            const issuedKg = iss?.kg || 0;
            const led = buildColourLedger({ yarnTypeId: yt.id, colourId: c.id, yarnTypeName, colourName: c.colourName, weaverId: weaverFilter || null, data });
            return {
              colourId: c.id, colourName: c.colourName,
              requiredKg, issuedKg,
              netKg: Math.max(led.closingBalance, 0),
              excessKg: Math.max(-led.closingBalance, 0),
            };
          })
          .filter((c) => c.netKg > 0 || c.excessKg > 0); // nothing to report on a colour sitting at zero both ways
        return {
          yarnTypeId: yt.id, yarnTypeName, colours,
          subtotalNet: colours.reduce((s, c) => s + c.netKg, 0),
          subtotalExcess: colours.reduce((s, c) => s + c.excessKg, 0),
        };
      })
      .filter((g) => g.colours.length > 0)
      .sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName));
  }, [perOrder, yarnIssues, weaverFilter, yarnTypes]);
  const grandTotalNetKg = groupedSummary.reduce((s, g) => s + g.subtotalNet, 0);
  const grandTotalExcessKg = groupedSummary.reduce((s, g) => s + g.subtotalExcess, 0);

  // Keyword search — matches a Yarn Type's own name, or narrows down to
  // just the colours (under any type) whose name matches.
  const visibleGroups = useMemo(() => {
    const q = summaryQuery.trim().toLowerCase();
    if (!q) return groupedSummary;
    return groupedSummary
      .map((g) => {
        const yarnMatches = g.yarnTypeName.toLowerCase().includes(q);
        const colours = yarnMatches ? g.colours : g.colours.filter((c) => c.colourName.toLowerCase().includes(q));
        return { ...g, colours };
      })
      .filter((g) => g.colours.length > 0);
  }, [groupedSummary, summaryQuery]);

  // Only active (pending) orders belong in the by-order breakdown — a
  // closed or short-closed order is done, so it's no longer "required".
  const activePerOrder = useMemo(() => {
    const active = perOrder.filter(({ order }) => orderStatus(order) === "pending");
    const sorted = [...active].sort((a, b) => ORDER_SORTS[sortKey].fn(a.order, b.order));
    const q = orderQuery.trim().toLowerCase();
    return q ? sorted.filter(({ order }) => orderMatchesQuery(order, q)) : sorted;
  }, [perOrder, sortKey, orderQuery]);

  return (
    <div>
      <Header title="Yarn Required" />

      <div className="flex items-center gap-2 flex-wrap mb-5">
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
          <option value="">All weavers</option>
          {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>

      <Card className="mb-6">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Summary — net kgs required (after Yarn Issued)</h2>
          <div className="relative max-w-[220px] flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search yarn or colour…" value={summaryQuery} onChange={(e) => setSummaryQuery(e.target.value)} className="pl-7 py-1.5 text-xs" />
          </div>
        </div>
        {groupedSummary.length === 0 ? (
          <Empty icon={Scale} title="Nothing to calculate" hint="No Production Orders match this filter yet." />
        ) : visibleGroups.length === 0 ? (
          <Empty icon={Search} title="No matches" hint="Try a different search term." />
        ) : (
          <>
            <div className="divide-y divide-stone-100">
              {visibleGroups.map((g) => (
                <div key={g.yarnTypeId}>
                  <div
                    className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none hover:bg-stone-50"
                    onClick={() => setExpandedYarnTypeId(expandedYarnTypeId === g.yarnTypeId ? null : g.yarnTypeId)}
                  >
                    <div className="flex items-center gap-2">
                      {expandedYarnTypeId === g.yarnTypeId ? <ChevronDown size={15} className="text-stone-400" /> : <ChevronRight size={15} className="text-stone-400" />}
                      <span className="text-sm font-semibold text-stone-800">{g.yarnTypeName}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm font-semibold">
                      <span className="yll-mono" style={{ color: "#0D9488" }}>{fmt(g.subtotalNet)} kg</span>
                      <span className="yll-mono" style={{ color: "#2563EB" }}>{fmt(g.subtotalExcess)} kg</span>
                    </div>
                  </div>
                  {expandedYarnTypeId === g.yarnTypeId && (
                    <div style={{ backgroundColor: "#FAFAF9" }} className="px-4 py-2 overflow-x-auto yll-scrollbar">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-stone-400 text-xs">
                            <th className="text-left font-semibold py-1">Colour</th>
                            <th className="text-right font-semibold py-1">Required</th>
                            <th className="text-right font-semibold py-1">Issued</th>
                            <th className="text-right font-semibold py-1">Net Required</th>
                            <th className="text-right font-semibold py-1">Excess</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.colours.map((c) => (
                            <tr key={c.colourId} className="border-t border-stone-200 cursor-pointer hover:bg-stone-100"
                              onClick={() => setLedger(buildColourLedger({ yarnTypeId: g.yarnTypeId, colourId: c.colourId, yarnTypeName: g.yarnTypeName, colourName: c.colourName, weaverId: weaverFilter || null, data }))}>
                              <td className="py-1.5 text-stone-800 underline decoration-dotted decoration-stone-300">{c.colourName}</td>
                              <td className="py-1.5 text-right yll-mono text-stone-500">{fmt(c.requiredKg)}</td>
                              <td className="py-1.5 text-right yll-mono text-stone-500">{fmt(c.issuedKg)}</td>
                              <td className="py-1.5 text-right yll-mono font-medium" style={{ color: "#0D9488" }}>{fmt(c.netKg)}</td>
                              <td className="py-1.5 text-right yll-mono font-medium" style={{ color: "#2563EB" }}>{fmt(c.excessKg)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-stone-200 flex items-center justify-end gap-4 text-sm font-semibold">
              <span className="text-stone-500 text-xs uppercase tracking-wide">Total</span>
              <span className="yll-mono" style={{ color: "#0D9488" }}>{fmt(grandTotalNetKg)} kg</span>
              <span className="yll-mono" style={{ color: "#2563EB" }}>{fmt(grandTotalExcessKg)} kg</span>
            </div>
          </>
        )}
      </Card>

      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">By Production Order — active orders only</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative max-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search PO, design…" value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} className="pl-7 py-1.5 text-xs" />
          </div>
          <div className="relative">
            <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
              className="rounded border border-stone-300 bg-white pl-7 pr-3 py-1.5 text-xs text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
              {Object.entries(ORDER_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      {activePerOrder.length === 0 ? (
        <Card><Empty icon={Scale} title="No active orders" hint="Try a different weaver filter or search term." /></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {activePerOrder.map(({ order, rows, totalKg }) => (
            <Card key={order.id}>
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none flex-wrap gap-y-1" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {expandedId === order.id ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
                  <span className="text-sm font-semibold text-stone-800">PO {order.poNo}</span>
                  <span style={{ backgroundColor: "#F0FDFA", color: "#0F766E" }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">{order.designLabel}</span>
                  <span className="text-xs text-stone-400">{fmtDateDMY(order.poDate)}</span>
                  <span className="text-xs text-stone-500">{formatOrderQty(order)}</span>
                  <span className="text-xs text-stone-500">{order.warpYarnTypeName} ({order.warpColourName}){order.remarks && <> · {order.remarks}</>}</span>
                </div>
                <span className="text-sm font-semibold yll-mono" style={{ color: "#0D9488" }}>{fmt(totalKg)} kg</span>
              </div>
              {expandedId === order.id && (
                <div className="px-4 pb-4 border-t border-stone-200 overflow-x-auto yll-scrollbar">
                  <table className="w-full text-xs mt-3">
                    <thead>
                      <tr className="text-stone-400">
                        <th className="text-left font-semibold pb-1 pr-3">Feeder</th>
                        <th className="text-left font-semibold pb-1 pr-3">Yarn Quality</th>
                        <th className="text-left font-semibold pb-1 pr-3">Colour</th>
                        <th className="text-right font-semibold pb-1 pr-3">Qty (mtrs)</th>
                        <th className="text-right font-semibold pb-1">Kgs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-stone-100">
                          <td className="py-1 pr-3 text-stone-500">{r.isWarp ? "Warp" : `F${r.feeder}`}</td>
                          <td className="py-1 pr-3 text-stone-800">{r.yarnTypeName}</td>
                          <td className="py-1 pr-3 text-stone-800">{r.colourName}</td>
                          <td className="py-1 pr-3 text-right yll-mono">{fmt(r.qtyMtrs)}</td>
                          <td className="py-1 text-right yll-mono">{fmt(r.kg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {ledger && <ColourLedgerModal ledger={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}

/* Drill-down for one Yarn Type + Colour — every order that required it
   and every issue that supplied it, plus the net/excess summary. */
function ColourLedgerModal({ ledger, asOnDate, onClose }) {
  const rowCount = Math.max(ledger.requiredSources.length, ledger.issuedSources.length, 1);
  const closingLabel = ledger.closingBalance > 0 ? "Yarn Required" : "Excess in Hand";
  const closingValue = Math.abs(ledger.closingBalance);
  const closingColor = ledger.closingBalance > 0 ? "#0D9488" : "#2563EB";
  const openingLabel = ledger.openingBalance > 0 ? "Required b/f" : ledger.openingBalance < 0 ? "Excess b/f" : "—";
  const openingColor = ledger.openingBalance > 0 ? "#0D9488" : ledger.openingBalance < 0 ? "#2563EB" : "#78716C";
  const fyStartYear = ledger.fy.split("-")[0];
  const openingAsOn = `1 April ${fyStartYear}`;
  const reportAsOn = fmtDateDMY(ledger.reportDate);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 shrink-0">
          <div>
            <div className="text-sm font-semibold text-stone-800">{ledger.yarnTypeName}</div>
            <div className="text-xs text-stone-500">{ledger.colourName} · FY {ledger.fy}</div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={18} /></button>
        </div>

        <div className="overflow-auto yll-scrollbar px-5 py-4">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th colSpan={6} className="border border-stone-300 px-2 py-1.5 text-left font-semibold text-stone-600" style={{ backgroundColor: "#FAFAF9" }}>
                  Opening Balance (brought forward) as on {openingAsOn}: <span className="font-bold yll-mono" style={{ color: openingColor }}>{openingLabel}{ledger.openingBalance !== 0 && ` ${fmt(Math.abs(ledger.openingBalance))}`}</span>
                </th>
              </tr>
              <tr>
                <th colSpan={3} className="border border-stone-300 px-2 py-1.5 text-center font-bold text-stone-800" style={{ backgroundColor: "#F0FDFA" }}>Required — FY {ledger.fy}</th>
                <th colSpan={3} className="border border-stone-300 px-2 py-1.5 text-center font-bold text-stone-800" style={{ backgroundColor: "#EFF6FF" }}>Issued — FY {ledger.fy}</th>
              </tr>
              <tr className="text-xs text-stone-500">
                <th className="border border-stone-300 px-2 py-1.5 text-left">PO No</th>
                <th className="border border-stone-300 px-2 py-1.5 text-left">PO Date</th>
                <th className="border border-stone-300 px-2 py-1.5 text-right">Qty</th>
                <th className="border border-stone-300 px-2 py-1.5 text-left">RMDC No</th>
                <th className="border border-stone-300 px-2 py-1.5 text-left">RMDC Date</th>
                <th className="border border-stone-300 px-2 py-1.5 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }).map((_, i) => {
                const req = ledger.requiredSources[i];
                const iss = ledger.issuedSources[i];
                return (
                  <tr key={i}>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{req ? `PO ${req.poNo}` : ""}</td>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{req ? fmtDateDMY(req.poDate) : ""}</td>
                    <td className="border border-stone-300 px-2 py-1 text-right yll-mono text-stone-700">{req ? fmt(req.kg) : ""}</td>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{iss ? `RMDC ${iss.issueNo}` : ""}</td>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{iss ? fmtDateDMY(iss.issueDate) : ""}</td>
                    <td className="border border-stone-300 px-2 py-1 text-right yll-mono text-stone-700">{iss ? fmt(iss.kg) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="border border-stone-300 px-2 py-1.5 text-right font-semibold text-stone-600">Total</td>
                <td className="border border-stone-300 px-2 py-1.5 text-right font-semibold yll-mono text-stone-800">{fmt(ledger.requiredThisFY)}</td>
                <td colSpan={2} className="border border-stone-300 px-2 py-1.5 text-right font-semibold text-stone-600">Total</td>
                <td className="border border-stone-300 px-2 py-1.5 text-right font-semibold yll-mono text-stone-800">{fmt(ledger.issuedThisFY)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="border border-stone-300 px-2 py-1.5 text-right font-bold text-stone-800">Closing Balance — {closingLabel} as on {reportAsOn}</td>
                <td className="border border-stone-300 px-2 py-1.5 text-right font-bold yll-mono" style={{ color: closingColor }}>{fmt(closingValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =================================================================
   YARN ISSUE

   Yarn (kg) issued to a weaver — header details, a line-item grid
   (Yarn, Colour, Qty, Rate, Amount) with a running total, and the
   dispatch footer (Supplier, Transport, LR No./Date, To-Pay/Paid).
   Netted against Yarn Required elsewhere to work out remaining
   requirement and any stock sitting with the weaver.
==================================================================*/
const PAYMENT_TERMS = ["To-Pay", "Paid"];

function YarnIssues({ data, setData, canDelete }) {
  const [view, setView] = useState("list"); // "list" | "new" | "edit" | "slip"
  const [editingIssueId, setEditingIssueId] = useState(null);
  const [slipIssueId, setSlipIssueId] = useState(null);
  const [weaverFilter, setWeaverFilter] = useState("");
  const [sortKey, setSortKey] = useState("dateNewest");
  const [query, setQuery] = useState("");
  const issues = data.yarnIssues.filter((i) => getFY(i.issueDate) === data.currentFY);
  const weavers = data.weavers;
  const fyLocked = (data.closedFYs || []).includes(data.currentFY);

  const ISSUE_SORTS = {
    dateNewest: { label: "RMDC Date (newest)", fn: (a, b) => b.issueDate.localeCompare(a.issueDate) },
    dateOldest: { label: "RMDC Date (oldest)", fn: (a, b) => a.issueDate.localeCompare(b.issueDate) },
    issueNoAsc: { label: "RMDC No (A–Z)", fn: (a, b) => a.issueNo.localeCompare(b.issueNo) },
  };
  const visibleIssues = useMemo(() => {
    let list = weaverFilter ? issues.filter((i) => i.weaverId === weaverFilter) : issues;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => `${i.issueNo} ${i.weaverName}`.toLowerCase().includes(q));
    return [...list].sort(ISSUE_SORTS[sortKey].fn);
  }, [issues, weaverFilter, sortKey, query]);

  const addIssue = (issue) => {
    setData({ ...data, yarnIssues: [issue, ...data.yarnIssues] });
    setView("list");
  };
  const updateIssue = (updated) => {
    setData({ ...data, yarnIssues: data.yarnIssues.map((i) => (i.id === updated.id ? updated : i)) });
    setView("list");
    setEditingIssueId(null);
  };
  const removeIssue = (id) => setData({ ...data, yarnIssues: data.yarnIssues.filter((i) => i.id !== id) });

  const editingIssue = editingIssueId ? issues.find((i) => i.id === editingIssueId) : null;
  const slipIssue = slipIssueId ? data.yarnIssues.find((i) => i.id === slipIssueId) : null;

  return (
    <div>
      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <Header title="Yarn Issue" subtitle="Yarn issued to a weaver — items, rate, and dispatch details." />
            <Btn onClick={() => setView("new")} disabled={fyLocked}><Plus size={15} /> New Issue</Btn>
          </div>
          {fyLocked && (
            <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 flex items-center gap-1.5">
              <Lock size={13} /> FY {data.currentFY} is closed — read-only. Switch to an open year from the sidebar to make changes.
            </div>
          )}
          {issues.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <div className="relative max-w-xs flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input placeholder="Search RMDC no, weaver…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
              </div>
              <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
                <option value="">All weavers</option>
                {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              <div className="relative">
                <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                  className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none">
                  {Object.entries(ISSUE_SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          )}
          <YarnIssuesList issues={visibleIssues} onDelete={removeIssue} onEdit={(id) => { setEditingIssueId(id); setView("edit"); }} onView={(id) => { setSlipIssueId(id); setView("slip"); }} canDelete={canDelete && !fyLocked} canEdit={!fyLocked} />
        </>
      )}
      {view === "new" && (
        <NewYarnIssueForm data={data} setData={setData} existingIssues={issues} onCancel={() => setView("list")} onSave={addIssue} />
      )}
      {view === "edit" && editingIssue && (
        <NewYarnIssueForm
          data={data} setData={setData} existingIssues={issues} editingIssue={editingIssue}
          onCancel={() => { setView("list"); setEditingIssueId(null); }}
          onSave={updateIssue}
        />
      )}
      {view === "slip" && slipIssue && (
        <IssueSlip issue={slipIssue} onBack={() => { setView("list"); setSlipIssueId(null); }} />
      )}
    </div>
  );
}

function YarnIssuesList({ issues, onDelete, onEdit, onView, canDelete, canEdit = true }) {
  const [confirmId, setConfirmId] = useState(null);
  if (issues.length === 0) {
    return <Card><Empty icon={PackageMinus} title="No yarn issues yet" hint='Add one with "New Issue".' /></Card>;
  }
  return (
    <div className="flex flex-col gap-2">
      {issues.map((i) => (
        <Card key={i.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-sm font-semibold text-stone-800">RMDC {i.issueNo}</span>
              <span style={{ backgroundColor: "#F0FDFA", color: "#0F766E" }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">{fmt(i.totalQty)} kg</span>
            </div>
            <div className="text-xs text-stone-500 mt-1">{i.weaverName} · {fmtDateDMY(i.issueDate)} · ₹{fmt(i.totalAmount)}{i.remarks && <> · {i.remarks}</>}</div>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            <button onClick={() => onView(i.id)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
              <Printer size={13} /> View / Print
            </button>
            <button onClick={() => onEdit(i.id)} disabled={!canEdit} className="flex items-center gap-1 text-stone-500 hover:text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Pencil size={13} /> Edit
            </button>
            {canDelete && (confirmId === i.id ? (
              <span className="flex items-center gap-2">
                <button onClick={() => { onDelete(i.id); setConfirmId(null); }} className="font-semibold underline text-[#0D9488]">Delete</button>
                <button onClick={() => setConfirmId(null)} className="font-semibold text-stone-500">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmId(i.id)} className="flex items-center gap-1 text-stone-400 hover:text-[#0D9488]">
                <Trash2 size={13} /> Delete
              </button>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function NewYarnIssueForm({ data, setData, existingIssues, editingIssue, onCancel, onSave }) {
  const weavers = data.weavers;
  const yarnTypes = data.yarnTypes;

  const [issueNo, setIssueNo] = useState(editingIssue?.issueNo || "");
  const [issueDate, setIssueDate] = useState(editingIssue?.issueDate || todayISO());
  const [weaverId, setWeaverId] = useState(editingIssue?.weaverId || "");
  const [remarks, setRemarks] = useState(editingIssue?.remarks || "");
  const [items, setItems] = useState(() =>
    editingIssue
      ? editingIssue.items.map((it) => ({ id: uid("item"), yarnTypeId: it.yarnTypeId, colourId: it.colourId, qty: it.qty, rate: it.rate }))
      : [{ id: uid("item"), yarnTypeId: "", colourId: "", qty: "", rate: "" }]
  );
  const [supplierName, setSupplierName] = useState(editingIssue?.supplierName || "");
  const [transportName, setTransportName] = useState(editingIssue?.transportName || "");
  const [lrNo, setLrNo] = useState(editingIssue?.lrNo || "");
  const [lrDate, setLrDate] = useState(editingIssue?.lrDate || "");
  const [paymentTerm, setPaymentTerm] = useState(editingIssue?.paymentTerm || PAYMENT_TERMS[0]);
  const [error, setError] = useState("");
  const [addModal, setAddModal] = useState(null);

  const updateItem = (id, patch) => setItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addItemRow = () => setItems((rows) => [...rows, { id: uid("item"), yarnTypeId: "", colourId: "", qty: "", rate: "" }]);
  const removeItemRow = (id) => setItems((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));

  const amountFor = (row) => (Number(row.qty) || 0) * (Number(row.rate) || 0);
  const totalQty = items.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalAmount = items.reduce((s, r) => s + amountFor(r), 0);

  const isDuplicateIssueNo = (n) =>
    existingIssues.some((i) => (!editingIssue || i.id !== editingIssue.id) && i.issueNo.trim().toLowerCase() === n.trim().toLowerCase());

  const createYarnType = (name, denier) => {
    const dNorm = withDenierSuffix(denier);
    const dup = yarnTypes.some((y) => y.name.trim().toLowerCase() === name.toLowerCase() && stripDenierSuffix(y.denier).toLowerCase() === stripDenierSuffix(dNorm).toLowerCase());
    if (dup) return `${name} — ${dNorm} already exists.`;
    const id = uid("yt");
    setData({ ...data, yarnTypes: [...yarnTypes, { id, name, denier: dNorm, colours: [] }] });
    if (addModal.kind === "itemYarn") updateItem(addModal.itemId, { yarnTypeId: id, colourId: "" });
    setAddModal(null);
    return null;
  };
  const createColour = (colourName) => {
    const yt = yarnTypes.find((y) => y.id === addModal.yarnTypeId);
    if (!yt) return "Select a yarn quality first.";
    const dup = yt.colours.some((c) => c.colourName.trim().toLowerCase() === colourName.toLowerCase());
    if (dup) return `"${colourName}" already exists for this yarn.`;
    const id = uid("col");
    setData({ ...data, yarnTypes: yarnTypes.map((y) => (y.id === yt.id ? { ...y, colours: [...y.colours, { id, colourName }] } : y)) });
    if (addModal.kind === "itemColour") updateItem(addModal.itemId, { colourId: id });
    setAddModal(null);
    return null;
  };
  const createWeaver = (name, address, whatsapp, email) => {
    const id = uid("weaver");
    setData({ ...data, weavers: [...weavers, { id, name, address, whatsapp, email }] });
    setWeaverId(id);
    setAddModal(null);
    return null;
  };

  const submit = () => {
    const n = issueNo.trim();
    if (!n) { setError("RMDC No is required."); return; }
    if (isDuplicateIssueNo(n)) { setError(`RMDC No "${n}" already exists — enter a different one.`); return; }
    if (!issueDate) { setError("RMDC date is required."); return; }
    if (getFY(issueDate) !== data.currentFY) { setError(`RMDC date must fall within the selected FY (${data.currentFY}) — switch FY in the sidebar first if this date belongs to a different year.`); return; }
    if (!weaverId) { setError("Select a weaver."); return; }
    if (items.some((r) => !r.yarnTypeId || !r.colourId || !String(r.qty).trim())) {
      setError("Every row needs a yarn quality, colour and quantity.");
      return;
    }

    const weaver = weavers.find((w) => w.id === weaverId);
    const itemsOut = items.map((r, i) => {
      const yt = yarnTypes.find((y) => y.id === r.yarnTypeId);
      const col = yt?.colours.find((c) => c.id === r.colourId);
      return {
        sl: i + 1, yarnTypeId: r.yarnTypeId, yarnTypeName: yt ? `${yt.name} ${yt.denier}` : "",
        colourId: r.colourId, colourName: col ? col.colourName : "",
        qty: r.qty, rate: r.rate, amount: amountFor(r),
      };
    });

    onSave({
      id: editingIssue ? editingIssue.id : uid("issue"), issueNo: n, issueDate, weaverId: weaver.id, weaverName: weaver.name,
      remarks: remarks.trim(),
      items: itemsOut, totalQty, totalAmount,
      supplierName: supplierName.trim(), transportName: transportName.trim(),
      lrNo: lrNo.trim(), lrDate, paymentTerm,
      createdAt: editingIssue ? editingIssue.createdAt : Date.now(),
    });
  };

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4"><ArrowLeft size={15} /> Back</button>
      <Header title={editingIssue ? `Edit Yarn Issue — ${editingIssue.issueNo}` : "New Yarn Issue"} />

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>RMDC No</Label>
            <Input placeholder="e.g. YI-118" value={issueNo} onChange={(e) => { setIssueNo(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>RMDC date</Label>
            <Input type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setError(""); }} />
          </div>
          <div>
            <Label>Weaver name</Label>
            <div className="flex gap-1.5">
              <Select value={weaverId} onChange={(e) => { setWeaverId(e.target.value); setError(""); }}>
                <option value="">Select weaver…</option>
                {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              <AddBtn title="Add weaver" onClick={() => setAddModal({ kind: "weaver" })} />
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
          <Btn variant="ghost" onClick={addItemRow}><Plus size={13} /> Add row</Btn>
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
                const yt = yarnTypes.find((y) => y.id === row.yarnTypeId);
                return (
                  <tr key={row.id} className="border-t border-stone-100">
                    <td className="px-4 py-1.5 text-stone-500 yll-mono">{i + 1}</td>
                    <td className="px-2 py-1.5 min-w-[190px]">
                      <div className="flex gap-1.5">
                        <Select value={row.yarnTypeId} onChange={(e) => updateItem(row.id, { yarnTypeId: e.target.value, colourId: "" })}>
                          <option value="">Select…</option>
                          {yarnTypes.map((y) => <option key={y.id} value={y.id}>{y.name} {y.denier}</option>)}
                        </Select>
                        <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: "itemYarn", itemId: row.id })} />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 min-w-[170px]">
                      <div className="flex gap-1.5">
                        <Select value={row.colourId} onChange={(e) => updateItem(row.id, { colourId: e.target.value })} disabled={!yt}>
                          <option value="">{yt ? "Select…" : "Pick yarn first"}</option>
                          {(yt?.colours || []).map((c) => <option key={c.id} value={c.id}>{c.colourName}</option>)}
                        </Select>
                        <AddBtn title="Add colour" disabled={!yt}
                          onClick={() => setAddModal({ kind: "itemColour", itemId: row.id, yarnTypeId: yt?.id, yarnLabel: yt ? `${yt.name} ${yt.denier}` : "" })} />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 w-24"><Input className="text-right" value={row.qty} onChange={(e) => updateItem(row.id, { qty: e.target.value })} placeholder="0" /></td>
                    <td className="px-2 py-1.5 w-24"><Input className="text-right" value={row.rate} onChange={(e) => updateItem(row.id, { rate: e.target.value })} placeholder="0" /></td>
                    <td className="px-3 py-1.5 w-28 text-right yll-mono text-stone-600">{fmt(amountFor(row))}</td>
                    <td className="px-2 py-1.5">
                      {items.length > 1 && <button onClick={() => removeItemRow(row.id)} className="text-stone-400 hover:text-[#0D9488]"><X size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200">
                <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={3}>Total</td>
                <td className="px-2 py-2 text-right text-sm font-semibold text-stone-800 yll-mono">{fmt(totalQty)}</td>
                <td></td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 yll-mono">{fmt(totalAmount)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="p-5 max-w-2xl mb-5">
        <Label>Dispatch details</Label>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Supplier Name</Label><Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="—" /></div>
          <div><Label>Transport Name</Label><Input value={transportName} onChange={(e) => setTransportName(e.target.value)} placeholder="—" /></div>
          <div><Label>LR No.</Label><Input value={lrNo} onChange={(e) => setLrNo(e.target.value)} placeholder="—" /></div>
          <div><Label>LR Date</Label><Input type="date" value={lrDate} onChange={(e) => setLrDate(e.target.value)} /></div>
          <div>
            <Label>To-Pay / Paid</Label>
            <Select value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)}>
              {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit}><Check size={15} /> {editingIssue ? "Save changes" : "Save issue"}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>

      {addModal?.kind === "weaver" && <QuickAddWeaverModal onClose={() => setAddModal(null)} onCreate={createWeaver} />}
      {addModal?.kind === "itemYarn" && <QuickAddYarnTypeModal onClose={() => setAddModal(null)} onCreate={createYarnType} />}
      {addModal?.kind === "itemColour" && <QuickAddColourModal yarnLabel={addModal.yarnLabel} onClose={() => setAddModal(null)} onCreate={createColour} />}
    </div>
  );
}

/* =================================================================
   STOCK-IN-HAND

   Yarn issued beyond what's required, as on a chosen date — the same
   "excess with weaver" idea from Yarn Required's Summary, but as its
   own filterable, printable, PDF-able report. Orders and issues dated
   after the chosen date are simply left out of both sides of the sum,
   giving a snapshot as it would have stood on that day.
==================================================================*/
function StockInHand({ data }) {
  const weavers = data.weavers;
  const orders = data.productionOrders;
  const designs = data.designs;
  const yarnTypes = data.yarnTypes;
  const yarnIssues = data.yarnIssues;

  const [weaverFilter, setWeaverFilter] = useState("");
  const [asOnDate, setAsOnDate] = useState(todayISO());
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({}); // `${weaverId}|${yarnTypeName}` -> bool
  const [query, setQuery] = useState("");
  const [ledger, setLedger] = useState(null);
  const printRef = useRef(null);

  const toggleGroup = (key) => setExpandedGroups((g) => ({ ...g, [key]: !g[key] }));

  const rows = useMemo(() => {
    const relevantWeavers = weaverFilter ? weavers.filter((w) => w.id === weaverFilter) : weavers;
    const ordersAsOf = orders.filter((o) => !o.poDate || o.poDate <= asOnDate);
    const issuesAsOf = yarnIssues.filter((i) => !i.issueDate || i.issueDate <= asOnDate);

    return relevantWeavers
      .map((w) => {
        const { summary } = aggregateYarnRequirement(ordersAsOf.filter((o) => o.weaverId === w.id), designs, yarnTypes);
        const requiredByKey = {};
        summary.forEach((r) => { requiredByKey[`${r.yarnTypeId}|${r.colourId}`] = r.kg; });

        const issuedByKey = {};
        issuesAsOf.filter((i) => i.weaverId === w.id).forEach((i) => i.items.forEach((it) => {
          const key = `${it.yarnTypeId}|${it.colourId}`;
          if (!issuedByKey[key]) issuedByKey[key] = { yarnTypeId: it.yarnTypeId, colourId: it.colourId, yarnTypeName: it.yarnTypeName, colourName: it.colourName, kg: 0 };
          issuedByKey[key].kg += Number(it.qty) || 0;
        }));

        // Zero or negative (issued not exceeding required) never shows up.
        const items = Object.entries(issuedByKey)
          .map(([key, iss]) => ({
            yarnTypeId: iss.yarnTypeId, colourId: iss.colourId,
            yarnTypeName: iss.yarnTypeName,
            colourName: iss.colourName,
            stockKg: Math.max(iss.kg - (requiredByKey[key] || 0), 0),
          }))
          .filter((it) => it.stockKg > 0)
          .sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName) || a.colourName.localeCompare(b.colourName));

        const groupsMap = {};
        items.forEach((it) => {
          if (!groupsMap[it.yarnTypeName]) groupsMap[it.yarnTypeName] = { yarnTypeName: it.yarnTypeName, colours: [], subtotalKg: 0 };
          groupsMap[it.yarnTypeName].colours.push(it);
          groupsMap[it.yarnTypeName].subtotalKg += it.stockKg;
        });
        const groups = Object.values(groupsMap).sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName));

        return { weaver: w, groups, totalKg: items.reduce((s, it) => s + it.stockKg, 0) };
      })
      .filter((w) => w.groups.length > 0);
  }, [weaverFilter, asOnDate, weavers, orders, designs, yarnTypes, yarnIssues]);

  const grandTotal = rows.reduce((s, w) => s + w.totalKg, 0);

  // Keyword search — matches a weaver's name outright, or narrows a
  // weaver's own groups/colours down to just the matching yarn or colour.
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows
      .map((w) => {
        if (w.weaver.name.toLowerCase().includes(q)) return w;
        const groups = w.groups
          .map((g) => {
            const yarnMatches = g.yarnTypeName.toLowerCase().includes(q);
            const colours = yarnMatches ? g.colours : g.colours.filter((c) => c.colourName.toLowerCase().includes(q));
            return { ...g, colours };
          })
          .filter((g) => g.colours.length > 0);
        return { ...w, groups };
      })
      .filter((w) => w.groups.length > 0);
  }, [rows, query]);

  const handleDownloadPDF = async () => {
    setBusy("pdf"); setToast("");
    const prevExpanded = expandedGroups;
    setExpandedGroups(expandAllForShare());
    await new Promise((r) => setTimeout(r, 60)); // let the expand re-render before capture
    try {
      await downloadElementAsPDF(printRef.current, `Stock-in-Hand-${asOnDate}.pdf`);
    } catch (e) {
      setToast(`${e?.message || "Couldn't generate the PDF."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally {
      setExpandedGroups(prevExpanded);
      setBusy("");
    }
  };

  const expandAllForShare = () => {
    const allKeys = {};
    rows.forEach(({ weaver, groups }) => groups.forEach((g) => { allKeys[`${weaver.id}|${g.yarnTypeName}`] = true; }));
    return allKeys;
  };

  const handleShareWhatsApp = async () => {
    setBusy("whatsapp"); setToast("");
    const prevExpanded = expandedGroups;
    setExpandedGroups(expandAllForShare());
    await new Promise((r) => setTimeout(r, 60));
    try {
      const dataUrl = await captureElementAsJPG(printRef.current);
      const result = await shareJPGOnWhatsApp(dataUrl, `Stock-in-Hand-${asOnDate}.jpg`, `Stock-in-Hand as on ${fmtDateDMY(asOnDate)}`);
      if (result === "fallback") setToast("Your browser can't attach the image automatically — it's downloaded, so just attach it in the WhatsApp chat that opened.");
    } catch (e) {
      setToast(`${e?.message || "Couldn't prepare the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally {
      setExpandedGroups(prevExpanded);
      setBusy("");
    }
  };

  const handleShareEmail = async () => {
    setBusy("email"); setToast("");
    const prevExpanded = expandedGroups;
    setExpandedGroups(expandAllForShare());
    await new Promise((r) => setTimeout(r, 60));
    try {
      const dataUrl = await captureElementAsJPG(printRef.current);
      const result = await shareFileByEmail(dataUrl, `Stock-in-Hand-${asOnDate}.jpg`, "image/jpeg",
        `Stock-in-Hand as on ${fmtDateDMY(asOnDate)}`, `Stock-in-Hand report as on ${fmtDateDMY(asOnDate)}.`);
      if (result === "fallback") setToast("The image is downloaded — attach it to the email draft that opened.");
    } catch (e) {
      setToast(`${e?.message || "Couldn't prepare the image."} If this keeps happening, try opening this file in a regular browser tab — some preview environments block the script this needs.`);
    } finally {
      setExpandedGroups(prevExpanded);
      setBusy("");
    }
  };

  const handleExportExcel = () => {
    const headers = ["Weaver", "Yarn Quality", "Colour", "Stock (kg)"];
    const csvRows = [];
    rows.forEach(({ weaver, groups }) => {
      groups.forEach((g) => {
        g.colours.forEach((c) => {
          csvRows.push([weaver.name, g.yarnTypeName, c.colourName, fmt(c.stockKg)]);
        });
      });
    });
    downloadCSV(`Stock-in-Hand-${asOnDate}.csv`, headers, csvRows);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3 print:hidden">
        <Header title="Stock-in-Hand" subtitle="Yarn issued beyond what's required, as on a chosen date — yarn+colour specific, weaver-wise." />
        <div className="flex gap-2 flex-wrap">
          <Btn variant="ghost" onClick={() => window.print()}><Printer size={14} /> Print</Btn>
          <Btn variant="ghost" onClick={handleExportExcel}><FileText size={14} /> Export to Excel</Btn>
          <Btn variant="ghost" onClick={handleDownloadPDF} disabled={busy === "pdf"}>
            {busy === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
          </Btn>
          <Btn variant="ghost" onClick={handleShareEmail} disabled={busy === "email"}>
            {busy === "email" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Share on Email
          </Btn>
          <Btn onClick={handleShareWhatsApp} disabled={busy === "whatsapp"}>
            {busy === "whatsapp" ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share on WhatsApp
          </Btn>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-5 print:hidden">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search weaver, yarn, colour…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
          <option value="">All weavers</option>
          {weavers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Input type="date" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} className="max-w-[170px]" />
      </div>
      {toast && <div className="text-xs mb-3 text-[#0D9488] print:hidden">{toast}</div>}

      <div ref={printRef} className="print-area bg-white">
        <div className="mb-4">
          <div className="yll-wordmark text-xl" style={{ color: "#1C1917" }}>SOUTH HANDLOOMS</div>
          <div className="text-sm font-semibold text-stone-700 mt-1">Stock-in-Hand — as on {fmtDateDMY(asOnDate)}</div>
        </div>

        {rows.length === 0 ? (
          <Card><Empty icon={Warehouse} title="No stock in hand" hint="No weaver has been issued more yarn than required, as on this date." /></Card>
        ) : visibleRows.length === 0 ? (
          <Card><Empty icon={Search} title="No matches" hint="Try a different search term." /></Card>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleRows.map(({ weaver, groups, totalKg }) => (
              <Card key={weaver.id} className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-stone-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-stone-800">{weaver.name}</span>
                  <span className="text-sm font-semibold yll-mono" style={{ color: "#2563EB" }}>{fmt(totalKg)} kg</span>
                </div>
                <div className="divide-y divide-stone-100">
                  {groups.map((g) => {
                    const key = `${weaver.id}|${g.yarnTypeName}`;
                    const expanded = !!expandedGroups[key];
                    return (
                      <div key={g.yarnTypeName}>
                        <div className="flex items-center justify-between px-4 py-2 cursor-pointer select-none hover:bg-stone-50" onClick={() => toggleGroup(key)}>
                          <div className="flex items-center gap-2">
                            {expanded ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
                            <span className="text-sm font-medium text-stone-800">{g.yarnTypeName}</span>
                          </div>
                          <span className="text-sm font-semibold yll-mono" style={{ color: "#2563EB" }}>{fmt(g.subtotalKg)} kg</span>
                        </div>
                        {expanded && (
                          <table className="w-full text-sm" style={{ backgroundColor: "#FAFAF9" }}>
                            <tbody>
                              {g.colours.map((c, i) => (
                                <tr key={i} className="border-t border-stone-200 cursor-pointer hover:bg-stone-100"
                                  onClick={() => setLedger(buildColourLedger({ yarnTypeId: c.yarnTypeId, colourId: c.colourId, yarnTypeName: g.yarnTypeName, colourName: c.colourName, weaverId: weaver.id, data, asOnDate }))}>
                                  <td className="px-4 pl-9 py-1 text-stone-700 underline decoration-dotted decoration-stone-300">{c.colourName}</td>
                                  <td className="px-4 py-1 text-right yll-mono font-medium" style={{ color: "#2563EB" }}>{fmt(c.stockKg)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
            <div className="flex justify-end px-2">
              <span className="text-sm font-semibold text-stone-700">Grand total: <span className="yll-mono" style={{ color: "#2563EB" }}>{fmt(grandTotal)} kg</span></span>
            </div>
          </div>
        )}
      </div>
      {ledger && <ColourLedgerModal ledger={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}

/* =================================================================
   YARN CONSUMPTION NORMS

   Reference + calculator for the formulas that drive Yarn Required.
   Weft's formula is what's already wired into every order; Warp's
   isn't defined yet — this is where it'll live once it is.
==================================================================*/
function ConsumptionNorms() {
  const [tab, setTab] = useState("weft"); // "weft" | "warp"
  const [denier, setDenier] = useState("150");
  const [width, setWidth] = useState("48");
  const [pick, setPick] = useState("60");
  const [qty, setQty] = useState("100");
  const [warpDenier, setWarpDenier] = useState("150");
  const [warpWidth, setWarpWidth] = useState("48");
  const [reed, setReed] = useState("96");
  const [totalMts, setTotalMts] = useState("100");

  const kg = (Number(denier) || 0) * (Number(width) || 0) * 110 * (Number(pick) || 0) / 9000000 / 100 * (Number(qty) || 0);
  const warpKg = (Number(warpDenier) || 0) * (((Number(warpWidth) || 0) * 1.04 * (Number(reed) || 0)) + 100) * (Number(totalMts) || 0) / 9000000 * 1.10;

  return (
    <div>
      <Header title="Yarn Consumption Norms" subtitle="The formulas Yarn Required is built on — and a quick calculator for checking a figure by hand." />

      <div className="flex rounded-md overflow-hidden mb-5 max-w-xs" style={{ border: "1px solid #E7E2DC" }}>
        <button onClick={() => setTab("weft")} className="flex-1 py-2 text-sm font-semibold transition-colors"
          style={tab === "weft" ? { backgroundColor: "#0D9488", color: "#fff" } : { backgroundColor: "transparent", color: "#78716C" }}>
          Weft
        </button>
        <button onClick={() => setTab("warp")} className="flex-1 py-2 text-sm font-semibold transition-colors"
          style={tab === "warp" ? { backgroundColor: "#0D9488", color: "#fff" } : { backgroundColor: "transparent", color: "#78716C" }}>
          Warp
        </button>
      </div>

      {tab === "weft" ? (
        <>
          <Card className="p-5 max-w-2xl mb-5">
            <Label>Formula</Label>
            <div className="text-sm font-medium yll-mono text-stone-700 mb-1">
              kg = (Denier × Width × 110 × Pick) ÷ 9,000,000 ÷ 100 × Qty
            </div>
            <p className="text-xs text-stone-500">
              This is exactly what Yarn Required runs per feeder, per colourway line, on every Production Order — Denier from the feeder's Yarn Quality,
              Pick from that feeder's own row on the Design (not the order's overall Base Pick), Width from the order (plus a design's Salvage, if any), and Qty in metres.
            </p>
          </Card>

          <Card className="p-5 max-w-2xl">
            <Label>Try it</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
              <div><Label>Denier</Label><Input value={denier} onChange={(e) => setDenier(e.target.value)} /></div>
              <div><Label>Width</Label><Input value={width} onChange={(e) => setWidth(e.target.value)} /></div>
              <div><Label>Pick</Label><Input value={pick} onChange={(e) => setPick(e.target.value)} /></div>
              <div><Label>Qty (mtrs)</Label><Input value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            </div>
            <div className="mt-4 pt-4 border-t border-stone-200 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Result</span>
              <span className="text-lg font-semibold yll-mono" style={{ color: "#0D9488" }}>{fmt(kg)} kg</span>
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card className="p-5 max-w-2xl mb-5">
            <Label>Formula</Label>
            <div className="text-sm font-medium yll-mono text-stone-700 mb-1">
              kg = Denier × ((Width × 1.04 × Reed) + 100) × Total Mts ÷ 9,000,000 × 1.10
            </div>
            <p className="text-xs text-stone-500">
              This runs once per Production Order (not per feeder or colourway) — Denier and Colour from the order's own Warp Yarn, Reed from the underlying Design,
              Width from the order as entered (no Salvage allowance here — that only applies to Weft), and Total Mts from the order's own total across every colourway line.
            </p>
          </Card>

          <Card className="p-5 max-w-2xl">
            <Label>Try it</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
              <div><Label>Denier</Label><Input value={warpDenier} onChange={(e) => setWarpDenier(e.target.value)} /></div>
              <div><Label>Width</Label><Input value={warpWidth} onChange={(e) => setWarpWidth(e.target.value)} /></div>
              <div><Label>Reed</Label><Input value={reed} onChange={(e) => setReed(e.target.value)} /></div>
              <div><Label>Total Mts</Label><Input value={totalMts} onChange={(e) => setTotalMts(e.target.value)} /></div>
            </div>
            <div className="mt-4 pt-4 border-t border-stone-200 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Result</span>
              <span className="text-lg font-semibold yll-mono" style={{ color: "#0D9488" }}>{fmt(warpKg)} kg</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* =================================================================
   FY SWITCHER — sidebar control for the active financial year. Every
   FY that shows up in any transaction's own date, plus the current
   one, is listed newest-first. Admin can close a year (blocking new,
   edited or deleted transactions and order-status changes while it's
   the active one) or reopen it; User can only switch between years.
==================================================================*/
function FYSwitcher({ data, setData, canManage }) {
  const [open, setOpen] = useState(false);
  const closedFYs = data.closedFYs || [];

  const allFYs = useMemo(() => {
    const set = new Set([data.currentFY]);
    data.productionOrders.forEach((o) => { const fy = getFY(o.poDate); if (fy) set.add(fy); });
    data.receipts.forEach((r) => { const fy = getFY(r.invDate); if (fy) set.add(fy); });
    data.yarnIssues.forEach((i) => { const fy = getFY(i.issueDate); if (fy) set.add(fy); });
    return [...set].sort().reverse();
  }, [data.currentFY, data.productionOrders, data.receipts, data.yarnIssues]);

  const switchTo = (fy) => { setData({ ...data, currentFY: fy }); setOpen(false); };
  const closeFY = (fy) => setData({ ...data, closedFYs: [...closedFYs, fy] });
  const reopenFY = (fy) => setData({ ...data, closedFYs: closedFYs.filter((f) => f !== fy) });
  const isClosed = closedFYs.includes(data.currentFY);

  return (
    <div className="px-3 pt-2 pb-1">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-2 py-2 rounded text-xs font-medium text-stone-300 hover:bg-white/5 hover:text-white">
        <span className="flex items-center gap-1.5">
          <Calendar size={13} /> FY {data.currentFY}
          {isClosed && <Lock size={11} className="text-stone-500" />}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="mt-1 mb-1 space-y-0.5">
          {allFYs.map((fy) => {
            const closed = closedFYs.includes(fy);
            return (
              <div key={fy} className="flex items-center justify-between pl-6 pr-2 py-1 rounded text-xs">
                <button onClick={() => switchTo(fy)} className={fy === data.currentFY ? "text-white font-semibold" : "text-stone-400 hover:text-white"}>
                  {fy}{closed && <span className="ml-1 text-stone-500">(Closed)</span>}
                </button>
                {canManage && (
                  closed ? (
                    <button onClick={() => reopenFY(fy)} className="text-stone-500 hover:text-[#0D9488]">Reopen</button>
                  ) : (
                    <button onClick={() => closeFY(fy)} className="text-stone-500 hover:text-[#0D9488]">Close</button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =================================================================
   ROLE PICKER — soft gate, remembered per device/browser.
   User can do everything except delete; Admin has full access.
==================================================================*/
const ROLE_KEY = "sh-role-v1";
const ROLE_LABEL = { user: "User", admin: "Admin" };

const ADMIN_PASSWORD = "Her1tage1"; // soft gate only — same spirit as the PIN in yarn-loom-ledger.jsx, not real security

function RolePicker({ onChoose }) {
  const [selected, setSelected] = useState("user");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const segBtnStyle = (active) => ({
    backgroundColor: active ? "#F5F0E8" : "rgba(255,255,255,0.08)",
    color: active ? "#1C2620" : "#D6D3D1",
  });

  const submit = () => {
    if (selected === "admin" && password !== ADMIN_PASSWORD) {
      setError("Incorrect password for Admin.");
      return;
    }
    onChoose(selected);
  };

  return (
    <div className="yll-root min-h-screen flex items-center justify-center px-4 bg-stone-100">
      <FontStyles />
      <div className="w-full max-w-sm rounded-2xl p-8 shadow-xl" style={{ backgroundColor: "#1C2620" }}>
        <div className="flex justify-center mb-1"><Logo size={44} dark /></div>
        <div className="text-center text-sm font-medium mb-7" style={{ color: "#5EEAD4" }}>PO &amp; Yarn Ledger</div>

        <label className="block text-center text-[11px] font-semibold tracking-widest uppercase text-stone-400 mb-2">Log in as</label>
        <div className="flex rounded-md overflow-hidden mb-6" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
          <button onClick={() => { setSelected("user"); setError(""); }} style={segBtnStyle(selected === "user")} className="flex-1 py-2.5 text-sm font-semibold transition-colors">User</button>
          <button onClick={() => { setSelected("admin"); setError(""); }} style={segBtnStyle(selected === "admin")} className="flex-1 py-2.5 text-sm font-semibold transition-colors">Admin</button>
        </div>

        <label className="block text-[11px] font-semibold tracking-widest uppercase text-stone-400 mb-2">Password</label>
        <input
          type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={selected === "user" ? "Not required for User" : "Admin password"}
          className="w-full rounded-md bg-white text-stone-800 px-3.5 py-2.5 text-sm outline-none mb-2 focus:ring-2"
          style={{ boxShadow: "none" }}
          onFocus={(e) => (e.target.style.boxShadow = "0 0 0 2px #0D9488")}
          onBlur={(e) => (e.target.style.boxShadow = "none")}
        />
        {error && <div className="text-xs mb-4" style={{ color: "#FCA5A5" }}>{error}</div>}
        {!error && <div className="mb-4" />}

        <button onClick={submit} className="w-full py-2.5 rounded-md text-sm font-semibold transition-colors"
          style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#F5F0E8" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#0D9488")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
        >
          Log In
        </button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="yll-root min-h-screen flex items-center justify-center" style={{ backgroundColor: "#1C2620" }}>
      <FontStyles />
      <div className="flex items-center gap-2 text-stone-300">
        <Loader2 className="animate-spin" size={18} /><span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

/* =================================================================
   APP SHELL — sidebar copied 1:1 from yarn-loom-ledger.jsx
   (mobile top bar, #1C2620 sidebar, same NavButton behaviour).
   Screens not yet built stay visible but disabled, since there are
   no per-screen access controls in this step — only the delete
   restriction between User and Admin.
==================================================================*/
const NAV = [
  { id: "production-orders", label: "Production Orders", icon: FileText, ready: true },
  { id: "yarn-required", label: "Yarn Required", icon: Scale, ready: true },
  { id: "yarn-issued", label: "Yarn Issue / RMDC", icon: PackageMinus, ready: true },
  { id: "goods-receipt", label: "Goods Receipt", icon: PackageCheck, ready: true },
  { id: "pending-orders", label: "Pending Orders", icon: Hourglass, ready: true },
  { id: "stock", label: "Stock-in-Hand", icon: Warehouse, ready: true },
  { id: "weavers", label: "Weavers", icon: Users, ready: true },
  { id: "design-library", label: "Design Library", icon: LayoutGrid, ready: true },
  { id: "yarn-types", label: "Yarn Library", icon: Boxes, ready: true },
  { id: "fabric-types", label: "Fabric Types", icon: Tag, ready: true },
  { id: "consumption-norms", label: "Consumption Norms", icon: Calculator, ready: true },
  { id: "users", label: "Users", icon: KeyRound, ready: true },
];

export default function App() {
  const [data, setDataRaw] = useState(null); // null until loaded from storage
  const [role, setRole] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("production-orders");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadData(), storageGet(ROLE_KEY)]).then(([d, r]) => {
      if (cancelled) return;
      setDataRaw(d);
      setRole(r || null);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (loaded) saveData(data); }, [data, loaded]);
  const setData = (next) => setDataRaw(next);

  const chooseRole = (r) => { setRole(r); storageSet(ROLE_KEY, r); };
  const switchRole = () => { setRole(null); storageSet(ROLE_KEY, ""); };

  if (!loaded) return <LoadingScreen />;
  if (!role) return <RolePicker onChoose={chooseRole} />;
  const canDelete = role === "admin";

  const NavButton = ({ n }) => {
    const Icon = n.icon;
    const active = tab === n.id;
    return (
      <button
        onClick={() => { if (n.ready) { setTab(n.id); setNavOpen(false); } }}
        disabled={!n.ready}
        style={active ? { backgroundColor: "#0D9488" } : {}}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active ? "text-white" : "text-stone-400 hover:bg-white/5 hover:text-white"}`}
      >
        <Icon size={16} />{n.label}{!n.ready && <span className="ml-auto text-[10px] font-normal">soon</span>}
      </button>
    );
  };

  return (
    <div className="yll-root min-h-screen bg-stone-50 text-stone-800 flex flex-col md:flex-row">
      <FontStyles />

      <div style={{ backgroundColor: "#1C2620" }} className="md:hidden flex items-center justify-between px-4 py-3 text-white sticky top-0 z-30">
        <Logo size={30} dark />
        <button onClick={() => setNavOpen((v) => !v)}>{navOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>

      <div style={{ backgroundColor: "#1C2620" }} className={`${navOpen ? "block" : "hidden"} md:block md:w-56 shrink-0 text-white relative flex flex-col`}>
        <div className="hidden md:block px-5 pt-6 pb-5">
          <Logo size={40} dark />
        </div>
        <nav className="px-2 pb-3 pt-2 md:pt-0 space-y-0.5">
          {NAV.map((n) => <NavButton key={n.id} n={n} />)}
        </nav>
        <FYSwitcher data={data} setData={setData} canManage={canDelete} />
        <div className="mt-auto px-3 pb-5 pt-3 border-t border-white/10">
          <div className="px-2 text-[11px] text-stone-400 mb-1.5">Working as <span className="text-white font-medium">{ROLE_LABEL[role]}</span></div>
          <button onClick={switchRole} className="w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded text-xs text-stone-400 hover:text-white hover:bg-white/5">
            <LogOut size={13} /> Switch role
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-0 flex">
        <div className="w-px bg-stone-200 hidden md:block" />
        <div className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-8 max-w-6xl">
          {tab === "design-library" && <DesignLibrary data={data} setData={setData} canDelete={canDelete} />}
          {tab === "yarn-types" && <YarnTypesMaster data={data} setData={setData} canDelete={canDelete} />}
          {tab === "fabric-types" && <FabricTypesMaster data={data} setData={setData} canDelete={canDelete} />}
          {tab === "consumption-norms" && <ConsumptionNorms />}
          {tab === "users" && <UsersMaster data={data} setData={setData} canDelete={canDelete} />}
          {tab === "weavers" && <WeaversMaster data={data} setData={setData} canDelete={canDelete} />}
          {tab === "production-orders" && <ProductionOrders data={data} setData={setData} canDelete={canDelete} />}
          {tab === "yarn-required" && <YarnRequired data={data} />}
          {tab === "goods-receipt" && <GoodsReceipts data={data} setData={setData} canDelete={canDelete} />}
          {tab === "pending-orders" && <PendingOrders data={data} setData={setData} />}
          {tab === "yarn-issued" && <YarnIssues data={data} setData={setData} canDelete={canDelete} />}
          {tab === "stock" && <StockInHand data={data} />}
        </div>
      </div>
    </div>
  );
}
