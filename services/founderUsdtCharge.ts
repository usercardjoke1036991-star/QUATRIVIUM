/**
 * Cobra USDT a la fundadora por donar() desde la billetera interna.
 * La externa fondea la interna. El pool no se toca.
 */
import { Contract, parseEther, parseUnits, type Eip1193Provider } from 'ethers';
import { Alert, Linking } from 'react-native';
import { ERC20_ABI } from '../constants/contractConfig';
import { isOfficialWorldToken, type Token } from '../constants/tokens';
import {
  getProviderWithFallback,
  isAccessPaymentEnabled,
  isCreditReady,
  isDemoAccount,
  isDemoMode,
} from '../constants/rpcConfig';
import { showNotice } from '../utils/appNotice';
import { humanizeTxError } from '../utils/txErrors';
import { getEthersSignerFromProvider } from '../web3Config';
import { enviarToken } from './appWallet';
import { loadRequiredExternalWallet } from './linkedWallet';
import { beginExternalWalletHandoff } from './walletHandoff';
import { ensureExternalWalletOnAppChain } from '../utils/walletChain';
import { isAltaConfigured } from '../constants/altaConfig';
import { cachedProtocolCaps, QuatriviumCreditService } from './quatriviumCreditService';
import { recordMovement } from './movementHistory';
import type { TranslationKey } from '../i18n/translations';

const ARBITRUM_TESTNET_FAUCET = 'https://faucet.quicknode.com/arbitrum/sepolia';
const MIN_GAS_WEI = parseEther('0.0001');

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export type FounderChargeContext = {
  walletAddress: string;
  token: Token;
  founderAddress: string;
  canDonate: boolean;
  isTokenSupported: boolean;
  bnbBalance: string;
  adminConnected: boolean;
  adminProvider: unknown;
  adminAddress?: string;
  openExternalWallet?: () => void;
  confirmFunds: (purpose?: 'movement' | 'transfer') => Promise<boolean>;
  t: Translate;
  refetch?: () => void;
  silent?: boolean;
};

export type FounderChargeResult = 'paid' | 'cancelled' | 'failed';

async function readOnChainBnb(address: string): Promise<bigint | null> {
  try {
    return await getProviderWithFallback().getBalance(address);
  } catch {
    return null;
  }
}

async function tokenBalanceOf(token: string, wallet: string): Promise<bigint | null> {
  try {
    const erc20 = new Contract(token, ERC20_ABI, getProviderWithFallback());
    return BigInt(await erc20.balanceOf(wallet));
  } catch {
    return null;
  }
}

function askToLinkExternal(ctx: FounderChargeContext, message: string) {
  if (ctx.silent) return;
  showNotice(ctx.t('linkWalletTitle'), message, [
    { text: ctx.t('cancel'), style: 'cancel' },
    {
      text: ctx.t('connectWallet'),
      onPress: () => {
        beginExternalWalletHandoff();
        ctx.openExternalWallet?.();
      },
    },
  ]);
}

function alertUser(ctx: FounderChargeContext, title: string, body: string) {
  if (ctx.silent) return;
  Alert.alert(title, body);
}

async function requireLinkedExternal(ctx: FounderChargeContext): Promise<string> {
  if (!ctx.walletAddress) {
    alertUser(ctx, ctx.t('connect'), ctx.t('appWalletNotReady'));
    return '';
  }
  const linked = await loadRequiredExternalWallet(ctx.walletAddress);
  if (!linked) {
    askToLinkExternal(ctx, ctx.t('linkWalletNeedFunds'));
    return '';
  }
  if (!ctx.adminConnected || !ctx.adminProvider) {
    askToLinkExternal(ctx, ctx.t('linkWalletNeed'));
    return '';
  }
  if (String(ctx.adminAddress || '').toLowerCase() !== linked.toLowerCase()) {
    askToLinkExternal(ctx, ctx.t('linkWalletMismatch'));
    return '';
  }
  return linked;
}

async function ensureGasForTx(ctx: FounderChargeContext): Promise<boolean> {
  if (!ctx.walletAddress) return false;
  let onChain = await readOnChainBnb(ctx.walletAddress);
  if (onChain === null) {
    const parsed = Number.parseFloat(ctx.bnbBalance);
    onChain = Number.isFinite(parsed) && parsed > 0 ? parseEther(parsed.toFixed(6)) : 0n;
  }
  const demoGas = isDemoAccount() || isDemoMode();
  if (onChain < MIN_GAS_WEI) {
    if (!ctx.silent) {
      if (demoGas) {
        showNotice(ctx.t('errNeedGas'), ctx.t('errNeedGasTestnet'), [
          { text: ctx.t('cancel'), style: 'cancel' },
          {
            text: ctx.t('openFaucet'),
            onPress: () => void Linking.openURL(ARBITRUM_TESTNET_FAUCET),
          },
        ]);
      } else {
        showNotice(ctx.t('errNeedGas'), ctx.t('errNeedGas'));
      }
    }
    return false;
  }
  return true;
}

async function fundInternalFromExternal(
  ctx: FounderChargeContext,
  amountWei: string,
  tokenAddress: string
): Promise<boolean> {
  if (!ctx.walletAddress) return false;
  const need = BigInt(amountWei);
  if (need <= 0n) return false;
  const internalBal = await tokenBalanceOf(tokenAddress, ctx.walletAddress);
  if (internalBal !== null && internalBal >= need) {
    return true;
  }
  const linked = await requireLinkedExternal(ctx);
  if (!linked || !ctx.adminProvider) return false;
  try {
    await ensureExternalWalletOnAppChain(ctx.adminProvider as Eip1193Provider);
  } catch (error) {
    alertUser(ctx, ctx.t('connect'), humanizeTxError(error));
    return false;
  }
  const signer = await getEthersSignerFromProvider(ctx.adminProvider as Eip1193Provider);
  if (!signer) {
    alertUser(ctx, ctx.t('connect'), ctx.t('appWalletNotReady'));
    return false;
  }
  if (isDemoAccount()) {
    try {
      await QuatriviumCreditService.mintDemoUsdtTo(tokenAddress, linked, amountWei);
    } catch {
      // Si no hay minteo, se intenta con el saldo de la billetera vinculada.
    }
  }
  const extBal = await tokenBalanceOf(tokenAddress, linked);
  if (extBal !== null && extBal < need) {
    alertUser(
      ctx,
      ctx.t('amountExceedsBalance'),
      ctx.t('poolNeedInternalFunds', { symbol: ctx.token.symbol })
    );
    return false;
  }
  const extBnb = await readOnChainBnb(linked);
  if (extBnb !== null && extBnb < MIN_GAS_WEI) {
    if (!ctx.silent) showNotice(ctx.t('errNeedGasExternal'), ctx.t('errNeedGasExternal'));
    return false;
  }
  try {
    await enviarToken(signer, tokenAddress, ctx.walletAddress, amountWei, true);
    return true;
  } catch (error) {
    alertUser(ctx, ctx.t('error'), humanizeTxError(error));
    return false;
  }
}

/** Cobra USDT a la fundadora con donar(). Nunca deposita ni retira del pool. */
export async function chargeFounderUsdt(
  ctx: FounderChargeContext,
  amountUsdt: number
): Promise<FounderChargeResult> {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) return 'paid';
  if (!ctx.walletAddress) {
    alertUser(ctx, ctx.t('connect'), ctx.t('appWalletNotReady'));
    return 'failed';
  }
  if (!ctx.founderAddress) {
    alertUser(ctx, ctx.t('creditAccessTitle'), ctx.t('creditAccessPending'));
    return 'failed';
  }
  if (!isAccessPaymentEnabled() || !isCreditReady()) {
    alertUser(
      ctx,
      ctx.t('creditAccessTitle'),
      ctx.t(isDemoAccount() || isAltaConfigured() ? 'creditAccessPending' : 'liveCreditNotReady')
    );
    return 'failed';
  }
  if (!ctx.canDonate) {
    alertUser(ctx, ctx.t('creditAccessTitle'), ctx.t('creditAccessPending'));
    return 'failed';
  }
  if (!ctx.isTokenSupported && !isOfficialWorldToken(ctx.token.address)) {
    alertUser(ctx, ctx.t('token'), ctx.t('tokenNotEnabledAlert'));
    return 'failed';
  }
  const human = amount.toFixed(2);
  let amountWei: string;
  try {
    amountWei = parseUnits(human, ctx.token.decimals).toString();
  } catch {
    alertUser(ctx, ctx.t('amount'), ctx.t('invalidAmount'));
    return 'failed';
  }
  if (!ctx.silent && !(await ctx.confirmFunds('movement'))) return 'cancelled';
  if (!(await fundInternalFromExternal(ctx, amountWei, ctx.token.address))) return 'failed';
  if (!(await ensureGasForTx(ctx))) return 'failed';
  try {
    if (isAltaConfigured()) {
      await QuatriviumCreditService.pagarRegistroAlta(ctx.token.address);
    } else {
      await QuatriviumCreditService.donar(amountWei, ctx.token.address);
    }
    if (!ctx.silent) {
      void recordMovement(ctx.walletAddress, {
        kind: 'donation',
        from: ctx.walletAddress,
        to: '',
        amountLabel: `${human} ${ctx.token.symbol}`,
        tokenSymbol: ctx.token.symbol,
        platform: 'Quatrivium',
        timestamp: Date.now(),
      });
    }
    ctx.refetch?.();
    return 'paid';
  } catch (error) {
    alertUser(ctx, ctx.t('error'), humanizeTxError(error));
    return 'failed';
  }
}

/** Cobra USDT al pool con pagarVerificacion(). Sin fama. Nunca va a la fundadora. */
export async function chargePoolUsdt(
  ctx: FounderChargeContext,
  amountUsdt: number
): Promise<FounderChargeResult> {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) return 'paid';
  if (!ctx.walletAddress) {
    alertUser(ctx, ctx.t('connect'), ctx.t('appWalletNotReady'));
    return 'failed';
  }
  if (!isAccessPaymentEnabled() || !isCreditReady() || !cachedProtocolCaps().canPagarVerificacion) {
    alertUser(
      ctx,
      ctx.t('creditAccessTitle'),
      ctx.t(isDemoAccount() || isAltaConfigured() ? 'creditAccessPending' : 'liveCreditNotReady')
    );
    return 'failed';
  }
  if (!ctx.isTokenSupported && !isOfficialWorldToken(ctx.token.address)) {
    alertUser(ctx, ctx.t('token'), ctx.t('tokenNotEnabledAlert'));
    return 'failed';
  }
  const human = amount.toFixed(2);
  let amountWei: string;
  try {
    amountWei = parseUnits(human, ctx.token.decimals).toString();
  } catch {
    alertUser(ctx, ctx.t('amount'), ctx.t('invalidAmount'));
    return 'failed';
  }
  if (!ctx.silent && !(await ctx.confirmFunds('movement'))) return 'cancelled';
  if (!(await fundInternalFromExternal(ctx, amountWei, ctx.token.address))) return 'failed';
  if (!(await ensureGasForTx(ctx))) return 'failed';
  try {
    await QuatriviumCreditService.pagarVerificacion(amountWei, ctx.token.address);
    ctx.refetch?.();
    return 'paid';
  } catch (error) {
    alertUser(ctx, ctx.t('error'), humanizeTxError(error));
    return 'failed';
  }
}
