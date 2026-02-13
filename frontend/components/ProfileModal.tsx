import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon } from './UI';
import { getOrCreateSpendingKeypair, SpendingKeypair, getMetaAddress } from '../lib/stealth';
import WorldIdKit from './WorldIdKit';

export const ProfileModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const [spendingKeypair, setSpendingKeypair] = useState<SpendingKeypair | null>(null);
    const [revealKey, setRevealKey] = useState(false);
    const [displayAddress, setDisplayAddress] = useState<string>("");

    useEffect(() => {
        if (isOpen) {
            const stored = localStorage.getItem("ssl_spending_keypair");
            if (stored) {
                const keys = JSON.parse(stored);
                setSpendingKeypair(keys);
                const fullAddress = getMetaAddress(keys.publicKey);
                setDisplayAddress(fullAddress.slice(0, 6) + "..." + fullAddress.slice(-4));
            }
        }
    }, [isOpen]);

    const handleInitializeStealth = () => {
        const keys = getOrCreateSpendingKeypair();
        setSpendingKeypair(keys);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Identity & Access">
            <div className="flex flex-col items-center mb-6 relative">
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent -z-10 rounded-full blur-xl transform -translate-y-4"></div>
                <div className="w-20 h-20 rounded-full border-2 border-primary/30 p-1 mb-3 relative group cursor-pointer">
                     <img 
                        src={displayAddress ? `https://api.dicebear.com/7.x/identicon/svg?seed=${displayAddress}` : "https://api.dicebear.com/7.x/identicon/svg?seed=fallback"} 
                        alt="Profile" 
                        className="w-full h-full rounded-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" 
                     />
                     <div className="absolute bottom-0 right-0 bg-background-dark border border-primary rounded-full p-1 text-primary shadow-glow">
                        <Icon name="verified_user" className="text-xs block" />
                     </div>
                </div>
                {/* <h2 className="text-lg font-bold text-white tracking-wide font-display">ALEXANDER K.</h2> */}
                <div className="flex items-center gap-2 mt-1">
                     {displayAddress ? (
                         <span 
                            onClick={() => {
                                navigator.clipboard.writeText(displayAddress);
                                // could add a toast here
                            }}
                            className="text-xs font-mono text-slate-400 bg-surface-lighter px-2 py-1 rounded border border-border-dark flex items-center gap-2 cursor-pointer hover:text-white hover:border-slate-500 transition-colors active:scale-95 transform"
                         >
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-glow"></span>
                            {displayAddress} 
                            <Icon name="content_copy" className="text-[10px] opacity-70" />
                         </span>
                     ) : (
                         <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider flex items-center gap-2 opacity-60">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                            Confidential Layer Inactive
                         </span>
                     )}
                </div>
            </div>

            {/* Stealth Layer Section */}
            <div className="mb-6 bg-black/40 p-4 rounded border border-primary/20 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Icon name="lock" className="text-2xl text-primary" />
                </div>
                <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Icon name="security" className="text-xs" /> Stealth Settlement Layer
                </h4>
                
                {spendingKeypair ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-400">Spending Status</span>
                            <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">INITIALIZED</span>
                        </div>
                        <div className="p-2 bg-black/60 rounded border border-border-dark font-mono text-[9px] break-all text-slate-500 relative group">
                            <span className="text-primary/70 mb-1 block uppercase text-[8px]">Static Spending Public Key</span>
                            {spendingKeypair.publicKey}
                        </div>
                        <div className="pt-2">
                            {revealKey ? (
                                <div className="space-y-2">
                                    <div className="p-2 bg-red-900/20 rounded border border-red-900/50 font-mono text-[9px] break-all text-red-400">
                                        <span className="text-red-500 mb-1 block uppercase text-[8px] font-bold">Root Private Key — BACKUP NOW</span>
                                        {spendingKeypair.privateKey}
                                    </div>
                                    <Button variant="ghost" fullWidth onClick={() => setRevealKey(false)} className="text-[10px]">Hide Secret</Button>
                                </div>
                            ) : (
                                <Button variant="secondary" fullWidth icon="vpn_key" onClick={() => setRevealKey(true)} className="text-[10px] border-slate-700">Backup Spending Key</Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-2">
                        <p className="text-[10px] text-slate-400 mb-4">Initialize your confidential layer to enable stealth addresses.</p>
                        <Button fullWidth variant="primary" icon="bolt" onClick={handleInitializeStealth}>Initialize Stealth Layer</Button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6 font-mono">
                <div className="bg-surface-lighter p-3 rounded border border-border-dark text-center">
                    <div className="text-[9px] text-slate-500 uppercase mb-1 tracking-wider">Trading Tier</div>
                    <div className="text-xs font-bold text-white">INSTITUTIONAL</div>
                </div>
                <div className="bg-surface-lighter p-3 rounded border border-border-dark text-center">
                    <div className="text-[9px] text-slate-500 uppercase mb-1 tracking-wider">Daily Limit</div>
                    <div className="text-xs font-bold text-primary">UNLIMITED</div>
                </div>
            </div>


            <div className="space-y-4 mb-6 bg-black/20 p-4 rounded border border-border-dark">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-border-dark pb-2 mb-2">Compliance Metrics</h4>
                
                {/* Real World ID Integration */}
                <div className="py-2">
                    <WorldIdKit 
                        onSuccess={() => console.log("World ID Verified!")} 
                        signal={displayAddress} 
                    />
                </div>

                <div className="space-y-2 pt-2 border-t border-border-dark/50">
                    {[
                        { label: 'Hardware MFA', status: 'check_circle', color: 'text-primary' },
                        { label: 'KYC Level 3', status: 'check_circle', color: 'text-primary' },
                    ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-slate-400">{item.label}</span>
                            <Icon name={item.status} className={`${item.color} text-xs`} />
                        </div>
                    ))}
                </div>
            </div>

            <Button fullWidth variant="ghost" icon="logout" className="opacity-50 hover:opacity-100 text-xs">Disconnect Session</Button>
        </Modal>
    );
};