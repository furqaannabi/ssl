import React from 'react';
import { Modal, Button, Icon } from './UI';

export const ProfileModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Identity & Access">
            <div className="flex flex-col items-center mb-6 relative">
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent -z-10 rounded-full blur-xl transform -translate-y-4"></div>
                <div className="w-24 h-24 rounded-full border-2 border-primary/30 p-1 mb-3 relative group cursor-pointer">
                     <img src="https://picsum.photos/100/100" alt="Profile" className="w-full h-full rounded-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                     <div className="absolute bottom-0 right-0 bg-background-dark border border-primary rounded-full p-1 text-primary shadow-glow">
                        <Icon name="verified_user" className="text-sm block" />
                     </div>
                </div>
                <h2 className="text-lg font-bold text-white tracking-wide font-display">ALEXANDER K.</h2>
                <div className="flex items-center gap-2 mt-1">
                     <span className="text-xs font-mono text-slate-400 bg-surface-lighter px-2 py-1 rounded border border-border-dark flex items-center gap-2 cursor-pointer hover:text-white hover:border-slate-500 transition-colors active:scale-95 transform">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                        0x8A72...4F21 
                        <Icon name="content_copy" className="text-[10px] opacity-70" />
                     </span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-surface-lighter p-3 rounded border border-border-dark text-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="text-[10px] text-slate-500 uppercase mb-1 font-mono tracking-wider">Trading Tier</div>
                    <div className="text-sm font-bold text-white">INSTITUTIONAL</div>
                </div>
                <div className="bg-surface-lighter p-3 rounded border border-border-dark text-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="text-[10px] text-slate-500 uppercase mb-1 font-mono tracking-wider">Daily Limit</div>
                    <div className="text-sm font-bold text-primary">UNLIMITED</div>
                </div>
            </div>

            <div className="space-y-3 mb-6 bg-black/20 p-4 rounded border border-border-dark">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-border-dark pb-2 mb-2">Verification Status</h4>
                {[
                    { label: 'Email Verified', status: 'check_circle', color: 'text-primary' },
                    { label: '2FA Enabled (Yubikey)', status: 'check_circle', color: 'text-primary' },
                    { label: 'KYC Level 3 (Biometric)', status: 'check_circle', color: 'text-primary' },
                    { label: 'Institutional Whitelist', status: 'shield', color: 'text-primary' }
                ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-300">{item.label}</span>
                        <Icon name={item.status} className={`${item.color} text-sm`} />
                    </div>
                ))}
            </div>

            <Button fullWidth variant="danger" icon="logout" className="opacity-80 hover:opacity-100">Disconnect Session</Button>
        </Modal>
    );
};