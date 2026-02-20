import React, { useState, useEffect } from 'react';
import { Icon, Card, Badge, Button } from './UI';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import WorldIdKit from './WorldIdKit';
import { auth } from '../lib/auth';
import { useConnection } from 'wagmi';






export const Compliance: React.FC = () => {
    const [isHumanVerified, setIsHumanVerified] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const { isConnected } = useConnection();

    useEffect(() => {
        const init = async () => {
            // 1. Check User Auth
            const user = await auth.getMe();
            if (user) setIsHumanVerified(user.isVerified);

            // 2. Fetch Compliance Stats
            try {
                const res = await fetch(`/api/compliance/stats`, {
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.success) {
                    setStats(data.stats);
                }
            } catch (e) {
                console.error("Failed to fetch compliance stats", e);
            }
        };

        if (isConnected) init();

        const handleVerificationUpdate = () => {
             setIsHumanVerified(true); 
             setTimeout(init, 1000); 
        };

        window.addEventListener("world-id-updated", handleVerificationUpdate);
        return () => window.removeEventListener("world-id-updated", handleVerificationUpdate);
    }, [isConnected]);

    // Calculate time diff string
    const getTimeSince = (dateStr: string) => {
        if (!dateStr) return "-";
        const seconds = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        return `${Math.floor(seconds / 60)}m ago`;
    };

    const zkpCompleted = stats?.zkpCompleted || 0;
    const zkpPending = stats?.zkpPending || 0;
    const totalZkp = zkpCompleted + zkpPending;
    const zkpPercentage = totalZkp > 0 ? Math.round((zkpCompleted / totalZkp) * 100) : 100;

    const zkpChartData = [
        { name: 'Completed', value: Math.max(zkpCompleted, 1) }, // Ensure at least 1 for chart
        { name: 'Remaining', value: zkpPending }
    ];

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden relative">
       <div className="absolute inset-0 bg-grid-pattern opacity-10 pointer-events-none"></div>

       {/* Top Stats */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 z-10">
          <Card className="p-5 group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <Icon name="verified_user" className="text-6xl text-primary" />
             </div>
             <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Global KYC/AML Status</h3>
             <div className="flex items-center gap-3">
               <span className="text-2xl font-bold text-white tracking-tight">PASSED</span>
               <div className="bg-primary/20 text-primary rounded-full p-0.5"><Icon name="check" className="text-lg block" /></div>
             </div>
             <div className="mt-4 pt-3 border-t border-border-dark flex items-center gap-2">
               <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
               <span className="text-xs text-slate-400">System Active • {stats?.totalVerifiedUsers || 0} Verified Users</span>
             </div>
          </Card>

          <Card className="p-5 group relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <Icon name="fingerprint" className="text-6xl text-slate-300" />
             </div>
             <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Human Verification</h3>
             <div className="flex items-center gap-3">
               <span className={`text-2xl font-bold tracking-tight ${isHumanVerified ? 'text-white' : 'text-slate-500'}`}>
                   {isHumanVerified ? "VERIFIED" : "UNVERIFIED"}
               </span>
               {isHumanVerified && (
                   <span className="text-xs font-mono text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded border border-blue-400/20">World ID</span>
               )}
             </div>
             <div className="mt-4 pt-3 border-t border-border-dark flex flex-col gap-2">
               {!isHumanVerified ? (
                   <div className="w-full">
                       <p className="text-[10px] text-slate-500 mb-2">Verify your unique personhood to access compliant pools.</p>
                       <div className="max-w-[200px]">
                           <WorldIdKit />
                       </div>
                   </div>
               ) : (
                   <div className="flex items-center gap-2">
                        <Icon name="verified" className="text-xs text-blue-400" />
                        <span className="text-xs text-slate-400">Credential valid & active</span>
                   </div>
               )}
             </div>
          </Card>

          <Card className="p-5 group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <Icon name="cloud_sync" className="text-6xl text-blue-400" />
             </div>
             <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Recent Oracle Check</h3>
             <div className="flex items-center gap-3">
               <span className="text-2xl font-bold text-white tracking-tight">{stats ? getTimeSince(stats.oracleLastUpdate) : "..."}</span>
             </div>
             <div className="mt-4 pt-3 border-t border-border-dark flex items-center justify-between">
               <span className="text-xs text-slate-400">via Chainlink Functions</span>
               <span className="text-[10px] font-mono text-slate-500">Live Feed</span>
             </div>
          </Card>
       </div>

       {/* Main Grid */}
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[400px] z-10">
          {/* Logs */}
          <div className="lg:col-span-2">
             <Card className="h-full flex flex-col">
                <div className="p-4 border-b border-border-dark flex items-center justify-between bg-black/20">
                   <div className="flex items-center gap-2">
                      <Icon name="history" className="text-slate-400 text-sm" />
                      <h3 className="text-sm font-semibold text-white tracking-wide">Immutable Compliance Logs</h3>
                   </div>
                   <Badge label="LIVE FEED" color="slate" />
                </div>
                <div className="flex-1 overflow-auto bg-[#080a09]">
                   <table className="w-full text-left border-collapse">
                      <thead className="bg-surface-dark sticky top-0 z-10">
                         <tr>
                            <th className="py-2 px-4 text-[10px] uppercase text-slate-500 font-mono border-b border-border-dark">Timestamp (UTC)</th>
                            <th className="py-2 px-4 text-[10px] uppercase text-slate-500 font-mono border-b border-border-dark">Event Type</th>
                            <th className="py-2 px-4 text-[10px] uppercase text-slate-500 font-mono border-b border-border-dark">Hash (TxID)</th>
                            <th className="py-2 px-4 text-[10px] uppercase text-slate-500 font-mono border-b border-border-dark text-right">Status</th>
                         </tr>
                      </thead>
                      <tbody className="text-xs font-mono">
                         {stats?.logs?.map((log: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-800/50 transition-colors border-b border-border-dark/30 group">
                               <td className="py-3 px-4 text-slate-400">{new Date(log.time).toLocaleString()}</td>
                               <td className="py-3 px-4 text-white font-display">{log.event}</td>
                               <td className="py-3 px-4 text-slate-500 group-hover:text-primary transition-colors cursor-pointer">{log.hash}</td>
                               <td className="py-3 px-4 text-right">
                                  <Badge label={log.status} color={log.color as any} />
                               </td>
                            </tr>
                         ))}
                         {!stats?.logs?.length && (
                             <tr><td colSpan={4} className="p-4 text-center text-slate-500">No recent activity</td></tr>
                         )}
                      </tbody>
                   </table>
                </div>
             </Card>
          </div>

          {/* ZKP Visualization */}
          <div className="lg:col-span-1">
             <Card className="h-full flex flex-col relative overflow-hidden">
                <div className="p-4 border-border-dark flex items-center justify-between bg-black/20 z-10">
                   <h3 className="text-sm font-semibold text-white tracking-wide">Order Settlement Status</h3>
                   <Icon name="lock" className="text-primary animate-pulse text-sm" />
                </div>
                
                <div className="flex-1 relative flex flex-col items-center justify-center p-6 bg-[#050505]">
                   <div className="absolute inset-0 bg-grid-pattern z-0 opacity-20"></div>
                   <div className="absolute top-0 left-0 w-full h-2 bg-primary shadow-[0_0_10px_#0df259] animate-scan opacity-50 z-0"></div>
                   
                   <div className="relative w-40 h-40 mb-6 z-10">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie
                           data={zkpChartData}
                           cx="50%"
                           cy="50%"
                           innerRadius={60}
                           outerRadius={70}
                           startAngle={90}
                           endAngle={-270}
                           dataKey="value"
                           stroke="none"
                         >
                           <Cell key="cell-0" fill="#0df259" className="drop-shadow-[0_0_10px_rgba(13,242,89,0.5)]" />
                           <Cell key="cell-1" fill="#334155" />
                         </Pie>
                       </PieChart>
                     </ResponsiveContainer>
                     <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold text-white font-mono">{zkpPercentage}%</span>
                        <span className="text-[10px] text-primary uppercase tracking-widest mt-1">
                            {zkpPending > 0 ? "Settling" : "Settled"}
                        </span>
                     </div>
                   </div>
                   
                   <div className="w-full space-y-3 z-10">
                     <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Method</span>
                        <span className="font-mono text-white">Confidential Match</span>
                     </div>
                     <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Total Orders</span>
                        <span className="font-mono text-white">{totalZkp}</span>
                     </div>
                     <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Privacy Shield</span>
                        <span className="text-primary font-bold">ACTIVE</span>
                     </div>
                   </div>
                   
                   <div className="mt-6 text-[10px] text-slate-500 text-center max-w-[200px] leading-tight">
                     Orders are cryptographically secured to ensure regulatory compliance without revealing underlying data.
                   </div>
                </div>
             </Card>
          </div>
       </div>

       {/* Actions */}
       <div className="mt-6">
          <Card className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-slate-800 border border-slate-700 flex items-center justify-center">
                   <Icon name="download" className="text-slate-400" />
                </div>
                <div>
                   <h4 className="text-sm font-semibold text-white">Export Regulatory Report</h4>
                   <p className="text-xs text-slate-400">Generate signed proofs for audit purposes.</p>
                </div>
             </div>
             <div className="flex items-center gap-3 w-full md:w-auto">
                <Button variant="ghost" icon="picture_as_pdf" className="text-red-400 hover:text-red-300">PDF Report</Button>
                <Button variant="ghost" icon="table_chart" className="text-green-400 hover:text-green-300">CSV Data</Button>
                <Button variant="primary" icon="code" className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30">JSON API</Button>
             </div>
          </Card>
       </div>
    </div>
  );
};