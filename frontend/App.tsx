import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Icon, ToastProvider } from './components/UI';

import { Portfolio } from './components/Portfolio';
import { Terminal } from './components/Terminal';
import { Compliance } from './components/Compliance';
import { History } from './components/History';
import { SettingsModal } from './components/SettingsModal';
import { ProfileModal } from './components/ProfileModal';

// RainbowKit & Wagmi
import '@rainbow-me/rainbowkit/styles.css';
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider, useConnection, useSignMessage } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { auth } from './lib/auth';
import {
  QueryClientProvider,
  QueryClient,
} from "@tanstack/react-query";

const config = getDefaultConfig({
  appName: 'SSL Terminal',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
  chains: [baseSepolia],
  ssr: false,
});

const queryClient = new QueryClient();

const navItems = [
  { path: '/', label: 'Trade', icon: 'candlestick_chart', iconType: 'outlined' },
  { path: '/portfolio', label: 'Portfolio', icon: 'pie_chart', iconType: 'outlined' },
  { path: '/compliance', label: 'Compliance', icon: 'verified_user', iconType: 'outlined' },
  { path: '/history', label: 'History', icon: 'history', iconType: 'outlined' },
];

function AppContent() {
   const [isSettingsOpen, setIsSettingsOpen] = useState(false);
   const [isProfileOpen, setIsProfileOpen] = useState(false);
   const [isHumanVerified, setIsHumanVerified] = useState(false);
   const { address: eoaAddress, isConnected } = useConnection();
   const { signMessageAsync } = useSignMessage();
 
   const formattedEOA = eoaAddress ? eoaAddress.slice(0, 6) + "..." + eoaAddress.slice(-4) : "Connect Wallet";

   // Auth & Verification Sync
   useEffect(() => {
        if (!isConnected || !eoaAddress) {
            setIsHumanVerified(false);
            return;
        }
        
        const initAuth = async () => {
             // 1. Try to get current user session
             let user = await auth.getMe();
             
             // 2. If not logged in, try to login
             if (!user) {
                 try {
                     const success = await auth.login(eoaAddress, async ({ message }) => {
                        return await signMessageAsync({ 
                            message, 
                            account: eoaAddress 
                        });
                     });
                     if (success) {
                         user = await auth.getMe();
                     }
                 } catch (e) {
                     console.error("Auth failed", e);
                 }
             }

             // 3. Update State
             if (user) {
                 setIsHumanVerified(user.isVerified);
                 window.dispatchEvent(new Event("world-id-updated"));
             }
        };
        
        initAuth();
   }, [eoaAddress, isConnected]);

   // Listen for verification updates handling (Legacy/Local updates)
   useEffect(() => {
        const handleVerificationUpdate = () => {
            // Re-fetch me to get latest status if local event triggers
            auth.getMe().then(user => {
                if(user) setIsHumanVerified(user.isVerified);
            });
        };
        window.addEventListener("world-id-updated", handleVerificationUpdate);
        return () => window.removeEventListener("world-id-updated", handleVerificationUpdate);
   }, []);


 
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
 
         <nav className="flex flex-col gap-4">
           {navItems.map((item) => {
             const isActive = location.pathname === item.path || (item.path === '/' && location.pathname === '/');
             return (
               <NavLink
                 key={item.path}
                 to={item.path}
                 className={`group relative w-10 h-10 flex items-center justify-center transition-all duration-300 ${isActive ? 'text-primary' : 'text-slate-500 hover:text-slate-200'}`}
               >
                 <Icon name={item.icon} className={`text-2xl transition-all ${isActive ? 'scale-110 drop-shadow-[0_0_5px_rgba(13,242,89,0.5)]' : ''}`} />
                 {isActive && <div className="absolute -left-5 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r shadow-glow"></div>}
                 
                 {/* Tooltip */}
                 <span className="absolute left-14 bg-surface-lighter border border-border-dark px-2 py-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-mono shadow-xl pointer-events-none">
                   {item.label}
                 </span>
               </NavLink>
             );
           })}
         </nav>
         
         <div className="mt-auto flex flex-col items-center gap-6">
           <button 
             onClick={() => setIsProfileOpen(true)}
             className="w-8 h-8 rounded-full overflow-hidden border border-border-dark hover:border-primary transition-all grayscale hover:grayscale-0 shadow-lg hover:shadow-glow"
           >
             <img 
                src={eoaAddress ? `https://api.dicebear.com/7.x/identicon/svg?seed=${eoaAddress}` : "https://api.dicebear.com/7.x/identicon/svg?seed=fallback"} 
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
 
       {/* Main Area */}
       <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-16 border-b border-border-dark bg-surface-dark/50 backdrop-blur-md flex items-center justify-between px-8 shrink-0 z-20">
             <div className="flex items-center gap-4">
                <h1 className="text-lg font-bold text-white tracking-widest font-display flex items-center gap-2">
                  SSL <span className="text-primary font-mono text-sm px-2 py-0.5 border border-primary/20 bg-primary/5 rounded">TERMINAL v1.0</span>
                </h1>
                {/* Human Status */}
                <div 
                   className="hidden md:flex items-center gap-2 ml-8 px-3 py-1 bg-white/5 rounded border border-white/10 cursor-pointer hover:bg-white/10 transition-colors"
                   onClick={() => setIsProfileOpen(true)}
                >
                     <Icon name="fingerprint" className={`text-xs ${isHumanVerified ? "text-blue-400" : "text-slate-500"}`} />
                     <span className="text-[10px] font-mono uppercase tracking-wide text-slate-400">
                         Human: <span className={isHumanVerified ? "text-blue-400 font-bold" : "text-slate-500"}>
                             {isHumanVerified ? "VERIFIED" : "UNVERIFIED"}
                         </span>
                     </span>
                </div>
             </div>
 
             {/* Top Identity - EOA (Authority) and Stealth (Privacy) */}
             <div className="flex items-center justify-end gap-6 w-1/3">
               <div className="flex flex-col items-end cursor-pointer hover:bg-white/5 p-2 rounded transition-colors" onClick={() => setIsProfileOpen(true)}>
                  <div className="flex items-center gap-2">
                     <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-primary shadow-glow' : 'bg-slate-700'}`}></span>
                     <span className="text-xs font-mono text-slate-300 uppercase">{formattedEOA}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                     <Icon name="lock" className="text-[10px] text-slate-500" />
                     <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500 group-hover:text-primary transition-colors">
                         Stealth Identity: Manage Keys
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
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(13,242,89,0.03)_0%,transparent_50%)] pointer-events-none"></div>
            <Routes>
              <Route path="/" element={<Terminal />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/compliance" element={<Compliance />} />
              <Route path="/history" element={<History />} />
            </Routes>
         </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({
          accentColor: '#0df259',
          accentColorForeground: 'black',
          borderRadius: 'small',
          fontStack: 'system',
          overlayBlur: 'small',
        })}>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;