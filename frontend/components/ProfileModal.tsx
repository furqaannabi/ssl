import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon } from './UI';
import { getOrCreateSpendingKeypair, SpendingKeypair, getMetaAddress } from '../lib/stealth';
import WorldIdKit from './WorldIdKit';
import { useConnection } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export const ProfileModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const [spendingKeypair, setSpendingKeypair] = useState<SpendingKeypair | null>(null);
    const [revealKey, setRevealKey] = useState(false);
    const [stealthAddress, setStealthAddress] = useState<string>("");
    
    const { address: eoaAddress, isConnected } = useConnection();

    useEffect(() => {
        if (isOpen) {
            const stored = localStorage.getItem("ssl_spending_keypair");
            if (stored) {
                const keys = JSON.parse(stored);
                setSpendingKeypair(keys);
                const fullAddress = getMetaAddress(keys.publicKey);
                setStealthAddress(fullAddress.slice(0, 6) + "..." + fullAddress.slice(-4));
            }
        }
    }, [isOpen]);

    const handleInitializeStealth = () => {
        const keys = getOrCreateSpendingKeypair();
        setSpendingKeypair(keys);
        const fullAddress = getMetaAddress(keys.publicKey);
        setStealthAddress(fullAddress.slice(0, 6) + "..." + fullAddress.slice(-4));
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Identity & Access">
            {/* EOA Connection Section (Authority) */}
            <div className="mb-8 p-4 bg-primary/5 border border-primary/20 rounded relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Icon name="account_balance_wallet" className="text-3xl text-primary" />
                </div>
                <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Icon name="verified" className="text-xs" /> Authority Wallet (EOA)
                </h4>
                
                <div className="flex flex-col items-center">
                    <div className="mb-4">
                        <ConnectButton 
                          accountStatus="address"
                          chainStatus="icon"
                          showBalance={false}
                        />
                    </div>
                    {isConnected && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="text-slate-500">Address Origin</span>
                                <span className="text-slate-300">METAMASK / BROWSER</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="text-slate-500">Identity Rights</span>
                                <span className="text-primary">FULL AUTHENTICATION</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="h-px bg-border-dark w-full mb-8"></div>

            {/* Stealth Identity Section (Privacy) */}
            <div className="flex flex-col items-center mb-6 relative">
                <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-primary/5 to-transparent -z-10 rounded-full blur-2xl opacity-50"></div>
                
                <div className="w-20 h-20 rounded-full border-2 border-primary/30 p-1 mb-3 relative group">
                     <img 
                        src={stealthAddress ? `https://api.dicebear.com/7.x/identicon/svg?seed=${stealthAddress}` : "https://api.dicebear.com/7.x/identicon/svg?seed=initial"} 
                        alt="Stealth Avatar" 
                        className="w-full h-full rounded-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" 
                     />
                     <div className="absolute bottom-0 right-0 bg-background-dark border border-primary rounded-full p-1 text-primary shadow-glow">
                        <Icon name="fingerprint" className="text-xs block" />
                     </div>
                </div>

                <div className="text-center">
                    <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Stealth Identity</h5>
                    <div className="flex items-center gap-2">
                        {stealthAddress ? (
                            <span className="text-sm font-mono text-white bg-surface-lighter px-3 py-1 rounded border border-border-dark flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-glow"></span>
                                {stealthAddress}
                            </span>
                        ) : (
                            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider flex items-center gap-2 opacity-60">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                                Inactive
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Stealth Layer Management */}
            <div className="mb-8 bg-black/40 p-4 rounded border border-border-dark relative">
                {spendingKeypair ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Confidential Keys</span>
                            <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">READY</span>
                        </div>
                        <div className="p-2 bg-black/60 rounded border border-border-dark font-mono text-[9px] break-all text-slate-500 relative group">
                            <span className="text-primary/70 mb-1 block uppercase text-[8px]">Stealth Root Public Key</span>
                            {spendingKeypair.publicKey}
                        </div>
                        <div className="pt-2">
                            {revealKey ? (
                                <div className="space-y-2">
                                    <div className="p-2 bg-red-900/20 rounded border border-red-900/50 font-mono text-[9px] break-all text-red-400">
                                        <span className="text-red-500 mb-1 block uppercase text-[8px] font-bold font-sans">BACKUP THESE KEYS — LOSS IS PERMANENT</span>
                                        {spendingKeypair.privateKey}
                                    </div>
                                    <Button variant="ghost" fullWidth onClick={() => setRevealKey(false)} className="text-[10px]">Hide Secret</Button>
                                </div>
                            ) : (
                                <Button variant="secondary" fullWidth icon="vpn_key" onClick={() => setRevealKey(true)} className="text-[10px] border-slate-800">Review Stealth Backup</Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-2">
                        <p className="text-[10px] text-slate-400 mb-4 font-mono">Initialize your confidential settlement layer.</p>
                        <Button fullWidth variant="primary" icon="bolt" onClick={handleInitializeStealth}>Initialize Stealth Layer</Button>
                    </div>
                )}
            </div>

            {/* Compliance Section */}
            <div className="space-y-4 mb-6 bg-black/20 p-4 rounded border border-border-dark">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-border-dark pb-2 mb-2 flex items-center gap-2">
                    <Icon name="verified_user" className="text-xs" /> Compliance Verification
                </h4>
                
                <div className="py-2">
                    <WorldIdKit 
                        onSuccess={() => console.log("World ID Verified!")} 
                        signal={eoaAddress} 
                    />
                </div>

                <div className="space-y-2 pt-2 border-t border-border-dark/50">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-slate-400">Identity Persistence</span>
                        <span className="text-primary flex items-center gap-1">ACTIVE <Icon name="check_circle" className="text-[10px]" /></span>
                    </div>
                </div>
            </div>

            <p className="text-[8px] text-slate-600 font-mono uppercase tracking-[0.2em] text-center mt-8">
                Confidential Asset Protocol <span className="text-slate-800">//</span> Secured by Chainlink + World ID
            </p>
        </Modal>
    );
};