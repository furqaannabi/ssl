
import React, { useState, useEffect } from 'react';
import { Icon, Button, Badge } from './UI';
import { auth } from '../lib/auth';

// ── Types ──
interface HistoryItem {
    id: string;
    type: 'ORDER' | 'DEPOSIT' | 'WITHDRAWAL';
    side: 'BUY' | 'SELL' | 'IN' | 'OUT';
    status: string;
    asset: string;
    amount: string;
    price: string;
    filled: string;
    hash: string;
    createdAt: string;
}

const API_URL = ""; // Use Vite proxy for CORS/cookie consistency

export const History: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

  const fetchHistory = async () => {
      setLoading(true);
      try {
          // Ensure authenticated
          const user = await auth.getMe();
          if (!user) return;

          const res = await fetch(`${API_URL}/api/history`, {
              credentials: 'include'
          });
          
          if (res.ok) {
              const data = await res.json();
              if (data.success) {
                  setHistory(data.history);
              }
          }
      } catch (e) {
          console.error("Failed to fetch history", e);
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
      fetchHistory();
      // Poll every 30s
      const interval = setInterval(fetchHistory, 30000);
      return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-full bg-background-dark bg-grid-pattern">
       {/* Main Content */}
       <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="h-16 border-b border-border-dark flex items-center px-6 justify-between bg-surface-dark/80 backdrop-blur-sm sticky top-0 z-10 shrink-0">
             <div className="flex items-center gap-4">
                <h1 className="text-lg font-bold tracking-tight text-white mr-4">HISTORY</h1>
                
                <div className="text-xs text-slate-500 font-mono">
                    {loading ? "Syncing..." : `Last updated: ${new Date().toLocaleTimeString()}`}
                </div>
             </div>
             
             <div className="flex items-center gap-3">
                <Button variant="ghost" icon="refresh" onClick={fetchHistory} disabled={loading}></Button>
             </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto p-6">
             <div className="border border-border-dark rounded bg-surface-dark overflow-hidden shadow-2xl">
                <table className="w-full text-left border-collapse">
                   <thead>
                      <tr className="bg-black/40 text-slate-500 text-[10px] uppercase tracking-wider font-semibold border-b border-border-dark">
                         <th className="px-4 py-3 font-medium w-48">Timestamp</th>
                         <th className="px-4 py-3 font-medium">Type</th>
                         <th className="px-4 py-3 font-medium">Asset</th>
                         <th className="px-4 py-3 font-medium">Side</th>
                         <th className="px-4 py-3 font-medium text-right">Amount</th>
                         <th className="px-4 py-3 font-medium text-right">Price</th>
                         <th className="px-4 py-3 font-medium text-center">Status</th>
                         <th className="px-4 py-3 font-medium w-64">Privacy Hash</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-border-dark text-xs font-mono">
                      {history.length === 0 && !loading && (
                          <tr>
                              <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                                  No history found. Start trading or depositing assets.
                              </td>
                          </tr>
                      )}
                      {history.map((row) => (
                         <tr 
                            key={row.id} 
                            onClick={() => setSelectedItem(row)}
                            className={`cursor-pointer hover:bg-white/5 transition-colors group ${selectedItem?.id === row.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'}`}
                         >
                            <td className="px-4 py-3 text-slate-400">
                                {new Date(row.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                               <Badge label={row.type} variant="outline" className="text-[10px]" />
                            </td>
                            <td className="px-4 py-3 font-display font-medium text-white">
                               {row.asset.includes('0x') ? `${row.asset.slice(0,6)}...` : row.asset}
                            </td>
                            <td className="px-4 py-3">
                               <span className={`${['BUY', 'IN', 'DEPOSIT'].includes(row.side) ? 'text-primary' : 'text-red-400'} font-bold`}>
                                   {row.side}
                               </span>
                            </td>
                            <td className="px-4 py-3 text-right text-white">
                                {Number(row.amount).toFixed(4)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-300">
                                {row.price === '-' ? '-' : `$${Number(row.price).toFixed(2)}`}
                            </td>
                            <td className="px-4 py-3 text-center">
                               <Badge 
                                variant={['MATCHED', 'SETTLED', 'COMPLETED'].includes(row.status) ? 'success' : row.status === 'OPEN' ? 'warning' : 'outline'}
                                label={row.status}
                               />
                            </td>
                            <td className="px-4 py-3 text-slate-500 group-hover:text-slate-300 transition-colors">
                               <div className="flex items-center justify-between gap-2 bg-black/30 rounded px-2 py-1 border border-transparent group-hover:border-border-dark">
                                  <span className="truncate">{row.hash}</span>
                                  <Icon name="content_copy" className="text-[12px] opacity-0 group-hover:opacity-100 cursor-pointer hover:text-primary" />
                               </div>
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </div>
       </div>

       {/* Right Sidebar (Details) */}
       {selectedItem && (
           <aside className="w-80 bg-surface-dark border-l border-border-dark flex flex-col shrink-0 z-10 shadow-xl animate-in slide-in-from-right duration-300">
              <div className="h-16 border-b border-border-dark flex items-center px-5 justify-between bg-black/20 shrink-0">
                 <h2 className="text-sm font-bold uppercase tracking-wide text-white">Details</h2>
                 <button onClick={() => setSelectedItem(null)} className="text-slate-500 hover:text-white transition-colors">
                    <Icon name="close" className="text-lg" />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
                 <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex flex-col items-center text-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-1">
                       <Icon name="verified" className="text-primary text-2xl" />
                    </div>
                    <div className="text-primary font-bold text-lg tracking-tight">{selectedItem.type} {selectedItem.status}</div>
                    <div className="text-[10px] text-slate-400">Cryptographically Secured Event</div>
                 </div>
                 
                 <div className="space-y-4">
                    <div>
                       <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">ID</div>
                       <div className="text-xs font-mono text-white bg-black/40 p-2 rounded border border-border-dark flex items-center justify-between group">
                          <span className="truncate">{selectedItem.id}</span>
                          <Icon name="content_copy" className="text-[12px] text-slate-600 group-hover:text-primary cursor-pointer" />
                       </div>
                    </div>
                    <div>
                       <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Amount</div>
                       <div className="flex justify-between items-center text-sm border-b border-border-dark pb-2 mb-2">
                          <span className="text-slate-300">Quantity</span>
                          <span className="font-mono text-white">{selectedItem.amount} {selectedItem.asset}</span>
                       </div>
                       {selectedItem.price !== '-' && (
                           <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-300">Price</span>
                              <span className="font-mono text-primary">${selectedItem.price}</span>
                           </div>
                       )}
                    </div>
                 </div>
                 
                 <div className="space-y-3 pt-4 border-t border-border-dark">
                    <h3 className="text-xs font-bold text-white uppercase flex items-center gap-2">
                       <Icon name="fingerprint" className="text-sm text-primary" />
                       Proof of Action
                    </h3>
                    <div className="space-y-3">
                        <div>
                             <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-slate-500">Stealth Hash</span>
                                <span className="text-[10px] text-primary flex items-center gap-0.5"><Icon name="check_circle" className="text-[10px]" /> Valid</span>
                             </div>
                             <div className="text-[10px] font-mono text-slate-400 bg-black/40 p-2 rounded break-all border border-border-dark leading-tight">
                                {selectedItem.hash}
                             </div>
                          </div>
                    </div>
                 </div>
              </div>
           </aside>
       )}
    </div>
  );
};