import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Activity, Gauge, RefreshCw, Scale, Timer } from 'lucide-react';

const SOCKET_SERVER = 'http://localhost:5000';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [systemLogs, setSystemLogs] = useState([]);

  const [mass1, setMass1] = useState(0);
  const [mass2, setMass2] = useState(0);
  const [liveWeight, setLiveWeight] = useState(0);

  const [timeOfFlight, setTimeOfFlight] = useState(0);
  const [accelExperimental, setAccelExperimental] = useState(0);
  const [accelTheoretical, setAccelTheoretical] = useState(0);
  const [percentError, setPercentError] = useState(null);
  const [isTestArmed, setIsTestArmed] = useState(false);

  const [chartData, setChartData] = useState([]);
  const logEndRef = useRef(null);

  const S_DISTANCE = 0.54; 
  const G_ACCEL = 9.81;
  const MU_K = 0.15;

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER);
    setSocket(newSocket);

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));

    // Handle incoming terminal logging text from loop
    newSocket.on('system-log', (log) => {
      setSystemLogs((prev) => [...prev.slice(-30), log]); // Keep last 30 logs
      
      // Parse data directly from output strings if needed
      if (log.includes("Final Mass 1")) {
        const val = parseFloat(log.match(/[\d.]+/)[0]);
        setMass1(val);
      }
      if (log.includes("Final Mass 2")) {
        const val = parseFloat(log.match(/[\d.]+/)[0]);
        setMass2(val);
        calculateTheoreticalTarget(mass1, val);
      }
    });

    newSocket.on('telemetry', (data) => {

      if (data.startsWith("Sampling...")) {
        return; 
      }
      
      const parts = data.split(',');
      if (parts.length === 3 && !isNaN(parts[0])) {
        const currentW = parseFloat(parts[0]);
        setLiveWeight(currentW);
 
        setChartData((prev) => [
          ...prev.slice(-50), 
          { time: new Date().toLocaleTimeString(), weight: currentW }
        ]);
      }
    });

    newSocket.on('dynamic-run-captured', (delta_t_ms) => {
      const t_sec = delta_t_ms / 1000.0;
      setTimeOfFlight(t_sec);
      setIsTestArmed(false);

      const a_exp = (2.0 * S_DISTANCE) / (t_sec * t_sec);
      setAccelExperimental(a_exp);
    });

    return () => newSocket.close();
  }, [mass1]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [systemLogs]);

  const calculateTheoreticalTarget = (m1Grams, m2Grams) => {
    const m1 = m1Grams / 1000.0;
    const m2 = m2Grams / 1000.0;
    const totalMass = m1 + m2;
    if (totalMass === 0) return;

    const fNetIdeal = Math.abs(m1 - m2) * G_ACCEL;
    const normalForce = totalMass * G_ACCEL;
    const fK = MU_K * normalForce;
    
    const a_theo = Math.max(0, (fNetIdeal - fK) / totalMass);
    setAccelTheoretical(a_theo);
  };

  useEffect(() => {
    if (accelExperimental > 0 && accelTheoretical > 0) {
      const error = (Math.abs(accelExperimental - accelTheoretical) / accelTheoretical) * 100;
      setPercentError(error);
    }
  }, [accelExperimental, accelTheoretical]);

  const triggerCommand = (cmd) => {
    if (socket) {
      socket.emit('send-command', cmd);
      if (cmd === 'R' || cmd === 'r') {
        setIsTestArmed(true);
        setAccelExperimental(0);
        setTimeOfFlight(0);
        setPercentError(null);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">

      <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Activity className="text-emerald-500 animate-pulse" />
            Atwood Machine Instrumentation Panel
          </h1>
          <p className="text-sm text-slate-400">Mechanical Systems Engineering Lab (Target Zone: {S_DISTANCE}m)</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide border ${
          connected ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-rose-950 text-rose-400 border-rose-900'
        }`}>
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
          {connected ? 'SERVER ONLINE' : 'SERVER OFFLINE'}
        </div>
      </header>

      {/* Grid Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Command & Live Feed */}
        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Gauge className="text-blue-400" /> Control Console
            </h2>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => triggerCommand('1')}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 font-medium rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2 shadow"
              >
                <Scale size={18} /> Record Mass 1 (30s Window)
              </button>
              <button 
                onClick={() => triggerCommand('2')}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 font-medium rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2 shadow"
              >
                <RefreshCw size={18} /> Record Mass 2 Differential (30s)
              </button>
              <button 
                onClick={() => triggerCommand('R')}
                className={`w-full py-3 px-4 font-bold rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2 border shadow ${
                  isTestArmed 
                    ? 'bg-amber-950 border-amber-500 text-amber-400 animate-pulse' 
                    : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-700 text-white'
                }`}
              >
                <Timer size={18} /> {isTestArmed ? 'IR GATES ARMED & WAITING...' : 'Arm IR Timing Gates'}
              </button>
            </div>
          </div>

          {/* Terminal Console Log */}
          <div className="bg-black border border-slate-800 rounded-xl p-4 shadow-inner flex flex-col h-64">
            <span className="text-xs font-mono text-slate-500 uppercase tracking-widest block mb-2 border-b border-slate-900 pb-1">Microcontroller Stream Logs</span>
            <div className="font-mono text-xs text-emerald-400 overflow-y-auto flex-1 space-y-1 pr-1 custom-scrollbar">
              {systemLogs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap">{log}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Middle Column: Calculations Cards */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Mass Profile Card */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg flex flex-col justify-between">
              <div>
                <h3 className="text-slate-400 font-medium text-sm tracking-wide uppercase mb-3">Static Structural Mass Profiles</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-baseline border-b border-slate-700/50 pb-2">
                    <span className="text-slate-300">Measured Mass 1 ($M_1$):</span>
                    <span className="text-xl font-bold font-mono text-blue-400">{mass1 > 0 ? `${mass1.toFixed(2)} g` : '---'}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-700/50 pb-2">
                    <span className="text-slate-300">Calculated Mass 2 ($M_2$):</span>
                    <span className="text-xl font-bold font-mono text-purple-400">{mass2 > 0 ? `${mass2.toFixed(2)} g` : '---'}</span>
                  </div>
                </div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3 mt-4 border border-slate-700/30">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Assumed Friction Coefficient ($\mu_k$):</span>
                  <span className="font-mono text-white">{MU_K}</span>
                </div>
              </div>
            </div>

            {/* Dynamic Results Card */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg flex flex-col justify-between">
              <div>
                <h3 className="text-slate-400 font-medium text-sm tracking-wide uppercase mb-3">Kinematics Validation Profile</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-baseline border-b border-slate-700/50 pb-2">
                    <span className="text-slate-300">Time of Flight ($\Delta t$):</span>
                    <span className="text-xl font-bold font-mono text-emerald-400">{timeOfFlight > 0 ? `${timeOfFlight.toFixed(4)} s` : '---'}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-700/50 pb-2">
                    <span className="text-slate-300">Experimental Accel ($a_{exp}$):</span>
                    <span className="text-xl font-bold font-mono text-white">{accelExperimental > 0 ? `${accelExperimental.toFixed(3)} m/s²` : '---'}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-700/50 pb-2">
                    <span className="text-slate-300">Corrected Target ($a_{theo}$):</span>
                    <span className="text-xl font-bold font-mono text-amber-400">{accelTheoretical > 0 ? `${accelTheoretical.toFixed(3)} m/s²` : '---'}</span>
                  </div>
                </div>
              </div>
              
              {percentError !== null && (
                <div className={`mt-4 rounded-lg p-3 text-center border font-semibold ${
                  percentError < 5 ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400' : 'bg-amber-950/40 border-amber-800 text-amber-400'
                }`}>
                  Discrepancy Error Margin: {percentError.toFixed(2)}%
                </div>
              )}
            </div>
          </div>

          {/* Real-time Load Cell Plotting Graph */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                Live Load Cell Plotting Profile <span className="text-xs font-mono font-normal text-slate-400">(Streaming via Socket)</span>
              </h3>
              <div className="text-right">
                <span className="text-xs text-slate-400 block uppercase">Current Weight Reading</span>
                <span className="text-2xl font-black font-mono text-cyan-400">{liveWeight.toFixed(1)} g</span>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} />
                  <Line type="monotone" dataKey="weight" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}