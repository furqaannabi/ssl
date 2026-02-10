import React from 'react';
import { Icon, Card, Badge, Button } from './UI';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const logs = [
  { time: '2023-10-24 14:02:11', event: 'Proof of Solvency Gen', hash: '0x8a...3b12', status: 'VERIFIED', color: 'primary' },
  { time: '2023-10-24 13:58:45', event: 'AML Screening (Auto)', hash: '0x1c...9f99', status: 'CLEAN', color: 'primary' },
  { time: '2023-10-24 12:30:00', event: 'TEE Attestation Report', hash: '0x4d...2e10', status: 'SIGNED', color: 'primary' },
  { time: '2023-10-24 11:15:22', event: 'Regulatory Access Req', hash: '0x9b...11a2', status: 'LOGGED', color: 'yellow' },
  { time: '2023-10-24 10:00:01', event: 'Daily Snapshot', hash: '0x3f...88c4', status: 'STORED', color: 'primary' },
  { time: '2023-10-24 09:30:00', event: 'System Init', hash: '0x00...0000', status: 'COMPLETE', color: 'slate' },
];

const zkpData = [
  { name: 'Completed', value: 75 },
  { name: 'Remaining', value: 25 },
];

export const Compliance: React.FC = () => {
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
               <span className="text-xs text-slate-400">Last verified: Today, 09:41 AM</span>
             </div>
          </Card>

          <Card className="p-5 group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <Icon name="badge" className="text-6xl text-slate-300" />
             </div>
             <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Accredited Investor Verification</h3>
             <div className="flex items-center gap-3">
               <span className="text-2xl font-bold text-white tracking-tight">VALID</span>
               <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">Exp: 2025</span>
             </div>
             <div className="mt-4 pt-3 border-t border-border-dark flex items-center gap-2">
               <Icon name="fingerprint" className="text-xs text-slate-500" />
               <span className="text-xs text-slate-400">WorldID Biometric Match</span>
             </div>
          </Card>

          <Card className="p-5 group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <Icon name="cloud_sync" className="text-6xl text-blue-400" />
             </div>
             <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Recent Oracle Check</h3>
             <div className="flex items-center gap-3">
               <span className="text-2xl font-bold text-white tracking-tight">14s ago</span>
             </div>
             <div className="mt-4 pt-3 border-t border-border-dark flex items-center justify-between">
               <span className="text-xs text-slate-400">via Chainlink Functions</span>
               <span className="text-[10px] font-mono text-slate-500">Block #18239402</span>
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
                         {logs.map((log, i) => (
                            <tr key={i} className="hover:bg-slate-800/50 transition-colors border-b border-border-dark/30 group">
                               <td className="py-3 px-4 text-slate-400">{log.time}</td>
                               <td className="py-3 px-4 text-white font-display">{log.event}</td>
                               <td className="py-3 px-4 text-slate-500 group-hover:text-primary transition-colors cursor-pointer">{log.hash}</td>
                               <td className="py-3 px-4 text-right">
                                  <Badge label={log.status} color={log.color as any} />
                               </td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                </div>
             </Card>
          </div>

          {/* ZKP Visualization */}
          <div className="lg:col-span-1">
             <Card className="h-full flex flex-col relative overflow-hidden">
                <div className="p-4 border-b border-border-dark flex items-center justify-between bg-black/20 z-10">
                   <h3 className="text-sm font-semibold text-white tracking-wide">ZKP Generation Status</h3>
                   <Icon name="lock" className="text-primary animate-pulse text-sm" />
                </div>
                
                <div className="flex-1 relative flex flex-col items-center justify-center p-6 bg-[#050505]">
                   <div className="absolute inset-0 bg-grid-pattern z-0 opacity-20"></div>
                   <div className="absolute top-0 left-0 w-full h-2 bg-primary shadow-[0_0_10px_#0df259] animate-scan opacity-50 z-0"></div>
                   
                   <div className="relative w-40 h-40 mb-6 z-10">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie
                           data={zkpData}
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
                        <span className="text-3xl font-bold text-white font-mono">75%</span>
                        <span className="text-[10px] text-primary uppercase tracking-widest mt-1">Generating</span>
                     </div>
                   </div>
                   
                   <div className="w-full space-y-3 z-10">
                     <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Proof Type</span>
                        <span className="font-mono text-white">zk-SNARK</span>
                     </div>
                     <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Circuits</span>
                        <span className="font-mono text-white">1,024</span>
                     </div>
                     <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Privacy Shield</span>
                        <span className="text-primary font-bold">ACTIVE</span>
                     </div>
                   </div>
                   
                   <div className="mt-6 text-[10px] text-slate-500 text-center max-w-[200px] leading-tight">
                     Zero-Knowledge Proofs ensure regulatory compliance without revealing underlying asset data.
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