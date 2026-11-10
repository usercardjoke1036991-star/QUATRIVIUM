import { isDemoAccount } from '../constants/rpcConfig';
import type { Lang } from '../i18n/languages';
import { translations, type TranslationKey } from '../i18n/translations';

function emptyRevertKey(): TranslationKey {
  return isDemoAccount() ? 'errEmptyRevertDemo' : 'errEmptyRevert';
}

/** Demo y Real no comparten el texto de red. humanizeTxError lo traduce. */
export function networkFailureError(demo: boolean): Error {
  return new Error(demo ? 'wrong-network-demo' : 'wrong-network');
}

function extractRawError(error: unknown): string {
  const err = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
    info?: { error?: { message?: string } };
  };

  return String(
    err?.shortMessage || err?.reason || err?.info?.error?.message || err?.message || ''
  );
}

const REVERT_KEYS: [string, TranslationKey][] = [
  ['kyc required', 'errKycRequired'],
  ['identity required', 'errIdentityRequired'],
  ['email-required', 'errEmailRequired'],
  ['access-required', 'creditAccessNeed'],
  ['phrase-required', 'seedNeedBeforeLoan'],
  ['phone taken', 'errPhoneTaken'],
  ['device taken', 'errDeviceTaken'],
  ['device-bound', 'errDeviceBound'],
  ['wallet-persist', 'errWalletPersist'],
  ['password-persist', 'errWalletPersist'],
  ['wallet-other-app', 'errWalletOtherApp'],
  ['device-mismatch', 'seedNeedDevice'],
  ['already bound', 'errAlreadyBound'],
  ['already registered', 'errAlreadyRegistered'],
  ['padre not registered', 'errPadreNotRegistered'],
  ['bad attest', 'errBadAttest'],
  ['expired', 'errExpired'],
  ['daily origination cap', 'errDailyCap'],
  ['utilization cap', 'errUtilizationCap'],
  ['loan already active', 'errLoanAlreadyActive'],
  ['no price feed', 'errNoPriceFeed'],
  ['no contracts', 'errNoContracts'],
  ['only timelock', 'errOnlyTimelock'],
  ['timelock', 'errTimelock'],
  ['confirmations', 'errConfirmations'],
  ['selector not allowed', 'errSelector'],
  ['usuario moroso', 'errDelinquent'],
  ['active loan', 'errActiveLoanDestroy'],
  ['dead', 'errDead'],
  ['founder', 'errFounderDestroy'],
  ['cooldown 48h', 'errCooldown48h'],
  ['insufficient liquidity', 'errInsufficientLiquidity'],
  ['peg lost', 'errPegLost'],
  ['price data too stale', 'errStalePrice'],
  ['unsupported token', 'errUnsupportedToken'],
  ['token mismatch', 'errTokenMismatch'],
  ['insufficient amount', 'errInsufficientAmount'],
  ['no active loan', 'errNoActiveLoan'],
  ['exceeds lp share', 'errExceedsLp'],
  ['liquidity in use', 'errLiquidityInUse'],
  ['insufficient cash', 'errInsufficientCash'],
  ['insufficient pool', 'errInsufficientPool'],
  ['can only self-register', 'errSelfRegister'],
  ['blacklisted', 'errBlacklisted'],
  ['only owner', 'errOnlyOwner'],
  ['only admin', 'errOnlyAdmin'],
  ['no token fees', 'errNoTokenFees'],
  ['no native balance', 'errNoNative'],
  ['EnforcedPause', 'errPaused'],
  ['RPC chain mismatch', 'errRpcMismatch'],
  ['El RPC no ve el contrato', 'errRpcNoContract'],
  ['rpc-money-mismatch', 'rpcMoneyUnconfirmed'],
  ['wrong-network-demo', 'linkWalletNetworkDemo'],
  ['wrong-network', 'errWrongNetwork'],
  ['La billetera está en otra red', 'errWrongNetwork'],
  ['La billetera no reporta red', 'errWrongNetwork'],
  ['INSUFFICIENT_FUNDS', 'errNeedGas'],
  ['insufficient funds', 'errNeedGas'],
  ['platform-fee-bnb', 'errNeedGas'],
  ['demo-identity', 'demoPrepFailed'],
  ['attester', 'demoPrepFailed'],
  ['notify', 'otpNeedApi'],
  ['rate', 'otpRate'],
  ['internal-wallet-only', 'errInternalOnly'],
  ['no-admin-proposal', 'errNoAdminProposal'],
  ['tx-timeout', 'txWaitTimeout'],
  ['tx-reverted', 'txFailed'],
  ['user rejected', 'errRejected'],
  ['User rejected', 'errRejected'],
  ['rejected methods', 'errRejected'],
  ['User denied', 'errRejected'],
  ['user denied', 'errRejected'],
  ['denied transaction', 'errRejected'],
  ['ACTION_REJECTED', 'errRejected'],
  ['4001', 'errRejected'],
  ['no-wallet', 'errNoWallet'],
  ['No hay billetera conectada', 'errNoWallet'],
  ['invalid-amount', 'errInvalidAmount'],
  ['Monto inválido', 'errInvalidAmount'],
  ['token-not-in-app', 'errTokenNotInApp'],
  ['donate-real-only', 'donateRealOnly'],
  ['access-not-ready', 'creditAccessPending'],
  ['pool-real-only', 'poolRealOnly'],
  ['canje-legacy', 'canjeLegacy'],
  ['FamaInvalida', 'errInvalidAmount'],
  ['SinFama', 'canjeNeedPoints'],
  ['SoloEOA', 'errInternalOnly'],
  ['NoHumano', 'errBlacklisted'],
  ['CreditoPausado', 'errPaused'],
  ['Este token no está habilitado en la aplicación', 'errTokenNotInApp'],
  ['invalid-level', 'errInvalidLevel'],
  ['Nivel inválido', 'errInvalidLevel'],
  ['Cuotas inválidas', 'errInvalidAmount'],
  ['invalid address', 'adminInvalidAddress'],
  ['invalid feed', 'adminInvalidAddress'],
  ['pool locked', 'poolLockedNote'],
  ['weak-pin', 'lockPinWeak'],
  ['weak-password', 'lockPasswordWeak'],
  ['password-key', 'lockPasswordPrivateKey'],
  ['wrong-pin', 'lockPinWrong'],
  ['appWalletNotReady', 'appWalletNotReady'],
  ['appWalletBadAddress', 'appWalletBadAddress'],
  ['notify', 'otpNeedApi'],
  ['Contrato no configurado', 'configureContract'],
  ['no data present', 'errEmptyRevert'],
  ['missing revert data', 'errEmptyRevert'],
  ['require(false)', 'errEmptyRevert'],
];

let errorLang: Lang = 'es';

export function setTxErrorLang(lang: Lang) {
  errorLang = lang;
}

export function humanizeTxError(error: unknown): string {
  const raw = extractRawError(error);
  const table = translations[errorLang] || translations.es;
  const match = REVERT_KEYS.find(([needle]) => raw.includes(needle));
  if (match) {
    const key = match[1] === 'errEmptyRevert' ? emptyRevertKey() : match[1];
    return table[key];
  }
  if (/execution reverted/i.test(raw) && !/execution reverted:\s+\S/i.test(raw)) {
    return table[emptyRevertKey()];
  }
  const trimmed = raw.replace(/^Error:\s*/i, '').trim();
  return trimmed.slice(0, 280) || table.txFailed;
}
