import { AbiCoder, id } from 'ethers';

const SELECTOR = id('certificadoFirma()').slice(0, 10);

export async function readPublishedCert(
  provider: { call: (tx: { to: string; data: string }) => Promise<string> },
  address: string
): Promise<string> {
  if (!address) return '';
  const raw = await provider.call({ to: address, data: SELECTOR });
  if (!raw || raw === '0x' || raw.length < 66) return '';
  const [cert] = AbiCoder.defaultAbiCoder().decode(['bytes32'], raw);
  return String(cert);
}
