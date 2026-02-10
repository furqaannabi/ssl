import React, { useState } from 'react';
import { Modal, Toggle, Button, Icon } from './UI';

export const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const [sound, setSound] = useState(true);
    const [notifications, setNotifications] = useState(true);
    const [autoSign, setAutoSign] = useState(false);
    const [streamData, setStreamData] = useState(true);
    const [darkMode, setDarkMode] = useState(true);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="System Configuration">
            <div className="space-y-6">
                <div>
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Icon name="tune" className="text-xs" /> Interface
                    </h4>
                    <div className="bg-surface-lighter rounded border border-border-dark px-3">
                        <Toggle label="Sound Effects (Haptic)" checked={sound} onChange={setSound} />
                        <Toggle label="Push Notifications" checked={notifications} onChange={setNotifications} />
                        <Toggle label="High Contrast Mode" checked={darkMode} onChange={setDarkMode} />
                    </div>
                </div>
                
                <div>
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Icon name="memory" className="text-xs" /> Trading Engine
                    </h4>
                    <div className="bg-surface-lighter rounded border border-border-dark px-3">
                        <Toggle label="Auto-Sign Transactions" checked={autoSign} onChange={setAutoSign} />
                        <Toggle label="Stream L2 Orderbook" checked={streamData} onChange={setStreamData} />
                    </div>
                </div>

                <div>
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                         <Icon name="hub" className="text-xs" /> RPC Connection
                    </h4>
                    <div className="flex items-center gap-2 bg-black border border-border-dark p-2.5 rounded group hover:border-primary/50 transition-colors">
                        <div className="w-2 h-2 bg-primary rounded-full animate-pulse shadow-glow"></div>
                        <input type="text" value="wss://mainnet.infura.io/ws/v3/..." className="bg-transparent border-none text-xs font-mono text-slate-400 w-full focus:ring-0 p-0" readOnly />
                        <Icon name="lock" className="text-xs text-slate-600 group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>Latency: 14ms</span>
                        <span>Block: 18402911</span>
                    </div>
                </div>

                <div className="pt-2">
                    <Button fullWidth variant="secondary" onClick={onClose} className="border-primary/30 hover:border-primary text-primary hover:bg-primary/10">
                        Apply & Save Configuration
                    </Button>
                </div>
            </div>
        </Modal>
    );
};