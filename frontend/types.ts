export enum View {
  DASHBOARD = 'DASHBOARD',
  TERMINAL = 'TERMINAL',
  COMPLIANCE = 'COMPLIANCE',
  HISTORY = 'HISTORY',
  GOVERNANCE = 'GOVERNANCE'
}

export interface NavItem {
  id: View;
  label: string;
  icon: string;
  iconType: 'outlined' | 'round' | 'filled';
}

export interface Asset {
  symbol: string;
  name: string;
  type: string;
  allocation: number;
  value: string;
  status: 'Active' | 'Encrypted' | 'Pending';
  icon: string;
  colorClass: string;
}

export interface Order {
  id: string;
  timestamp: string;
  asset: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  filled: number;
  total: number;
  price: string;
  status: 'SETTLED' | 'CANCELED' | 'PENDING';
  hash: string;
}

export interface ComplianceLog {
  timestamp: string;
  event: string;
  hash: string;
  status: 'VERIFIED' | 'CLEAN' | 'SIGNED' | 'LOGGED' | 'STORED' | 'COMPLETE';
  statusColor: string;
}