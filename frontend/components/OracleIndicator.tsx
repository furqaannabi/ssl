import React, { useState, useEffect } from 'react';
import { Icon } from './UI';

interface OracleData {
  status: 'BULLISH' | 'BEARISH' | 'GATHERING_INTEL';
  price: number;
  vwap: number;
  strength: number;
  thresholdMet: boolean;
  sampleSize: number;
}

export const OracleIndicator: React.FC<{ pairId: string }> = ({ pairId }) => {
  const [data, setData] = useState<OracleData | null>(null);
  const [jitter, setJitter] = useState(0);
  const [loading, setLoading] = useState(true);

  const API_URL = ""; // Use Vite proxy for CORS/cookie consistency

  useEffect(() => {
    if (!pairId) return;

    const fetchSignal = async () => {
      try {
        const res = await fetch(`${API_URL}/api/oracle/signal/${pairId}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) setData(json.data);
        }
      } catch (e) {
        console.error("Oracle fetch failed", e);
      } finally {
        setLoading(false);
      }
    };

    fetchSignal();
    const interval = setInterval(fetchSignal, 5000);
    return () => clearInterval(interval);
  }, [pairId, API_URL]);

  // Jitter effect for "live" feel
  useEffect(() => {
    const jitterInterval = setInterval(() => {
      setJitter((Math.random() - 0.5) * 0.8);
    }, 2000);
    return () => clearInterval(jitterInterval);
  }, []);

  if (loading || !pairId) {
    return (
      <div className="flex flex-col gap-1 p-2 bg-black/40 border border-white/5 rounded font-mono">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-slate-400 uppercase font-bold">Stealth Intelligence</span>
          <span className="text-[8px] text-slate-500 animate-pulse">CONNECTING...</span>
        </div>
        <div className="w-full h-1 bg-white/5 rounded-full"></div>
      </div>
    );
  }

  if (!data || data.status === 'GATHERING_INTEL') {
    const sampleSize = data?.sampleSize || 0;
    const progress = (sampleSize / 5) * 100;
    return (
      <div className="flex flex-col gap-1 p-2 bg-primary/5 border border-primary/30 rounded font-mono shadow-[0_0_15px_rgba(var(--primary-rgb),0.1)]">
        <div className="flex justify-between items-center">
          <h3 className="text-[10px] text-white uppercase font-bold tracking-tight">Stealth Intelligence</h3>
          <span className="text-[9px] text-primary animate-pulse font-bold uppercase">Gathering Intel...</span>
        </div>
        <div className="w-full h-1 bg-black rounded-full overflow-hidden border border-white/5">
          <div 
            className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.6)] transition-all duration-1000" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <div className="flex justify-between items-center">
            <span className="text-[8px] text-slate-300 uppercase font-medium">Privacy Guard Active</span>
            <span className="text-[9px] text-white font-black uppercase">{sampleSize} / 5 Settlements</span>
        </div>
      </div>
    );
  }

  const isBullish = data.status === 'BULLISH';
  const displayStrength = Math.min(100, Math.max(0, data.strength + jitter)).toFixed(1);

  return (
    <div className={`flex flex-col gap-1 p-3 rounded font-mono border ${isBullish ? 'bg-primary/10 border-primary/40' : 'bg-red-500/10 border-red-500/40'} shadow-glow animate-in fade-in transition-all duration-500`}>
      <div className="flex justify-between items-end mb-1">
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-300 uppercase font-bold tracking-widest">Stealth Intelligence</span>
          <span className={`text-sm font-black ${isBullish ? 'text-primary' : 'text-red-500'} flex items-center gap-1 drop-shadow-[0_0_5px_rgba(0,0,0,0.5)]`}>
            {isBullish ? <Icon name="trending_up" className="text-base" /> : <Icon name="trending_down" className="text-base" />}
            {data.status}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[9px] text-slate-300 uppercase font-bold">Confidence</span>
          <div className="text-xs text-white font-black">{displayStrength}%</div>
        </div>
      </div>
      <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/10">
        <div 
          className={`h-full transition-all duration-1000 ease-out ${isBullish ? 'bg-primary shadow-[0_0_10px_#4ade80]' : 'bg-red-500 shadow-[0_0_10px_#f87171]'}`}
          style={{ width: `${data.strength}%` }}
        ></div>
      </div>
    </div>
  );
};
