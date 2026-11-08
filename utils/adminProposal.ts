import { Interface } from 'ethers';
import { CONTRACT_ABI } from '../constants/contractConfig';

const iface = new Interface(CONTRACT_ABI);

export interface OpenAdminProposal {
  id: number;
  selector: string;
  eta: number;
  confirms: number;
  executed: boolean;
  cancelled: boolean;
  proposer: string;
}

export function describeAdminCalldata(data: string): string {
  try {
    const parsed = iface.parseTransaction({ data });
    return parsed?.name || data.slice(0, 10);
  } catch {
    return data.slice(0, 10);
  }
}
