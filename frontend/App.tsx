import React, { useState, useEffect } from 'react';
import { View, NavItem } from './types';
import { Icon } from './components/UI';
import { loadSpendingKeypair, getMetaAddress } from './lib/stealth';
import { Portfolio } from './components/Portfolio';
import { Terminal } from './components/Terminal';
import { Compliance } from './components/Compliance';
import { History } from './components/History';
import { SettingsModal } from './components/SettingsModal';
import { ProfileModal } from './components/ProfileModal';

const navItems: NavItem[] = [
  { id: View.TERMINAL, label: 'Trade', icon: 'candlestick_chart', iconType: 'outlined' },
  { id: View.DASHBOARD, label: 'Portfolio', icon: 'pie_chart', iconType: 'outlined' },
  { id: View.COMPLIANCE, label: 'Compliance', icon: 'verified_user', iconType: 'outlined' },
  { id: View.HISTORY, label: 'History', icon: 'history', iconType: 'outlined' },
];

function App() {
  const [activeView, setActiveView] = useState<View>(View.TERMINAL);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [userAddress, setUserAddress] = useState<string>("");

  useEffect(() => {
    const updateIdentity = () => {
        const keys = loadSpendingKeypair();
        if (keys) {
            const meta = getMetaAddress(keys.publicKey);
            setUserAddress(meta.slice(0, 6) + "..." + meta.slice(-4));
        }
    };
    
    updateIdentity();
    window.addEventListener('storage', updateIdentity);
    return () => window.removeEventListener('storage', updateIdentity);
  }, []);

  const renderView = () => {
    switch (activeView) {
      case View.DASHBOARD: return <Portfolio />;
      case View.TERMINAL: return <Terminal />;
      case View.COMPLIANCE: return <Compliance />;
      case View.HISTORY: return <History />;
      default: return <div className="p-10 text-center text-slate-500">Module Under Construction</div>;
    }
  };

  return (
    <div className="flex h-screen w-full bg-background-dark text-slate-300 font-display">
      
      {/* Modals */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      {/* Sidebar */}
      <aside className="w-16 lg:w-20 border-r border-border-dark bg-surface-dark flex flex-col items-center py-6 z-30 shadow-2xl">
        <div className="mb-8">
           <div className="w-10 h-10 bg-primary/10 border border-primary flex items-center justify-center shadow-glow rounded-sm">
             <Icon name="security" className="text-primary text-xl" />
           </div>
        </div>
        
        <nav className="flex-1 w-full flex flex-col gap-6 items-center">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`group relative w-10 h-10 flex items-center justify-center transition-all duration-300 ${isActive ? 'text-primary' : 'text-slate-500 hover:text-slate-200'}`}
              >
                <Icon name={item.icon} className={`text-2xl transition-all ${isActive ? 'scale-110 drop-shadow-[0_0_5px_rgba(13,242,89,0.5)]' : ''}`} />
                {isActive && <div className="absolute -left-5 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r shadow-glow"></div>}
                
                {/* Tooltip */}
                <span className="absolute left-14 bg-surface-lighter border border-border-dark px-2 py-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-mono shadow-xl pointer-events-none">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
        
        <div className="mt-auto flex flex-col items-center gap-6">
          <button 
            onClick={() => setIsProfileOpen(true)}
            className="w-8 h-8 rounded-full overflow-hidden border border-border-dark hover:border-primary transition-all grayscale hover:grayscale-0 shadow-lg hover:shadow-glow"
          >
            <img 
               src={userAddress ? `https://api.dicebear.com/7.x/identicon/svg?seed=${userAddress}` : "https://api.dicebear.com/7.x/identicon/svg?seed=fallback"} 
               alt="User" 
               className="w-full h-full object-cover" 
            />
          </button>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="text-slate-500 hover:text-primary transition-colors hover:rotate-90 duration-500"
          >
            <Icon name="settings" className="text-xl" />
          </button>
        </div>
      </aside>

      {/* Main Layout */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 border-b border-border-dark bg-surface-dark/95 backdrop-blur flex items-center justify-between px-6 z-20 shrink-0 shadow-lg relative">
           <div className="flex items-center gap-6 w-1/3">
              <h1 className="text-lg font-bold tracking-tight text-white uppercase font-mono hidden md:block">
                 SSL <span className="text-primary font-light">///</span> {activeView}
              </h1>
              <div className="h-8 w-px bg-border-dark hidden md:block"></div>
              <div className="flex flex-col">
                 <span className="text-[10px] uppercase text-slate-500 font-mono tracking-wider">Network</span>
                 <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                    <Icon name="link" className="text-[10px] text-primary" />
                    CCIP <span className="text-slate-500">::</span> MAINNET
                 </div>
              </div>
           </div>

           {/* Status Center */}
           <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block">
              <div className="flex items-center gap-3 px-6 py-2 bg-black/40 border border-primary/30 shadow-glow clip-path-polygon">
                 <div className="relative flex items-center justify-center w-5 h-5">
                    <Icon name="shield" className="text-primary text-sm z-10" />
                    <div className="absolute inset-0 bg-primary/20 rounded-full animate-pulse"></div>
                 </div>
                 <div className="flex flex-col leading-none">
                    <span className="text-[10px] text-primary/70 uppercase tracking-widest font-mono mb-0.5">Status</span>
                    <span className="text-xs font-bold text-white tracking-wide uppercase font-mono">Secure Enclave Active</span>
                 </div>
              </div>
           </div>

           {/* Right Info */}
           <div className="flex items-center justify-end gap-6 w-1/3">
              <div className="flex flex-col items-end cursor-pointer hover:bg-white/5 p-2 rounded transition-colors" onClick={() => setIsProfileOpen(true)}>
                 <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${userAddress ? 'bg-primary shadow-glow' : 'bg-slate-700'}`}></span>
                    <span className="text-xs font-mono text-slate-300 uppercase">{userAddress || "Identity Inactive"}</span>
                 </div>
                 <div className="flex items-center gap-1 mt-0.5">
                    <Icon name={userAddress ? "fingerprint" : "lock_open"} className={`text-[10px] ${userAddress ? 'text-primary' : 'text-slate-500'}`} />
                    <span className={`text-[10px] font-mono uppercase tracking-wide ${userAddress ? 'text-primary' : 'text-slate-500'}`}>
                        {userAddress ? "Stealth Identity" : "Layer Offline"}
                    </span>
                 </div>
              </div>
              <div className="h-8 w-px bg-border-dark hidden lg:block"></div>
              <div className="text-right hidden lg:block">
                 <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Net Liquidity</div>
                 <div className="text-sm font-mono font-bold text-white tracking-tight">$42,592,104.00</div>
              </div>
           </div>
        </header>

        {/* Content View */}
        <main className="flex-1 overflow-hidden relative">
          {renderView()}
        </main>
        
        {/* Universal Footer */}
        {activeView !== View.TERMINAL && activeView !== View.HISTORY && (
          <footer className="h-8 bg-obsidian border-t border-border-dark flex items-center px-4 overflow-hidden z-20 shrink-0">
             <div className="flex items-center gap-2 mr-4 border-r border-border-dark pr-4 h-full">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                <span className="text-[9px] font-bold text-slate-300 font-mono whitespace-nowrap tracking-wider">SYSTEM OPTIMAL</span>
             </div>
             <div className="flex-1 text-[10px] text-slate-500 font-mono flex justify-end">
                SSL ENCRYPTED CONNECTION V2.4.0
             </div>
          </footer>
        )}
      </div>
    </div>
  );
}

export default App;