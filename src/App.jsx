import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import * as XLSX from "xlsx";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import {
  LayoutDashboard, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight,
  SlidersHorizontal, History, Settings, FileBarChart, DatabaseBackup,
  Moon, Sun, AlertTriangle, CheckCircle2, Menu, X, Search, Download,
  Upload, Plus, Trash2, Info, ChevronRight, Wallet, Landmark, PiggyBank,
  ShieldCheck, Coins, Banknote, RefreshCcw, Printer, ClipboardEdit, LogOut, WifiOff,
} from "lucide-react";

/* ============================================================
   KONSTANTA & UTILITAS
   ============================================================ */

const FIRESTORE_COLLECTION = "kasumkm_users";

const KATEGORI_DANA = [
  { key: "angsuran", label: "Cadangan Angsuran", icon: Landmark, color: "#0f766e" },
  { key: "gaji", label: "Cadangan Gaji", icon: Wallet, color: "#0e7490" },
  { key: "simpanan", label: "Cadangan Simpanan", icon: PiggyBank, color: "#15803d" },
  { key: "bebas", label: "Dana Bebas", icon: Coins, color: "#a16207" },
];
const KATEGORI_MAP = Object.fromEntries(KATEGORI_DANA.map((k) => [k.key, k]));
const NEGATIVE_COLOR = "#dc2626";

const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const uid = () => "tx_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function formatRupiah(n) {
  const val = Math.round(Number(n) || 0);
  const neg = val < 0;
  return (neg ? "-Rp" : "Rp") + Math.abs(val).toLocaleString("id-ID");
}
function formatThousandsID(intVal) {
  if (!intVal) return "";
  return Number(intVal).toLocaleString("id-ID");
}
function formatTanggalIndo(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function formatTanggalSingkat(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function hariDari(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "long" });
}

const defaultSettings = () => ({
  angsuranPerHari: 700000,
  gajiPerHari: 100000,
  gajiMulaiTanggal: todayISO(),
});
const defaultBalances = () => ({ cash: 0, rekening: 0, angsuran: 0, gaji: 0, simpanan: 0, bebas: 0 });

function isBalanced(b) {
  const totalNyata = b.cash + b.rekening;
  const totalDana = b.angsuran + b.gaji + b.simpanan + b.bebas;
  return Math.abs(totalNyata - totalDana) < 1;
}
function getWarnings(b) {
  const w = [];
  if (b.cash < -0.5) w.push({ label: "Cash minus", val: b.cash });
  if (b.rekening < -0.5) w.push({ label: "Rekening minus", val: b.rekening });
  KATEGORI_DANA.forEach((k) => {
    if (b[k.key] < -0.5) w.push({ label: `${k.label} minus`, val: b[k.key] });
  });
  return w;
}

/* ============================================================
   MESIN PERHITUNGAN (business logic)
   ============================================================ */

function hitungPemasukan(balances, settings, { tanggal, nominalCash, nominalRekening }) {
  const b = { ...balances };
  const angsuranHarian = settings.angsuranPerHari || 0;
  const gajiAktif = settings.gajiMulaiTanggal && tanggal >= settings.gajiMulaiTanggal;
  const gajiHarian = gajiAktif ? settings.gajiPerHari || 0 : 0;
  const totalMasuk = nominalCash + nominalRekening;

  b.cash += nominalCash;
  b.rekening += nominalRekening;
  b.angsuran += angsuranHarian;
  b.gaji += gajiHarian;

  let pool = totalMasuk - angsuranHarian - gajiHarian;

  // Tutup minus Cadangan Simpanan & Dana Bebas dahulu (hanya jika pool positif)
  if (pool > 0 && b.simpanan < 0) {
    const use = Math.min(pool, -b.simpanan);
    b.simpanan += use;
    pool -= use;
  }
  if (pool > 0 && b.bebas < 0) {
    const use = Math.min(pool, -b.bebas);
    b.bebas += use;
    pool -= use;
  }
  // Sisa dibagi 50/50 (bisa negatif jika pool negatif -> keduanya turun rata)
  b.simpanan += pool / 2;
  b.bebas += pool / 2;

  return { balances: b, meta: { angsuranHarian, gajiHarian, sisaSetelahWajib: totalMasuk - angsuranHarian - gajiHarian } };
}

function hitungPengeluaran(balances, { nominal, metode, kategori }) {
  const b = { ...balances };
  b[metode] -= nominal;
  b[kategori] -= nominal;
  return b;
}

function hitungTransferCashRekening(balances, { arah, nominal }) {
  const b = { ...balances };
  if (arah === "cash_ke_rekening") {
    b.cash -= nominal;
    b.rekening += nominal;
  } else {
    b.rekening -= nominal;
    b.cash += nominal;
  }
  return b;
}

function hitungTransferCadangan(balances, { dari, ke, nominal }) {
  const b = { ...balances };
  b[dari] -= nominal;
  b[ke] += nominal;
  return b;
}

function hitungPenyesuaian(balances, { cashReal, rekeningReal, kategoriPenyerap }) {
  const b = { ...balances };
  const selisih = (cashReal + rekeningReal) - (balances.cash + balances.rekening);
  b.cash = cashReal;
  b.rekening = rekeningReal;
  b[kategoriPenyerap] += selisih;
  return { balances: b, selisih };
}

function hitungKoreksi(balances, { field, delta }) {
  const b = { ...balances };
  b[field] += delta;
  return b;
}

/* ============================================================
   KOMPONEN UI DASAR
   ============================================================ */

function RibuanInput({ label, value, onChange, placeholder = "0", required, autoFocus, hint }) {
  const handle = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    onChange(raw === "" ? 0 : parseInt(raw, 10));
  };
  return (
    <label className="block">
      {label && <span className="block text-sm font-medium mb-1 text-stone-600 dark:text-stone-300">{label}</span>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-stone-400 dark:text-stone-500 tracking-wide">RB</span>
        <input
          inputMode="numeric"
          value={value ? formatThousandsID(value) : ""}
          onChange={handle}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 font-mono text-lg tabular-nums text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
        />
      </div>
      <span className="block text-xs font-mono text-emerald-700 dark:text-emerald-400 mt-1">
        = {formatRupiah((value || 0) * 1000)}
      </span>
      {hint && <span className="block text-xs text-stone-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function TanggalInput({ label = "Tanggal", value, onChange }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1 text-stone-600 dark:text-stone-300">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
      />
      <span className="block text-xs text-stone-400 mt-1 capitalize">{hariDari(value)}</span>
    </label>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-2xl border-2 border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children, icon: Icon }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-3">
      {Icon && <Icon size={16} />} {children}
    </h2>
  );
}

function PrimaryButton({ children, onClick, type = "submit", className = "", disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 text-white font-bold text-base transition-all shadow-sm ${className}`}
    >
      {children}
    </button>
  );
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <label className="block">
      {label && <span className="block text-sm font-medium mb-1 text-stone-600 dark:text-stone-300">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function TextInput({ label, value, onChange, required, placeholder, textarea }) {
  const Comp = textarea ? "textarea" : "input";
  return (
    <label className="block">
      {label && <span className="block text-sm font-medium mb-1 text-stone-600 dark:text-stone-300">{label}</span>}
      <Comp
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        rows={textarea ? 2 : undefined}
        className="w-full px-3 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
      />
    </label>
  );
}

function MoneyText({ value, className = "" }) {
  const neg = value < -0.5;
  return (
    <span className={`font-mono tabular-nums ${neg ? "text-red-600 dark:text-red-400" : ""} ${className}`}>
      {formatRupiah(value)}
    </span>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const isErr = toast.type === "error";
  return (
    <div className={`fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white flex items-center gap-2 ${isErr ? "bg-red-600" : "bg-emerald-700"}`}>
      {isErr ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      {toast.message}
    </div>
  );
}

function ConfirmDialog({ open, title, body, onConfirm, onCancel, danger }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4">
      <div className="bg-white dark:bg-stone-900 rounded-2xl p-5 w-full max-w-sm border-2 border-stone-200 dark:border-stone-700">
        <h3 className="font-bold text-lg mb-2 text-stone-800 dark:text-stone-100">{title}</h3>
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-5">{body}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border-2 border-stone-200 dark:border-stone-700 font-semibold text-stone-600 dark:text-stone-300">Batal</button>
          <button onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl font-semibold text-white ${danger ? "bg-red-600" : "bg-emerald-700"}`}>Lanjutkan</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BADGE STATUS (signature element - "cap nota")
   ============================================================ */

function StampBadge({ balanced, size = "md" }) {
  const big = size === "lg";
  return (
    <div
      className={`inline-flex items-center gap-2 border-4 rounded-lg font-mono font-black uppercase tracking-widest -rotate-3 select-none
      ${big ? "px-5 py-2 text-lg" : "px-3 py-1 text-xs"}
      ${balanced ? "border-emerald-600 text-emerald-600" : "border-red-600 text-red-600 animate-pulse"}`}
    >
      {balanced ? <CheckCircle2 size={big ? 22 : 14} /> : <AlertTriangle size={big ? 22 : 14} />}
      {balanced ? "Balanced" : "Tidak Balanced"}
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function NeracaEquation({ balances }) {
  const totalNyata = balances.cash + balances.rekening;
  const totalDana = balances.angsuran + balances.gaji + balances.simpanan + balances.bebas;
  const balanced = isBalanced(balances);
  return (
    <Card className="border-dashed">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-stone-400">Neraca Kas</span>
        <StampBadge balanced={balanced} />
      </div>

      <div className="space-y-1 font-mono text-sm">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
          <span className="text-stone-500">Cash</span><MoneyText value={balances.cash} className="font-semibold"/>
          <span className="text-stone-400">+</span>
          <span className="text-stone-500">Rekening</span><MoneyText value={balances.rekening} className="font-semibold"/>
        </div>
        <div className="text-stone-400 pl-1">=</div>
        <div className="text-lg font-black text-stone-800 dark:text-stone-100">{formatRupiah(totalNyata)} <span className="text-xs font-normal text-stone-400 uppercase tracking-wide">Total Uang Nyata</span></div>
      </div>

      <div className="my-3 border-t-2 border-dashed border-stone-200 dark:border-stone-700" />

      <div className="space-y-1 font-mono text-sm">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
          {KATEGORI_DANA.map((k, i) => (
            <React.Fragment key={k.key}>
              {i > 0 && <span className="text-stone-400">+</span>}
              <span className="text-stone-500">{k.label}</span>
              <MoneyText value={balances[k.key]} className="font-semibold" />
            </React.Fragment>
          ))}
        </div>
        <div className="text-stone-400 pl-1">=</div>
        <div className="text-lg font-black text-stone-800 dark:text-stone-100">{formatRupiah(totalDana)} <span className="text-xs font-normal text-stone-400 uppercase tracking-wide">Total Dana</span></div>
      </div>
    </Card>
  );
}

function BalanceGrid({ balances }) {
  const items = [
    { label: "Cash", val: balances.cash, icon: Banknote },
    { label: "Rekening", val: balances.rekening, icon: Landmark },
    ...KATEGORI_DANA.map((k) => ({ label: k.label, val: balances[k.key], icon: k.icon })),
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((it) => (
        <Card key={it.label} className="!p-3">
          <div className="flex items-center gap-1.5 text-stone-400 mb-1">
            <it.icon size={14} />
            <span className="text-[11px] font-semibold uppercase tracking-wide">{it.label}</span>
          </div>
          <MoneyText value={it.val} className="text-base font-bold" />
        </Card>
      ))}
    </div>
  );
}

function WarningBanner({ warnings }) {
  if (!warnings.length) return null;
  return (
    <div className="rounded-2xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4">
      <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-sm mb-2">
        <AlertTriangle size={16} /> Peringatan Saldo Minus
      </div>
      <ul className="space-y-1">
        {warnings.map((w) => (
          <li key={w.label} className="text-sm text-red-600 dark:text-red-400 flex justify-between font-mono">
            <span className="font-sans">{w.label}</span> <span>{formatRupiah(w.val)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PIE_COLORS = ["#0f766e", "#0e7490", "#15803d", "#a16207"];

function PieCard({ title, data }) {
  const total = data.reduce((s, d) => s + Math.abs(d.raw), 0);
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {total === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-stone-400">Belum ada data</div>
      ) : (
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.raw < 0 ? NEGATIVE_COLOR : PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v, n, p) => formatRupiah(p.payload.raw)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function TrendCard({ transactions }) {
  const data = useMemo(() => {
    const byDate = {};
    [...transactions]
      .sort((a, b) => (a.tanggal + a.jam).localeCompare(b.tanggal + b.jam))
      .forEach((t) => {
        byDate[t.tanggal] = t.saldoSetelah;
      });
    return Object.entries(byDate).map(([tanggal, s]) => ({
      tanggal: formatTanggalSingkat(tanggal),
      Total: s.cash + s.rekening,
      Cash: s.cash,
      Rekening: s.rekening,
    }));
  }, [transactions]);

  return (
    <Card>
      <SectionTitle icon={FileBarChart}>Perkembangan Saldo Harian</SectionTitle>
      {data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-stone-400">Belum ada data</div>
      ) : (
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="tanggal" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v / 1000).toLocaleString("id-ID")} width={50} />
              <Tooltip formatter={(v) => formatRupiah(v)} />
              <Legend />
              <Line type="monotone" dataKey="Total" stroke="#0f766e" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="Cash" stroke="#a16207" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Rekening" stroke="#0e7490" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function DashboardPage({ balances, transactions }) {
  const warnings = getWarnings(balances);
  const pieUang = [
    { name: "Cash", value: Math.abs(balances.cash), raw: balances.cash },
    { name: "Rekening", value: Math.abs(balances.rekening), raw: balances.rekening },
  ];
  const pieDana = KATEGORI_DANA.map((k) => ({ name: k.label, value: Math.abs(balances[k.key]), raw: balances[k.key] }));
  return (
    <div className="space-y-4 pb-4">
      <NeracaEquation balances={balances} />
      <WarningBanner warnings={warnings} />
      <BalanceGrid balances={balances} />
      <div className="grid md:grid-cols-2 gap-4">
        <PieCard title="Komposisi Uang Nyata" data={pieUang} />
        <PieCard title="Komposisi Dana" data={pieDana} />
      </div>
      <TrendCard transactions={transactions} />
    </div>
  );
}

/* ============================================================
   PEMASUKAN HARIAN
   ============================================================ */

function PemasukanPage({ balances, settings, onSubmit }) {
  const [tanggal, setTanggal] = useState(todayISO());
  const [cash, setCash] = useState(0);
  const [rekening, setRekening] = useState(0);
  const [catatan, setCatatan] = useState("");

  const nominalCash = cash * 1000;
  const nominalRekening = rekening * 1000;
  const angsuranHarian = settings.angsuranPerHari || 0;
  const gajiAktif = settings.gajiMulaiTanggal && tanggal >= settings.gajiMulaiTanggal;
  const gajiHarian = gajiAktif ? settings.gajiPerHari || 0 : 0;
  const totalMasuk = nominalCash + nominalRekening;
  const sisa = totalMasuk - angsuranHarian - gajiHarian;

  const submit = (e) => {
    e.preventDefault();
    if (totalMasuk <= 0) return;
    onSubmit({ tanggal, nominalCash, nominalRekening, catatan });
    setCash(0); setRekening(0); setCatatan("");
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card>
        <SectionTitle icon={ArrowDownCircle}>Pemasukan Harian</SectionTitle>
        <div className="space-y-4">
          <TanggalInput value={tanggal} onChange={setTanggal} />
          <RibuanInput label="Nominal Cash" value={cash} onChange={setCash} />
          <RibuanInput label="Nominal Rekening" value={rekening} onChange={setRekening} />
          <TextInput label="Catatan" value={catatan} onChange={setCatatan} placeholder="Opsional" />
        </div>
      </Card>

      <Card className="!bg-emerald-50 dark:!bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
        <SectionTitle icon={Info}>Simulasi Pencadangan Otomatis</SectionTitle>
        <div className="space-y-1.5 text-sm font-mono">
          <div className="flex justify-between"><span className="font-sans text-stone-500">Total Masuk</span><span className="font-bold">{formatRupiah(totalMasuk)}</span></div>
          <div className="flex justify-between"><span className="font-sans text-stone-500">→ Cadangan Angsuran</span><span>{formatRupiah(angsuranHarian)}</span></div>
          <div className="flex justify-between">
            <span className="font-sans text-stone-500">→ Cadangan Gaji {!gajiAktif && <em className="not-italic text-amber-600">(belum aktif)</em>}</span>
            <span>{formatRupiah(gajiHarian)}</span>
          </div>
          <div className="flex justify-between border-t border-dashed border-emerald-300 dark:border-emerald-800 pt-1.5">
            <span className="font-sans text-stone-500">Sisa dibagi 50/50</span><span className="font-bold">{formatRupiah(sisa)}</span>
          </div>
          <div className="flex justify-between pl-3"><span className="font-sans text-stone-500">→ Cadangan Simpanan</span><span>{formatRupiah(sisa / 2)}</span></div>
          <div className="flex justify-between pl-3"><span className="font-sans text-stone-500">→ Dana Bebas</span><span>{formatRupiah(sisa / 2)}</span></div>
        </div>
        {(balances.simpanan < 0 || balances.bebas < 0) && sisa > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">* Sebagian alokasi otomatis dipakai menutup saldo minus Simpanan/Dana Bebas terlebih dahulu.</p>
        )}
      </Card>

      <PrimaryButton disabled={totalMasuk <= 0}>Simpan Pemasukan</PrimaryButton>
    </form>
  );
}

/* ============================================================
   PENGELUARAN
   ============================================================ */

function PengeluaranPage({ balances, onSubmit }) {
  const [tanggal, setTanggal] = useState(todayISO());
  const [nominal, setNominal] = useState(0);
  const [metode, setMetode] = useState("cash");
  const [kategori, setKategori] = useState("bebas");
  const [keterangan, setKeterangan] = useState("");

  const nominalRp = nominal * 1000;
  const akanMinusMetode = balances[metode] - nominalRp < -0.5;
  const akanMinusKategori = balances[kategori] - nominalRp < -0.5;

  const submit = (e) => {
    e.preventDefault();
    if (nominalRp <= 0 || !keterangan.trim()) return;
    onSubmit({ tanggal, nominal: nominalRp, metode, kategori, keterangan });
    setNominal(0); setKeterangan("");
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card>
        <SectionTitle icon={ArrowUpCircle}>Pengeluaran</SectionTitle>
        <div className="space-y-4">
          <TanggalInput value={tanggal} onChange={setTanggal} />
          <RibuanInput label="Nominal" value={nominal} onChange={setNominal} />
          <SelectInput label="Metode Pembayaran" value={metode} onChange={setMetode}
            options={[{ value: "cash", label: `Cash (saldo: ${formatRupiah(balances.cash)})` }, { value: "rekening", label: `Rekening (saldo: ${formatRupiah(balances.rekening)})` }]} />
          <SelectInput label="Kategori Dana" value={kategori} onChange={setKategori}
            options={KATEGORI_DANA.map((k) => ({ value: k.key, label: `${k.label} (saldo: ${formatRupiah(balances[k.key])})` }))} />
          <TextInput label="Keterangan" value={keterangan} onChange={setKeterangan} required placeholder="Contoh: Beli bahan baku" textarea />
        </div>
      </Card>

      {(akanMinusMetode || akanMinusKategori) && nominalRp > 0 && (
        <div className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400 flex gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>Transaksi ini akan membuat saldo {akanMinusMetode ? (metode === "cash" ? "Cash" : "Rekening") : KATEGORI_MAP[kategori].label} menjadi minus. Tetap diizinkan — akan tertutup oleh alokasi pemasukan berikutnya.</span>
        </div>
      )}

      <PrimaryButton disabled={nominalRp <= 0 || !keterangan.trim()}>Simpan Pengeluaran</PrimaryButton>
    </form>
  );
}

/* ============================================================
   TRANSFER
   ============================================================ */

function TransferPage({ balances, onSubmitCR, onSubmitCadangan }) {
  const [tab, setTab] = useState("cr");
  return (
    <div className="space-y-4 pb-4">
      <div className="flex gap-2 rounded-xl bg-stone-100 dark:bg-stone-800 p-1">
        {[{ k: "cr", label: "Cash ↔ Rekening" }, { k: "cadangan", label: "Antar Cadangan" }].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.k ? "bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-sm" : "text-stone-500"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "cr" ? <TransferCRForm balances={balances} onSubmit={onSubmitCR} /> : <TransferCadanganForm balances={balances} onSubmit={onSubmitCadangan} />}
    </div>
  );
}

function TransferCRForm({ balances, onSubmit }) {
  const [tanggal, setTanggal] = useState(todayISO());
  const [arah, setArah] = useState("cash_ke_rekening");
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const nominalRp = nominal * 1000;

  const submit = (e) => {
    e.preventDefault();
    if (nominalRp <= 0) return;
    onSubmit({ tanggal, arah, nominal: nominalRp, keterangan });
    setNominal(0); setKeterangan("");
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <div className="space-y-4">
          <TanggalInput value={tanggal} onChange={setTanggal} />
          <SelectInput label="Arah Transfer" value={arah} onChange={setArah} options={[
            { value: "cash_ke_rekening", label: `Cash → Rekening (Cash: ${formatRupiah(balances.cash)})` },
            { value: "rekening_ke_cash", label: `Rekening → Cash (Rekening: ${formatRupiah(balances.rekening)})` },
          ]} />
          <RibuanInput label="Nominal" value={nominal} onChange={setNominal} />
          <TextInput label="Keterangan" value={keterangan} onChange={setKeterangan} placeholder="Opsional" />
        </div>
      </Card>
      <p className="text-xs text-stone-400 px-1">Transfer ini tidak mengubah Total Uang Nyata.</p>
      <PrimaryButton disabled={nominalRp <= 0}>Simpan Transfer</PrimaryButton>
    </form>
  );
}

function TransferCadanganForm({ balances, onSubmit }) {
  const [tanggal, setTanggal] = useState(todayISO());
  const [dari, setDari] = useState("angsuran");
  const [ke, setKe] = useState("simpanan");
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const nominalRp = nominal * 1000;
  const sama = dari === ke;

  const submit = (e) => {
    e.preventDefault();
    if (nominalRp <= 0 || sama) return;
    onSubmit({ tanggal, dari, ke, nominal: nominalRp, keterangan });
    setNominal(0); setKeterangan("");
  };

  const opts = KATEGORI_DANA.map((k) => ({ value: k.key, label: `${k.label} (${formatRupiah(balances[k.key])})` }));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <div className="space-y-4">
          <TanggalInput value={tanggal} onChange={setTanggal} />
          <SelectInput label="Dari Kategori" value={dari} onChange={setDari} options={opts} />
          <SelectInput label="Ke Kategori" value={ke} onChange={setKe} options={opts} />
          {sama && <p className="text-xs text-red-600">Kategori asal dan tujuan tidak boleh sama.</p>}
          <RibuanInput label="Nominal" value={nominal} onChange={setNominal} />
          <TextInput label="Keterangan" value={keterangan} onChange={setKeterangan} placeholder="Opsional" />
        </div>
      </Card>
      <PrimaryButton disabled={nominalRp <= 0 || sama}>Simpan Transfer</PrimaryButton>
    </form>
  );
}

/* ============================================================
   PENYESUAIAN SALDO
   ============================================================ */

function PenyesuaianPage({ balances, onSubmit }) {
  const [tanggal, setTanggal] = useState(todayISO());
  const [cashReal, setCashReal] = useState(Math.round(balances.cash / 1000));
  const [rekeningReal, setRekeningReal] = useState(Math.round(balances.rekening / 1000));
  const [kategoriPenyerap, setKategoriPenyerap] = useState("bebas");
  const [keterangan, setKeterangan] = useState("");

  const cashRealRp = cashReal * 1000;
  const rekeningRealRp = rekeningReal * 1000;
  const selisih = (cashRealRp + rekeningRealRp) - (balances.cash + balances.rekening);

  const submit = (e) => {
    e.preventDefault();
    if (selisih === 0) return;
    onSubmit({ tanggal, cashReal: cashRealRp, rekeningReal: rekeningRealRp, kategoriPenyerap, keterangan });
    setKeterangan("");
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card>
        <SectionTitle icon={SlidersHorizontal}>Penyesuaian Saldo</SectionTitle>
        <p className="text-xs text-stone-400 mb-3">Masukkan saldo riil hasil hitung fisik. Sistem akan menghitung selisih dan menyesuaikan dana agar tetap balanced.</p>
        <div className="space-y-4">
          <TanggalInput value={tanggal} onChange={setTanggal} />
          <RibuanInput label={`Saldo Cash Riil (tercatat: ${formatRupiah(balances.cash)})`} value={cashReal} onChange={setCashReal} />
          <RibuanInput label={`Saldo Rekening Riil (tercatat: ${formatRupiah(balances.rekening)})`} value={rekeningReal} onChange={setRekeningReal} />
          <SelectInput label="Selisih disesuaikan ke kategori" value={kategoriPenyerap} onChange={setKategoriPenyerap}
            options={KATEGORI_DANA.map((k) => ({ value: k.key, label: k.label }))} />
          <TextInput label="Keterangan" value={keterangan} onChange={setKeterangan} placeholder="Contoh: Selisih hasil hitung fisik kas" textarea />
        </div>
      </Card>
      <Card className={selisih === 0 ? "" : selisih > 0 ? "!bg-emerald-50 dark:!bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" : "!bg-red-50 dark:!bg-red-950/30 border-red-200 dark:border-red-900"}>
        <div className="flex justify-between items-center text-sm">
          <span className="text-stone-500">Selisih terdeteksi</span>
          <MoneyText value={selisih} className="text-lg font-bold" />
        </div>
      </Card>
      <PrimaryButton disabled={selisih === 0}>Simpan Penyesuaian</PrimaryButton>
    </form>
  );
}

/* ============================================================
   RIWAYAT
   ============================================================ */

const JENIS_LABEL = {
  pemasukan: "Pemasukan", pengeluaran: "Pengeluaran", transfer: "Transfer Cash/Rekening",
  transfer_cadangan: "Transfer Antar Cadangan", penyesuaian: "Penyesuaian Saldo", koreksi: "Koreksi",
};
const JENIS_ICON = {
  pemasukan: ArrowDownCircle, pengeluaran: ArrowUpCircle, transfer: ArrowLeftRight,
  transfer_cadangan: ArrowLeftRight, penyesuaian: SlidersHorizontal, koreksi: ClipboardEdit,
};

function transaksiNominalTampil(t) {
  if (t.jenis === "pemasukan") return t.nominalCash + t.nominalRekening;
  if (t.jenis === "pengeluaran" || t.jenis === "transfer" || t.jenis === "transfer_cadangan") return t.nominal;
  if (t.jenis === "penyesuaian") return t.selisih;
  if (t.jenis === "koreksi") return t.delta;
  return 0;
}

function TxDetail({ t }) {
  if (t.jenis === "pemasukan") return <>Cash {formatRupiah(t.nominalCash)} · Rekening {formatRupiah(t.nominalRekening)}</>;
  if (t.jenis === "pengeluaran") return <>{t.metode === "cash" ? "Cash" : "Rekening"} · {KATEGORI_MAP[t.kategori]?.label}</>;
  if (t.jenis === "transfer") return <>{t.arah === "cash_ke_rekening" ? "Cash → Rekening" : "Rekening → Cash"}</>;
  if (t.jenis === "transfer_cadangan") return <>{KATEGORI_MAP[t.dari]?.label} → {KATEGORI_MAP[t.ke]?.label}</>;
  if (t.jenis === "penyesuaian") return <>Disesuaikan ke {KATEGORI_MAP[t.kategoriPenyerap]?.label}</>;
  if (t.jenis === "koreksi") return <>Field: {t.field}</>;
  return null;
}

function RiwayatPage({ transactions, onExportExcel, onOpenKoreksi }) {
  const [q, setQ] = useState("");
  const [jenisFilter, setJenisFilter] = useState("semua");
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");

  const filtered = useMemo(() => {
    return [...transactions]
      .filter((t) => (jenisFilter === "semua" ? true : t.jenis === jenisFilter))
      .filter((t) => (dari ? t.tanggal >= dari : true))
      .filter((t) => (sampai ? t.tanggal <= sampai : true))
      .filter((t) => {
        if (!q.trim()) return true;
        const hay = `${t.keterangan || ""} ${t.catatan || ""} ${JENIS_LABEL[t.jenis]}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      })
      .sort((a, b) => (b.tanggal + b.jam).localeCompare(a.tanggal + a.jam));
  }, [transactions, q, jenisFilter, dari, sampai]);

  return (
    <div className="space-y-4 pb-4">
      <Card>
        <SectionTitle icon={History}>Riwayat Transaksi</SectionTitle>
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari keterangan..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={dari} onChange={(e) => setDari(e.target.value)} className="px-2 py-2 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm" />
            <input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} className="px-2 py-2 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm" />
          </div>
          <select value={jenisFilter} onChange={(e) => setJenisFilter(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm">
            <option value="semua">Semua Jenis</option>
            {Object.entries(JENIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Card>

      <div className="flex gap-2">
        <button onClick={() => onExportExcel(filtered)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-stone-200 dark:border-stone-700 text-sm font-semibold text-stone-600 dark:text-stone-300">
          <Download size={14} /> Ekspor Excel
        </button>
        <button onClick={onOpenKoreksi} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-emerald-200 dark:border-emerald-900 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <ClipboardEdit size={14} /> Buat Koreksi
        </button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-center text-sm text-stone-400 py-8">Tidak ada transaksi.</p>}
        {filtered.map((t) => {
          const Icon = JENIS_ICON[t.jenis];
          const nominal = transaksiNominalTampil(t);
          return (
            <Card key={t.id} className="!p-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-emerald-700 dark:text-emerald-400 shrink-0"><Icon size={16} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-semibold text-sm text-stone-800 dark:text-stone-100">{JENIS_LABEL[t.jenis]}</span>
                    <MoneyText value={nominal} className="font-bold text-sm shrink-0" />
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">{formatTanggalSingkat(t.tanggal)} · {t.jam}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1"><TxDetail t={t} /></p>
                  {t.keterangan && <p className="text-xs text-stone-400 italic mt-0.5">"{t.keterangan}"</p>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function KoreksiModal({ open, onClose, balances, onSubmit }) {
  const [tanggal, setTanggal] = useState(todayISO());
  const [field, setField] = useState("cash");
  const [nominal, setNominal] = useState(0);
  const [arah, setArah] = useState("tambah");
  const [keterangan, setKeterangan] = useState("");
  if (!open) return null;
  const delta = (arah === "tambah" ? 1 : -1) * nominal * 1000;

  const submit = (e) => {
    e.preventDefault();
    if (nominal <= 0 || !keterangan.trim()) return;
    onSubmit({ tanggal, field, delta, keterangan });
    setNominal(0); setKeterangan("");
    onClose();
  };

  const fieldOpts = [
    { value: "cash", label: "Cash" }, { value: "rekening", label: "Rekening" },
    ...KATEGORI_DANA.map((k) => ({ value: k.key, label: k.label })),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-stone-900 rounded-2xl p-5 w-full max-w-sm border-2 border-stone-200 dark:border-stone-700 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-lg text-stone-800 dark:text-stone-100">Transaksi Koreksi</h3>
          <button type="button" onClick={onClose}><X size={20} className="text-stone-400" /></button>
        </div>
        <p className="text-xs text-stone-400">Riwayat tidak dapat diedit/dihapus. Koreksi dicatat sebagai transaksi baru agar jejak audit tetap utuh.</p>
        <TanggalInput value={tanggal} onChange={setTanggal} />
        <SelectInput label="Field yang dikoreksi" value={field} onChange={setField} options={fieldOpts} />
        <SelectInput label="Arah" value={arah} onChange={setArah} options={[{ value: "tambah", label: "Tambah (+)" }, { value: "kurang", label: "Kurangi (-)" }]} />
        <RibuanInput label="Nominal Koreksi" value={nominal} onChange={setNominal} />
        <TextInput label="Alasan Koreksi" value={keterangan} onChange={setKeterangan} required placeholder="Contoh: Salah input pengeluaran tgl 10 Agustus" textarea />
        <PrimaryButton disabled={nominal <= 0 || !keterangan.trim()}>Simpan Koreksi</PrimaryButton>
      </form>
    </div>
  );
}

/* ============================================================
   PENGATURAN
   ============================================================ */

function PengaturanPage({ settings, onSave }) {
  const [angsuran, setAngsuran] = useState(Math.round(settings.angsuranPerHari / 1000));
  const [gaji, setGaji] = useState(Math.round(settings.gajiPerHari / 1000));
  const [mulaiGaji, setMulaiGaji] = useState(settings.gajiMulaiTanggal);

  const submit = (e) => {
    e.preventDefault();
    onSave({ angsuranPerHari: angsuran * 1000, gajiPerHari: gaji * 1000, gajiMulaiTanggal: mulaiGaji });
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card>
        <SectionTitle icon={Settings}>Aturan Pencadangan</SectionTitle>
        <div className="space-y-4">
          <RibuanInput label="Cadangan Angsuran per Hari" value={angsuran} onChange={setAngsuran} />
          <RibuanInput label="Cadangan Gaji per Hari" value={gaji} onChange={setGaji} />
          <TanggalInput label="Tanggal Mulai Cadangan Gaji" value={mulaiGaji} onChange={setMulaiGaji} />
          <p className="text-xs text-stone-400">Sebelum tanggal ini, Cadangan Gaji otomatis bernilai nol saat pemasukan dicatat.</p>
        </div>
      </Card>
      <Card className="!bg-stone-50 dark:!bg-stone-800/50">
        <p className="text-xs text-stone-500 dark:text-stone-400">Sisa uang setelah Cadangan Angsuran dan Cadangan Gaji akan otomatis dibagi 50% ke Cadangan Simpanan dan 50% ke Dana Bebas setiap kali Pemasukan Harian disimpan. Jika salah satunya minus, alokasi berikutnya akan menutup minus itu lebih dulu.</p>
      </Card>
      <PrimaryButton>Simpan Pengaturan</PrimaryButton>
    </form>
  );
}

/* ============================================================
   LAPORAN
   ============================================================ */

function withinRange(t, dari, sampai) {
  return t.tanggal >= dari && t.tanggal <= sampai;
}

function LaporanPage({ transactions, onExportExcel }) {
  const [periode, setPeriode] = useState("harian");
  const [tanggal, setTanggal] = useState(todayISO());

  const { dari, sampai, label } = useMemo(() => {
    const d = new Date(tanggal + "T00:00:00");
    if (periode === "harian") return { dari: tanggal, sampai: tanggal, label: formatTanggalIndo(tanggal) };
    if (periode === "mingguan") {
      const day = d.getDay();
      const monday = new Date(d); monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      return { dari: iso(monday), sampai: iso(sunday), label: `${formatTanggalSingkat(iso(monday))} – ${formatTanggalSingkat(iso(sunday))}` };
    }
    const first = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    const lastDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const last = `${lastDate.getFullYear()}-${pad(lastDate.getMonth() + 1)}-${pad(lastDate.getDate())}`;
    return { dari: first, sampai: last, label: d.toLocaleDateString("id-ID", { month: "long", year: "numeric" }) };
  }, [periode, tanggal]);

  const filtered = useMemo(() => transactions.filter((t) => withinRange(t, dari, sampai)), [transactions, dari, sampai]);

  const totalPemasukan = filtered.filter((t) => t.jenis === "pemasukan").reduce((s, t) => s + t.nominalCash + t.nominalRekening, 0);
  const totalPengeluaran = filtered.filter((t) => t.jenis === "pengeluaran").reduce((s, t) => s + t.nominal, 0);

  const barData = useMemo(() => {
    const byDate = {};
    filtered.forEach((t) => {
      byDate[t.tanggal] = byDate[t.tanggal] || { tanggal: formatTanggalSingkat(t.tanggal), Pemasukan: 0, Pengeluaran: 0 };
      if (t.jenis === "pemasukan") byDate[t.tanggal].Pemasukan += t.nominalCash + t.nominalRekening;
      if (t.jenis === "pengeluaran") byDate[t.tanggal].Pengeluaran += t.nominal;
    });
    return Object.values(byDate).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  }, [filtered]);

  const cadanganTrend = useMemo(() => {
    const byDate = {};
    [...transactions].filter((t) => t.tanggal <= sampai).sort((a, b) => (a.tanggal + a.jam).localeCompare(b.tanggal + b.jam))
      .forEach((t) => { byDate[t.tanggal] = t.saldoSetelah; });
    return Object.entries(byDate).filter(([tgl]) => tgl >= dari).map(([tgl, s]) => ({
      tanggal: formatTanggalSingkat(tgl), Angsuran: s.angsuran, Gaji: s.gaji, Simpanan: s.simpanan, Bebas: s.bebas,
    }));
  }, [transactions, dari, sampai]);

  return (
    <div className="space-y-4 pb-4 print:space-y-2">
      <Card className="print:hidden">
        <SectionTitle icon={FileBarChart}>Laporan</SectionTitle>
        <div className="flex gap-2 rounded-xl bg-stone-100 dark:bg-stone-800 p-1 mb-3">
          {[{ k: "harian", label: "Harian" }, { k: "mingguan", label: "Mingguan" }, { k: "bulanan", label: "Bulanan" }].map((t) => (
            <button key={t.k} onClick={() => setPeriode(t.k)} type="button"
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${periode === t.k ? "bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-sm" : "text-stone-500"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm" />
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-500">{label}</p>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => onExportExcel(filtered)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-stone-200 dark:border-stone-700 text-xs font-semibold text-stone-600 dark:text-stone-300"><Download size={12} />Excel</button>
          <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-stone-200 dark:border-stone-700 text-xs font-semibold text-stone-600 dark:text-stone-300"><Printer size={12} />Cetak/PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="!bg-emerald-50 dark:!bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase mb-1">Total Pemasukan</p>
          <p className="font-mono font-bold text-lg">{formatRupiah(totalPemasukan)}</p>
        </Card>
        <Card className="!bg-red-50 dark:!bg-red-950/30 border-red-200 dark:border-red-900">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase mb-1">Total Pengeluaran</p>
          <p className="font-mono font-bold text-lg">{formatRupiah(totalPengeluaran)}</p>
        </Card>
      </div>

      <Card>
        <SectionTitle>Pemasukan vs Pengeluaran</SectionTitle>
        {barData.length === 0 ? <div className="h-48 flex items-center justify-center text-sm text-stone-400">Tidak ada data pada periode ini</div> : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="tanggal" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (v / 1000).toLocaleString("id-ID")} width={45} />
                <Tooltip formatter={(v) => formatRupiah(v)} />
                <Legend />
                <Bar dataKey="Pemasukan" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Pengeluaran" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Perkembangan Cadangan</SectionTitle>
        {cadanganTrend.length === 0 ? <div className="h-48 flex items-center justify-center text-sm text-stone-400">Tidak ada data pada periode ini</div> : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={cadanganTrend}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="tanggal" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (v / 1000).toLocaleString("id-ID")} width={45} />
                <Tooltip formatter={(v) => formatRupiah(v)} />
                <Legend />
                <Line type="monotone" dataKey="Angsuran" stroke="#0f766e" dot={false} />
                <Line type="monotone" dataKey="Gaji" stroke="#0e7490" dot={false} />
                <Line type="monotone" dataKey="Simpanan" stroke="#15803d" dot={false} />
                <Line type="monotone" dataKey="Bebas" stroke="#a16207" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   BACKUP & RESTORE
   ============================================================ */

function BackupPage({ state, onRestore, onReset, onExportExcelAll, email, onLogout }) {
  const fileRef = useRef(null);
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const doExportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `backup-kas-umkm-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const pickFile = () => fileRef.current?.click();
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.transactions || !parsed.balances || !parsed.settings) throw new Error("format tidak valid");
        setConfirmRestore(parsed);
      } catch (err) {
        setConfirmRestore({ error: true });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4 pb-4">
      <Card>
        <SectionTitle icon={ShieldCheck}>Akun</SectionTitle>
        <p className="text-sm text-stone-600 dark:text-stone-300 mb-3">Masuk sebagai <span className="font-semibold">{email}</span></p>
        <p className="text-xs text-stone-400 mb-3">Data disimpan di server dan otomatis sinkron di semua perangkat yang login dengan akun ini.</p>
        <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-stone-200 dark:border-stone-700 font-semibold text-stone-600 dark:text-stone-300"><LogOut size={16} />Keluar</button>
      </Card>

      <Card>
        <SectionTitle icon={DatabaseBackup}>Backup Data</SectionTitle>
        <p className="text-xs text-stone-400 mb-3">Unduh seluruh transaksi, saldo, dan pengaturan sebagai satu file cadangan (.json).</p>
        <button onClick={doExportJSON} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-700 text-white font-bold"><Download size={16} />Unduh Backup (.json)</button>
      </Card>

      <Card>
        <SectionTitle icon={Upload}>Restore Data</SectionTitle>
        <p className="text-xs text-stone-400 mb-3">Memulihkan data dari file backup akan menggantikan seluruh data yang tersimpan saat ini.</p>
        <input ref={fileRef} type="file" accept="application/json" onChange={handleFile} className="hidden" />
        <button onClick={pickFile} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 font-bold text-stone-600 dark:text-stone-300"><Upload size={16} />Pilih File Backup</button>
      </Card>

      <Card>
        <SectionTitle icon={FileBarChart}>Ekspor Seluruh Riwayat</SectionTitle>
        <button onClick={onExportExcelAll} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 font-bold text-stone-600 dark:text-stone-300"><Download size={16} />Ekspor ke Excel</button>
      </Card>

      <Card className="border-red-200 dark:border-red-900">
        <SectionTitle icon={Trash2}>Reset Data</SectionTitle>
        <p className="text-xs text-stone-400 mb-3">Menghapus seluruh transaksi dan mengembalikan saldo ke nol. Tindakan ini tidak dapat dibatalkan — sebaiknya backup terlebih dahulu.</p>
        <button onClick={() => setConfirmReset(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 text-white font-bold"><Trash2 size={16} />Reset Semua Data</button>
      </Card>

      <ConfirmDialog
        open={!!confirmRestore}
        danger
        title={confirmRestore?.error ? "File Tidak Valid" : "Pulihkan Data?"}
        body={confirmRestore?.error ? "File yang dipilih bukan file backup yang valid." : "Seluruh data saat ini akan digantikan dengan isi file backup. Lanjutkan?"}
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => { if (!confirmRestore?.error) onRestore(confirmRestore); setConfirmRestore(null); }}
      />
      <ConfirmDialog
        open={confirmReset}
        danger
        title="Reset Semua Data?"
        body="Seluruh transaksi dan saldo akan dihapus permanen dari perangkat ini."
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => { onReset(); setConfirmReset(false); }}
      />
    </div>
  );
}

/* ============================================================
   NAVIGASI
   ============================================================ */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "pemasukan", label: "Pemasukan", icon: ArrowDownCircle },
  { key: "pengeluaran", label: "Pengeluaran", icon: ArrowUpCircle },
  { key: "transfer", label: "Transfer", icon: ArrowLeftRight },
  { key: "penyesuaian", label: "Penyesuaian", icon: SlidersHorizontal },
  { key: "riwayat", label: "Riwayat", icon: History },
  { key: "pengaturan", label: "Pengaturan", icon: Settings },
  { key: "laporan", label: "Laporan", icon: FileBarChart },
  { key: "backup", label: "Backup", icon: DatabaseBackup },
];
const BOTTOM_NAV = ["dashboard", "pemasukan", "pengeluaran", "riwayat"];

/* ============================================================
   ROOT APP
   ============================================================ */

export default function App({ uid, email, onLogout }) {
  const [loaded, setLoaded] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState(defaultSettings());
  const [balances, setBalances] = useState(defaultBalances());
  const [page, setPage] = useState("dashboard");
  const [dark, setDark] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [koreksiOpen, setKoreksiOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [syncError, setSyncError] = useState(false);
  const lastSyncedRef = useRef(null); // JSON string terakhir yang diketahui sama dengan Firestore
  const toastTimer = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Muat & sinkron data real-time dari Firestore (dokumen milik user yang login)
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, FIRESTORE_COLLECTION, uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setSyncError(false);
        if (snap.exists()) {
          const data = snap.data();
          const json = JSON.stringify({
            transactions: data.transactions || [],
            settings: data.settings || {},
            balances: data.balances || {},
          });
          // Hanya update state jika datanya benar-benar berbeda dari yang terakhir
          // kita kirim/terima sendiri -> mencegah loop simpan-terima tak berujung.
          if (json !== lastSyncedRef.current) {
            setTransactions(data.transactions || []);
            setSettings({ ...defaultSettings(), ...(data.settings || {}) });
            setBalances({ ...defaultBalances(), ...(data.balances || {}) });
            lastSyncedRef.current = json;
          }
        } else {
          // Dokumen belum ada (user baru) -> buat dengan data kosong
          const empty = { transactions: [], settings: defaultSettings(), balances: defaultBalances() };
          lastSyncedRef.current = JSON.stringify(empty);
          setDoc(ref, { ...empty, updatedAt: serverTimestamp() }).catch(() => setSyncError(true));
        }
        setLoaded(true);
      },
      () => {
        setSyncError(true);
        setLoaded(true);
      }
    );
    return unsub;
  }, [uid]);

  // Simpan ke Firestore setiap kali ada perubahan lokal (skip jika tidak ada perubahan nyata)
  useEffect(() => {
    if (!loaded || !uid) return;
    const json = JSON.stringify({ transactions, settings, balances });
    if (json === lastSyncedRef.current) return;
    lastSyncedRef.current = json;
    const ref = doc(db, FIRESTORE_COLLECTION, uid);
    setDoc(ref, { transactions, settings, balances, updatedAt: serverTimestamp() }).catch(() => {
      setSyncError(true);
      showToast("Gagal menyimpan ke server, akan dicoba ulang otomatis", "error");
    });
  }, [transactions, settings, balances, loaded, uid, showToast]);

  const addTx = (partial, newBalances) => {
    const now = new Date();
    const tx = {
      id: uid(),
      jam: now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      saldoSetelah: { ...newBalances },
      ...partial,
    };
    setTransactions((prev) => [...prev, tx]);
    setBalances(newBalances);
  };

  const handlePemasukan = (data) => {
    const { balances: nb, meta } = hitungPemasukan(balances, settings, data);
    addTx({ jenis: "pemasukan", tanggal: data.tanggal, nominalCash: data.nominalCash, nominalRekening: data.nominalRekening, keterangan: data.catatan, meta }, nb);
    showToast("Pemasukan tersimpan & pencadangan otomatis diterapkan");
    setPage("dashboard");
  };
  const handlePengeluaran = (data) => {
    const nb = hitungPengeluaran(balances, data);
    addTx({ jenis: "pengeluaran", tanggal: data.tanggal, nominal: data.nominal, metode: data.metode, kategori: data.kategori, keterangan: data.keterangan }, nb);
    showToast("Pengeluaran tersimpan");
    setPage("dashboard");
  };
  const handleTransferCR = (data) => {
    const nb = hitungTransferCashRekening(balances, data);
    addTx({ jenis: "transfer", tanggal: data.tanggal, arah: data.arah, nominal: data.nominal, keterangan: data.keterangan }, nb);
    showToast("Transfer tersimpan");
    setPage("dashboard");
  };
  const handleTransferCadangan = (data) => {
    const nb = hitungTransferCadangan(balances, data);
    addTx({ jenis: "transfer_cadangan", tanggal: data.tanggal, dari: data.dari, ke: data.ke, nominal: data.nominal, keterangan: data.keterangan }, nb);
    showToast("Transfer antar cadangan tersimpan");
    setPage("dashboard");
  };
  const handlePenyesuaian = (data) => {
    const { balances: nb, selisih } = hitungPenyesuaian(balances, data);
    addTx({ jenis: "penyesuaian", tanggal: data.tanggal, cashReal: data.cashReal, rekeningReal: data.rekeningReal, kategoriPenyerap: data.kategoriPenyerap, selisih, keterangan: data.keterangan }, nb);
    showToast("Saldo berhasil disesuaikan");
    setPage("dashboard");
  };
  const handleKoreksi = (data) => {
    const nb = hitungKoreksi(balances, data);
    addTx({ jenis: "koreksi", tanggal: data.tanggal, field: data.field, delta: data.delta, keterangan: data.keterangan }, nb);
    showToast("Transaksi koreksi tersimpan");
  };
  const handleSaveSettings = (s) => {
    setSettings(s);
    showToast("Pengaturan pencadangan tersimpan");
  };

  const exportExcel = useCallback((list) => {
    try {
      const rows = [...list].sort((a, b) => (a.tanggal + a.jam).localeCompare(b.tanggal + b.jam)).map((t) => ({
        Tanggal: t.tanggal, Jam: t.jam, Jenis: JENIS_LABEL[t.jenis], Nominal: transaksiNominalTampil(t),
        Keterangan: t.keterangan || t.catatan || "",
        "Saldo Cash": t.saldoSetelah.cash, "Saldo Rekening": t.saldoSetelah.rekening,
        "Saldo Angsuran": t.saldoSetelah.angsuran, "Saldo Gaji": t.saldoSetelah.gaji,
        "Saldo Simpanan": t.saldoSetelah.simpanan, "Saldo Bebas": t.saldoSetelah.bebas,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Riwayat");
      XLSX.writeFile(wb, `riwayat-kas-umkm-${todayISO()}.xlsx`);
      showToast("Ekspor Excel berhasil");
    } catch (e) {
      showToast("Gagal ekspor Excel", "error");
    }
  }, [showToast]);

  const handleRestore = (data) => {
    setTransactions(data.transactions || []);
    setSettings({ ...defaultSettings(), ...(data.settings || {}) });
    setBalances({ ...defaultBalances(), ...(data.balances || {}) });
    showToast("Data berhasil dipulihkan");
    setPage("dashboard");
  };
  const handleReset = () => {
    setTransactions([]);
    setBalances(defaultBalances());
    showToast("Semua data telah direset");
    setPage("dashboard");
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="flex items-center gap-2 text-stone-400 text-sm"><RefreshCcw size={16} className="animate-spin" /> Memuat data...</div>
      </div>
    );
  }

  const balanced = isBalanced(balances);
  const currentNav = NAV_ITEMS.find((n) => n.key === page);

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-800 dark:text-stone-100 font-sans">
        <style>{`
          @media print {
            .print\\:hidden { display: none !important; }
            body { background: white; }
          }
        `}</style>

        {/* Topbar */}
        <header className="sticky top-0 z-40 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur border-b-2 border-stone-200 dark:border-stone-800 print:hidden">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => setMoreOpen(true)} className="md:hidden p-2 -ml-2 text-stone-500"><Menu size={20} /></button>
              <div className="p-1.5 rounded-lg bg-emerald-700 text-white shrink-0"><ShieldCheck size={16} /></div>
              <div className="min-w-0">
                <h1 className="font-black text-sm leading-tight truncate">Kas UMKM</h1>
                <p className="text-[10px] text-stone-400 truncate">{currentNav?.label}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {syncError && <span title="Gagal sinkron ke server"><WifiOff size={16} className="text-amber-500" /></span>}
              <StampBadge balanced={balanced} />
              <button onClick={() => setDark((d) => !d)} className="p-2 rounded-lg border-2 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300">
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button onClick={onLogout} title={email} className="p-2 rounded-lg border-2 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300">
                <LogOut size={16} />
              </button>
            </div>
          </div>
          {/* Desktop nav */}
          <nav className="hidden md:flex max-w-5xl mx-auto px-4 gap-1 pb-2 overflow-x-auto">
            {NAV_ITEMS.map((n) => (
              <button key={n.key} onClick={() => setPage(n.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${page === n.key ? "bg-emerald-700 text-white" : "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"}`}>
                <n.icon size={15} /> {n.label}
              </button>
            ))}
          </nav>
        </header>

        {/* Main */}
        <main className="max-w-5xl mx-auto px-4 py-4">
          {page === "dashboard" && <DashboardPage balances={balances} transactions={transactions} />}
          {page === "pemasukan" && <PemasukanPage balances={balances} settings={settings} onSubmit={handlePemasukan} />}
          {page === "pengeluaran" && <PengeluaranPage balances={balances} onSubmit={handlePengeluaran} />}
          {page === "transfer" && <TransferPage balances={balances} onSubmitCR={handleTransferCR} onSubmitCadangan={handleTransferCadangan} />}
          {page === "penyesuaian" && <PenyesuaianPage balances={balances} onSubmit={handlePenyesuaian} />}
          {page === "riwayat" && <RiwayatPage transactions={transactions} onExportExcel={exportExcel} onOpenKoreksi={() => setKoreksiOpen(true)} />}
          {page === "pengaturan" && <PengaturanPage settings={settings} onSave={handleSaveSettings} />}
          {page === "laporan" && <LaporanPage transactions={transactions} onExportExcel={exportExcel} />}
          {page === "backup" && <BackupPage state={{ transactions, settings, balances }} onRestore={handleRestore} onReset={handleReset} onExportExcelAll={() => exportExcel(transactions)} email={email} onLogout={onLogout} />}
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-stone-900 border-t-2 border-stone-200 dark:border-stone-800 flex print:hidden">
          {BOTTOM_NAV.map((key) => {
            const n = NAV_ITEMS.find((x) => x.key === key);
            const active = page === key;
            return (
              <button key={key} onClick={() => setPage(key)} className="flex-1 flex flex-col items-center gap-0.5 py-2.5">
                <n.icon size={20} className={active ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400"} />
                <span className={`text-[10px] font-semibold ${active ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400"}`}>{n.label}</span>
              </button>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className="flex-1 flex flex-col items-center gap-0.5 py-2.5">
            <Menu size={20} className="text-stone-400" />
            <span className="text-[10px] font-semibold text-stone-400">Lainnya</span>
          </button>
        </nav>
        <div className="h-16 md:hidden" />

        {/* More menu sheet (mobile) */}
        {moreOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:hidden" onClick={() => setMoreOpen(false)}>
            <div className="bg-white dark:bg-stone-900 rounded-t-2xl w-full p-4 pb-8" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-stone-800 dark:text-stone-100">Menu</h3>
                <button onClick={() => setMoreOpen(false)}><X size={20} className="text-stone-400" /></button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {NAV_ITEMS.map((n) => (
                  <button key={n.key} onClick={() => { setPage(n.key); setMoreOpen(false); }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 ${page === n.key ? "border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" : "border-stone-200 dark:border-stone-700 text-stone-500"}`}>
                    <n.icon size={20} />
                    <span className="text-[11px] font-semibold text-center leading-tight">{n.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <KoreksiModal open={koreksiOpen} onClose={() => setKoreksiOpen(false)} balances={balances} onSubmit={handleKoreksi} />
        <Toast toast={toast} />
      </div>
    </div>
  );
}
