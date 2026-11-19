import { Interface } from 'ethers';
import { CONTRACT_ABI } from '../constants/contractConfig';

const iface = new Interface(CONTRACT_ABI);

export type AdminActionKey =
  | 'adminActionAdd'
  | 'adminActionRemove'
  | 'adminActionPause'
  | 'adminActionUnknown';

export interface OpenAdminProposal {
  id: number;
  selector: string;
  actionKey: AdminActionKey;
  target: string;
  eta: number;
  confirms: number;
  executed: boolean;
  cancelled: boolean;
  proposer: string;
}

export interface DecodedAdminAction {
  name: string;
  actionKey: AdminActionKey;
  target: string;
}

const ACTION_KEYS: Record<string, AdminActionKey> = {
  addAdmin: 'adminActionAdd',
  removeAdmin: 'adminActionRemove',
  pausarPrestamosNuevos: 'adminActionPause',
};

export function decodeAdminCalldata(data: string): DecodedAdminAction {
  try {
    const parsed = iface.parseTransaction({ data });
    if (!parsed) {
      return { name: '', actionKey: 'adminActionUnknown', target: data.slice(0, 10) };
    }
    const name = parsed.name;
    const target =
      name === 'addAdmin' || name === 'removeAdmin' ? String(parsed.args[0] || '') : '';
    return { name, actionKey: ACTION_KEYS[name] || 'adminActionUnknown', target };
  } catch {
    return { name: '', actionKey: 'adminActionUnknown', target: data.slice(0, 10) };
  }
}

export function describeAdminCalldata(data: string): string {
  const decoded = decodeAdminCalldata(data);
  return decoded.name || decoded.target;
}
