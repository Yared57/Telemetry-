import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine
} from 'recharts';
import {
  Activity, Gauge, RefreshCw, Scale, Timer, Download,
  Trash2, Zap, AlertTriangle, CheckCircle2, Cpu
} from 'lucide-react';

const SOCKET_SERVER = 'http://localhost:5000';

// ── Physics constants (editable via UI) ──────────────────────────────
const DEFAULT_S   = 0.54;   // track distance (m)
const DEFAULT_MU  = 0.15;   // kinetic friction coefficient
const G           = 9.81;   // gravitational acceleration (m/s²)

// ── Small stateless display components ────────────────────────────────
function MetricRow({ label, value, unit, color = 'text-white', dim = false }) {
  return (
    <div className={`flex justify-between items-baseline border-b border-slate-700/40 pb-2 ${dim ? 'opacity-50' : ''}`}>
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`text-xl font-bold font-mono ${color}`}>
        {value !== null && value !== undefined && !isNaN(value) && value !== '' ? value : '—'}
        {value && unit ? <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span> : null}
      </span>
    </div>
  );
}

function StatusBadge({ ok, labels }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide border ${
      ok ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
         : 'bg-rose-950 text-rose-400 border-rose-900'
    }`}>
      <div className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
      {ok ? labels[0] : labels[1]}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────
export default function App() {
  // Socket
  const [socket, setSocket]         = useState(null);
  const [serverOnline, setServer]   = useState(false);
  const [arduinoOnline, setArduino] = useState(false);

  // Configurable physics params
  const [trackDist, setTrackDist]   = useState(DEFAULT_S);
  const [muK, setMuK]               = useState(DEFAULT_MU);

  // Mass state
  const [mass1, setMass1]   = useState(null);
  const [mass2, setMass2]   = useState(null);
  const [liveWeight, setLiveWeight] = useState(null);

  // Run results
  const [timeOfFlight, setTimeOfFlight]         = useState(null);
  const [accelExp, setAccelExp]                 = useState(null);
  const [accelTheo, setAccelTheo]               = useState(null);
  const [percentError, setPercentError]         = useState(null);
  const [isArmed, setIsArmed]                   = useState(false);

  // History of completed runs
  const [runHistory, setRunHistory] = useState([]);

  // Chart & logs
  const [chartData, setChartData]   = useState([]);
  const [systemLogs, setLogs]       = useState([]);
  const logEndRef = useRef(null);

  // ── Socket setup ───────────────────────────────────────────────────
  useEffect(() => {
    const s = io(SOCKET_SERVER, { reconnectionDelay: 2000 });
    setSocket(s);

    s.on('connect',    () => setServer(true));
    s.on('disconnect', () => { setServer(false); setArduino(false); });

    s.on('arduino-status', ({ connected }) => setArduino(connected));

    s.on('system-log', (log) => {
      setLogs(prev => [...prev.slice(-49), log]);

      const massMatch = log.match(/Final Mass (\d)\s*[:\-=]\s*([\d.]+)/i);
      if (massMatch) {
        const idx = parseInt(massMatch[1]);
        const val = parseFloat(massMatch[2]);
        if (idx === 1) setMass1(val);
        if (idx === 2) setMass2(val);
      }
    });

    s.on('hardware-error', (msg) => {
      setLogs(prev => [...prev.slice(-49), `⚠️ ${msg}`]);
    });

    s.on('telemetry', (data) => {
      const parts = data.split(',');
      if (parts.length >= 1 && !isNaN(parts[0])) {
        const w = parseFloat(parts[0]);
        setLiveWeight(w);
        setChartData(prev => [
          ...prev.slice(-79),
          { t: Date.now(), weight: w }
        ]);
      }
    });

    s.on('dynamic-run-captured', (delta_t_ms) => {
      const t = delta_t_ms / 1000.0;
      setTimeOfFlight(t);
      setIsArmed(false);
      const a = (2.0 * trackDist) / (t * t);
      setAccelExp(a);
    });

    return () => s.close();
  }, []);   // trackDist intentionally excluded — captured in history handler below

  // ── Theoretical acceleration ────────────────────────────────────────
  useEffect(() => {
    if (mass1 > 0 && mass2 > 0) {
      const m1 = mass1 / 1000;
      const m2 = mass2 / 1000;
      const total = m1 + m2;
      const fNet  = Math.abs(m1 - m2) * G;
      const fFric = muK * total * G;
      setAccelTheo(Math.max(0, (fNet - fFric) / total));
    }
  }, [mass1, mass2, muK]);

  // ── Percent error & run history ─────────────────────────────────────
  useEffect(() => {
    if (accelExp > 0 && accelTheo > 0) {
      const err = Math.abs(accelExp - accelTheo) / accelTheo * 100;
      setPercentError(err);

      setRunHistory(prev => [
        {
          id: prev.length + 1,
          tof: (2.0 * trackDist / (accelExp)).toFixed ? accelExp : accelExp,
          a_exp: accelExp,
          a_theo: accelTheo,
          error: err,
          m1: mass1,
          m2: mass2,
          ts: new Date().toLocaleTimeString()
        },
        ...prev.slice(0, 19)
      ]);
    }
  }, [accelExp, accelTheo]);

  // ── Auto-scroll log ─────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [systemLogs]);

  // ── Commands ────────────────────────────────────────────────────────
  const send = (cmd) => {
    if (!socket) return;
    socket.emit('send-command', cmd);
    if (cmd === 'R' || cmd === 'r') {
      setIsArmed(true);
      setAccelExp(null);
      setTimeOfFlight(null);
      setPercentError(null);
    }
  };

  const clearData = () => {
    setMass1(null); setMass2(null);
    setTimeOfFlight(null); setAccelExp(null); setAccelTheo(null);
    setPercentError(null); setChartData([]); setLogs([]);
    setLiveWeight(null); setIsArmed(false);
  };

  // ── CSV export ──────────────────────────────────────────────────────
  const exportCSV = () => {
    const header = 'Run,Time,M1 (g),M2 (g),a_exp (m/s²),a_theo (m/s²),Error (%)';
    const rows = runHistory.map(r =>
      `${r.id},${r.ts},${r.m1 ?? ''},${r.m2 ?? ''},${r.a_exp?.toFixed(4) ?? ''},${r.a_theo?.toFixed(4) ?? ''},${r.error?.toFixed(2) ?? ''}`
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `atwood_run_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ──────────────────────────────────────────────────────────
  const errorColor = percentError !== null
    ? (percentError < 3 ? 'text-emerald-400' : percentError < 8 ? 'text-amber-400' : 'text-rose-400')
    : 'text-white';

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100 p-4 md:p-6 font-mono">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap justify-between items-start gap-3 border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Activity size={20} className="text-cyan-500" />
            Atwood Machine · Instrumentation Panel
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track distance: {trackDist} m &nbsp;·&nbsp; μ_k: {muK} &nbsp;·&nbsp; g: {G} m/s²
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge ok={serverOnline}  labels={['SERVER ONLINE',  'SERVER OFFLINE']} />
          <StatusBadge ok={arduinoOnline} labels={['ARDUINO LINKED', 'ARDUINO OFFLINE']} />
        </div>
      </header>

      {/* ── Main Grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left Column ──────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Control Panel */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2 uppercase tracking-widest">
              <Gauge size={14} className="text-cyan-500" /> Control Console
            </h2>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => send('1')}
                className="w-full py-3 px-4 bg-blue-700 hover:bg-blue-600 rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2 text-sm font-semibold shadow"
              >
                <Scale size={15} /> Record Mass 1 (30 s)
              </button>
              <button
                onClick={() => send('2')}
                className="w-full py-3 px-4 bg-violet-700 hover:bg-violet-600 rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2 text-sm font-semibold shadow"
              >
                <RefreshCw size={15} /> Record Mass 2 Differential (30 s)
              </button>
              <button
                onClick={() => send('R')}
                className={`w-full py-3 px-4 rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2 text-sm font-bold border shadow ${
                  isArmed
                    ? 'bg-amber-950 border-amber-500 text-amber-300 animate-pulse'
                    : 'bg-cyan-700 hover:bg-cyan-600 border-cyan-600 text-white'
                }`}
              >
                <Timer size={15} />
                {isArmed ? '⚡ IR GATES ARMED · WAITING...' : 'Arm IR Timing Gates'}
              </button>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={clearData}
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-lg transition text-xs flex items-center justify-center gap-1.5 border border-slate-700"
                >
                  <Trash2 size={12} /> Clear All
                </button>
                <button
                  onClick={exportCSV}
                  disabled={runHistory.length === 0}
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-lg transition text-xs flex items-center justify-center gap-1.5 border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Download size={12} /> Export CSV
                </button>
              </div>
            </div>
          </section>

          {/* Physics Config */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2 uppercase tracking-widest">
              <Cpu size={14} className="text-violet-400" /> Physics Parameters
            </h2>
            <div className="space-y-3 text-sm">
              <label className="flex justify-between items-center gap-3">
                <span className="text-slate-400 shrink-0">Track distance (m)</span>
                <input
                  type="number" step="0.01" min="0.01"
                  value={trackDist}
                  onChange={e => setTrackDist(parseFloat(e.target.value) || DEFAULT_S)}
                  className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-white focus:outline-none focus:border-cyan-600"
                />
              </label>
              <label className="flex justify-between items-center gap-3">
                <span className="text-slate-400 shrink-0">Friction coeff. (μ_k)</span>
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={muK}
                  onChange={e => setMuK(parseFloat(e.target.value) ?? DEFAULT_MU)}
                  className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-white focus:outline-none focus:border-cyan-600"
                />
              </label>
            </div>
          </section>

          {/* Microcontroller Log */}
          <section className="bg-black border border-slate-800 rounded-xl p-4 shadow-inner flex flex-col h-60">
            <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest block mb-2 border-b border-slate-900 pb-1">
              μC Stream Log
            </span>
            <div className="font-mono text-xs text-emerald-400 overflow-y-auto flex-1 space-y-0.5 pr-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
              {systemLogs.length === 0
                ? <span className="text-slate-700">Waiting for microcontroller output...</span>
                : systemLogs.map((log, i) => (
                    <div key={i} className="whitespace-pre-wrap leading-relaxed">{log}</div>
                  ))
              }
              <div ref={logEndRef} />
            </div>
          </section>
        </div>

        {/* ── Middle + Right Columns ────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Mass + Kinematics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Mass Profile */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-4">
                Static Mass Profile
              </h3>
              <div className="space-y-3">
                <MetricRow label="Mass 1 (M1)" value={mass1?.toFixed(2)} unit="g" color="text-blue-400" />
                <MetricRow label="Mass 2 (M2)" value={mass2?.toFixed(2)} unit="g" color="text-violet-400" />
                <MetricRow
                  label="Total System Mass"
                  value={mass1 && mass2 ? ((mass1 + mass2) / 1000).toFixed(4) : null}
                  unit="kg"
                  color="text-slate-300"
                  dim={!mass1 || !mass2}
                />
              </div>
              {mass1 && mass2 && (
                <div className="mt-4 bg-slate-800/60 rounded-lg p-3 border border-slate-700/30">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Δm / Σm</span>
                    <span className="font-mono text-slate-300">
                      {(Math.abs(mass1 - mass2) / (mass1 + mass2) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* Kinematics Results */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-4">
                Kinematics Validation
              </h3>
              <div className="space-y-3">
                <MetricRow label="Time of Flight (Δt)" value={timeOfFlight?.toFixed(4)} unit="s"     color="text-cyan-400"   />
                <MetricRow label="Experimental a_exp"  value={accelExp?.toFixed(4)}    unit="m/s²"  color="text-white"       />
                <MetricRow label="Theoretical  a_theo" value={accelTheo?.toFixed(4)}   unit="m/s²"  color="text-amber-400"   />
              </div>

              {percentError !== null ? (
                <div className={`mt-4 rounded-lg p-3 text-center border font-bold text-sm flex items-center justify-center gap-2 ${
                  percentError < 3 ? 'bg-emerald-950/50 border-emerald-800 text-emerald-400'
                  : percentError < 8 ? 'bg-amber-950/50 border-amber-800 text-amber-400'
                  : 'bg-rose-950/50 border-rose-800 text-rose-400'
                }`}>
                  {percentError < 3
                    ? <CheckCircle2 size={14} />
                    : <AlertTriangle size={14} />
                  }
                  Error: {percentError.toFixed(2)}%
                  <span className="font-normal text-xs opacity-70">
                    {percentError < 3 ? '· Excellent' : percentError < 8 ? '· Acceptable' : '· Review setup'}
                  </span>
                </div>
              ) : (
                <div className="mt-4 rounded-lg p-3 text-center text-xs text-slate-600 border border-slate-800">
                  Run a test to compute error
                </div>
              )}
            </section>
          </div>

          {/* Live Load Cell Chart */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Zap size={14} className="text-cyan-400" />
                Live Load Cell
                <span className="text-[10px] font-normal text-slate-500 uppercase tracking-wide">
                  (streaming)
                </span>
              </h3>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Current Reading</span>
                <span className="text-2xl font-black font-mono text-cyan-400">
                  {liveWeight !== null ? liveWeight.toFixed(1) : '—'}
                  <span className="text-sm font-normal text-slate-400 ml-1">g</span>
                </span>
              </div>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="t" hide />
                  <YAxis stroke="#475569" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0d1117', borderColor: '#334155', color: '#f1f5f9', fontSize: 11 }}
                    formatter={(v) => [`${v.toFixed(2)} g`, 'Weight']}
                    labelFormatter={() => ''}
                  />
                  {mass1 && <ReferenceLine y={mass1} stroke="#3b82f6" strokeDasharray="4 3" label={{ value: 'M1', fill: '#3b82f6', fontSize: 10 }} />}
                  <Line type="monotone" dataKey="weight" stroke="#06b6d4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Run History Table */}
          {runHistory.length > 0 && (
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Run History ({runHistory.length})
                </h3>
                <button onClick={exportCSV} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 transition">
                  <Download size={11} /> CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-slate-600 border-b border-slate-800 text-left">
                      <th className="pb-2 pr-4">#</th>
                      <th className="pb-2 pr-4">Time</th>
                      <th className="pb-2 pr-4">M1 (g)</th>
                      <th className="pb-2 pr-4">M2 (g)</th>
                      <th className="pb-2 pr-4">a_exp</th>
                      <th className="pb-2 pr-4">a_theo</th>
                      <th className="pb-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runHistory.map((r) => (
                      <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                        <td className="py-1.5 pr-4 text-slate-600">{r.id}</td>
                        <td className="py-1.5 pr-4 text-slate-400">{r.ts}</td>
                        <td className="py-1.5 pr-4 text-blue-400">{r.m1?.toFixed(1) ?? '—'}</td>
                        <td className="py-1.5 pr-4 text-violet-400">{r.m2?.toFixed(1) ?? '—'}</td>
                        <td className="py-1.5 pr-4 text-white">{r.a_exp?.toFixed(4) ?? '—'}</td>
                        <td className="py-1.5 pr-4 text-amber-400">{r.a_theo?.toFixed(4) ?? '—'}</td>
                        <td className={`py-1.5 font-bold ${
                          r.error < 3 ? 'text-emerald-400' : r.error < 8 ? 'text-amber-400' : 'text-rose-400'
                        }`}>{r.error?.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
