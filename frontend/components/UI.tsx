import React, { useEffect, useState } from 'react';
import { 
  Shield, 
  CandlestickChart, 
  PieChart, 
  ShieldCheck, 
  History, 
  Settings, 
  Link, 
  Fingerprint, 
  X,
  User,
  Activity,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Info,
  ChevronDown,
  Calendar,
  Search,
  Download,
  Copy,
  BadgeCheck,
  Key,
  EyeOff,
  Cpu,
  Terminal,
  FileText,
  Lock,
  IdCard,
  Cloud,
  Zap,
  Landmark,
  TrendingUp,
  Table,
  Filter,
  Building,
  Coins,
  Wallet,
  Sliders,
  Network,
  Check,
  Plus
} from 'lucide-react';

// Icon Mapping
const iconMap: Record<string, React.ElementType> = {
  // Navigation & Core
  security: Shield,
  candlestick_chart: CandlestickChart,
  pie_chart: PieChart,
  verified_user: ShieldCheck,
  history: History,
  settings: Settings,
  link: Link,
  shield: Shield,
  fingerprint: Fingerprint,
  close: X,
  add: Plus,
  
  // Actions & Status
  check: Check,
  check_circle: CheckCircle,
  warning: AlertTriangle, 
  help: HelpCircle,
  info: Info,
  expand_more: ChevronDown,
  calendar_today: Calendar,
  search: Search,
  download: Download,
  content_copy: Copy,
  verified: BadgeCheck,
  vpn_key: Key,
  visibility_off: EyeOff,
  memory: Cpu,
  terminal: Terminal,
  list_alt: FileText,
  lock: Lock,
  
  // Business & Assets
  badge: IdCard,
  cloud_sync: Cloud,
  bolt: Zap,
  account_balance: Landmark,
  trending_up: TrendingUp,
  table_chart: Table,
  filter_list: Filter,
  apartment: Building,
  token: Coins,
  account_balance_wallet: Wallet,
  tune: Sliders,
  hub: Network,
  
  // Fallbacks
  user: User,
  activity: Activity,
};

// Icon Component
interface IconProps extends React.ComponentProps<'svg'> {
  name: string;
  type?: 'outlined' | 'round' | 'filled' | 'sharp'; // Kept for prop compatibility but unused by Lucide
  className?: string;
  size?: number | string;
}

export const Icon: React.FC<IconProps> = ({ name, className = '', size, ...props }) => {
  const LucideIcon = iconMap[name] || HelpCircle; // Default to HelpCircle if icon not found
  
  // Extract color classes to pass to the icon if needed, though usually className handles it.
  // Lucide icons inherit color from current text color (currentColor) by default.
  
  return <LucideIcon className={className} size={typeof size === 'number' ? size : undefined} {...props} />;
};

// Badge Component
interface BadgeProps {
  label: string;
  color?: 'primary' | 'red' | 'yellow' | 'blue' | 'slate';
  icon?: string;
  pulse?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({ label, color = 'primary', icon, pulse = false }) => {
  const colors = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    red: 'bg-red-500/10 text-red-500 border-red-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    blue: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    slate: 'bg-slate-800 text-slate-400 border-slate-700',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[color]}`}>
      {pulse && <span className={`w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse ${color === 'primary' ? 'bg-primary' : `bg-${color}-500`}`}></span>}
      {icon && <Icon name={icon} className="text-[10px] mr-1" />}
      {label}
    </span>
  );
};

// Card Component
export const Card: React.FC<{ children: React.ReactNode; className?: string; noPadding?: boolean }> = ({ children, className = '', noPadding = false }) => {
  return (
    <div className={`bg-surface-dark border border-border-dark rounded overflow-hidden relative ${className}`}>
      {children}
    </div>
  );
};

// Button Component
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: string;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', icon, fullWidth, className = '', ...props }) => {
  const variants = {
    primary: 'bg-primary  text-black hover:bg-primary-dark font-semibold shadow-glow',
    secondary: 'bg-slate-800 text-white hover:bg-slate-700 border border-slate-600',
    ghost: 'bg-transparent text-slate-400 hover:text-white hover:bg-white/5',
    danger: 'bg-red-900/20 text-red-500 border border-red-900/50 hover:bg-red-900/40',
  };

  return (
    <button 
      className={`
        flex items-center justify-center px-4 py-2 rounded text-sm transition-all cursor-pointer active:translate-y-[1px]
        ${variants[variant]} 
        ${fullWidth ? 'w-full' : ''} 
        ${className}
      `}
      {...props}
    >
      {icon && <Icon name={icon} className="text-lg mr-2" />}
      {children}
    </button>
  );
};

// Modal Component
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      <div className="relative w-full max-w-md z-10 animate-appear">
        <Card className="shadow-2xl ring-1 ring-border-dark bg-surface-dark">
             <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark bg-surface-lighter/50">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-glow"></span>
                    {title}
                </h3>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors flex items-center">
                    <Icon name="close" className="text-lg" />
                </button>
             </div>
             <div className="p-6 max-h-[85vh] overflow-y-auto">
                {children}
             </div>
        </Card>
      </div>
    </div>
  );
};

// Toast System
interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

const ToastContext = React.createContext<{
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
} | null>(null);

export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: ToastMessage['type'], message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), 3000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const value = {
    toast: {
      success: (msg: string) => addToast('success', msg),
      error: (msg: string) => addToast('error', msg),
      info: (msg: string) => addToast('info', msg),
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div 
            key={t.id} 
            className={`
              flex items-center gap-3 px-4 py-3 rounded shadow-2xl border backdrop-blur-md animate-in slide-in-from-right-10 fade-in duration-300
              ${t.type === 'success' ? 'bg-primary/10 border-primary/30 text-primary' : 
                t.type === 'error' ? 'bg-red-900/10 border-red-500/30 text-red-500' : 
                'bg-slate-800/80 border-slate-700 text-white'}
            `}
          >
            <Icon 
              name={t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'warning' : 'info'} 
              className="text-lg"
            />
            <span className="text-xs font-mono font-bold uppercase tracking-wide">{t.message}</span>
            <button onClick={() => removeToast(t.id)} className="hover:opacity-70">
              <Icon name="close" className="text-xs" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// Toggle Component
export const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <div className="flex items-center justify-between py-3 border-b border-border-dark/50 last:border-0 hover:bg-white/5 px-2 -mx-2 rounded transition-colors cursor-pointer" onClick={() => onChange(!checked)}>
        <span className="text-xs text-slate-300 font-mono uppercase tracking-wide">{label}</span>
        <button 
            className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-primary/20 border-primary' : 'bg-slate-800 border-slate-700'} border`}
        >
            <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${checked ? 'left-4.5 bg-primary shadow-glow' : 'left-0.5 bg-slate-500'}`} style={{ left: checked ? '1.1rem' : '0.15rem' }}></div>
        </button>
    </div>
);