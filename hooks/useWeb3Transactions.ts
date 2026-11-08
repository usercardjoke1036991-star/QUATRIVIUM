import { useState, useRef } from 'react';
import { showNotice } from '../utils/appNotice';
import { QuatriviumCreditService } from '../services/quatriviumCreditService';
import { humanizeTxError } from '../utils/txErrors';
import { parseInviteInput } from '../utils/inviteCode';
import { useI18n } from '../i18n/LanguageContext';

export interface TransactionResult {
  success: boolean;
  error?: string;
}

export const useWeb3Transactions = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const busyRef = useRef(false);
  const { t } = useI18n();

  const executeTransaction = async (
    actionName: string,
    transactionFn: () => Promise<unknown>,
    successMessage?: string
  ): Promise<TransactionResult> => {
    if (busyRef.current) {
      showNotice(t('error'), t('txBusy'));
      return { success: false, error: 'busy' };
    }
    busyRef.current = true;
    setIsLoading(true);
    setCurrentAction(actionName);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        transactionFn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('tx-timeout')), 90_000);
        }),
      ]);
      showNotice(t('ready'), successMessage || t('txConfirmed', { action: actionName }));
      return { success: true };
    } catch (error: unknown) {
      const errorMessage = humanizeTxError(error);
      showNotice(t('error'), errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      if (timer) clearTimeout(timer);
      busyRef.current = false;
      setIsLoading(false);
      setCurrentAction(null);
    }
  };

  const registrarHumano = async (walletAddress: string, padre?: string) => {
    if (!walletAddress) {
      showNotice(t('connect'), t('connectFirst'));
      return { success: false, error: 'Wallet not connected' };
    }

    const resolved = parseInviteInput(padre);
    if (padre?.trim() && resolved === null) {
      showNotice(t('invite'), t('invalidSponsor'));
      return { success: false, error: 'invalid padre' };
    }
    const sponsor = resolved || undefined;
    if (sponsor && sponsor.toLowerCase() === walletAddress.toLowerCase()) {
      showNotice(t('invite'), t('cannotSelfInvite'));
      return { success: false, error: 'self referral' };
    }

    return executeTransaction(
      'registrarHumano',
      () => QuatriviumCreditService.registrarHumano(walletAddress, sponsor),
      t('creditActivated')
    );
  };

  const solicitarPrestamo = async (tokenAddress: string, nivel = 0) => {
    return executeTransaction(
      'solicitarPrestamo',
      () => QuatriviumCreditService.solicitar(tokenAddress, nivel),
      t('loanIssued')
    );
  };

  const cobrarBonoHito = async (tokenAddress: string) => {
    return executeTransaction(
      'cobrarBonoHito',
      () => QuatriviumCreditService.cobrarBonoHito(tokenAddress),
      t('claimPoolBonus')
    );
  };

  const donarProyecto = async (amountWei: string, tokenAddress: string) => {
    return executeTransaction(
      'donar',
      () => QuatriviumCreditService.donar(amountWei, tokenAddress),
      t('donateThanks')
    );
  };

  const canjearFama = async (fama: number) => {
    return executeTransaction(
      'canjearFama',
      () => QuatriviumCreditService.canjearFama(fama),
      t('canjeSuccess')
    );
  };

  const canjearFamaRed = async (fama: number) => {
    return executeTransaction(
      'canjearFamaRed',
      () => QuatriviumCreditService.canjearFamaRed(fama),
      t('canjeSuccess')
    );
  };

  const cobrarBonoRacha = async () => {
    return executeTransaction(
      'cobrarBonoRacha',
      () => QuatriviumCreditService.cobrarBonoRacha(),
      t('rachaClaimedOk')
    );
  };

  const pagarPrestamo = async (amountWei: string, tokenAddress: string) => {
    return executeTransaction(
      'pagarPrestamo',
      () => QuatriviumCreditService.pagar(amountWei, tokenAddress),
      t('paymentConfirmed')
    );
  };

  const pagarCuotas = async (count: number, tokenAddress: string) => {
    return executeTransaction(
      'pagarPrestamo',
      () => QuatriviumCreditService.pagarCuotas(tokenAddress, count),
      t('paymentConfirmed')
    );
  };

  const depositarLiquidez = async (amountWei: string, tokenAddress: string) => {
    return executeTransaction(
      'depositarLiquidez',
      () => QuatriviumCreditService.depositar(amountWei, tokenAddress),
      t('liquidityDeposited')
    );
  };

  const retirarLiquidez = async () => {
    showNotice(t('error'), t('poolLockedNote'));
    return { success: false, error: 'pool locked' } as TransactionResult;
  };

  const retirarComisiones = async () => {
    return executeTransaction(
      'retirarComisiones',
      () => QuatriviumCreditService.retirarComisiones(),
      t('adminTimelockProposed')
    );
  };

  const retirarComisionesToken = async (tokenAddress: string) => {
    return executeTransaction(
      'retirarComisionesToken',
      () => QuatriviumCreditService.retirarComisionesToken(tokenAddress),
      t('adminTimelockProposed')
    );
  };

  const cancelAdminAction = async (id: number) => {
    return executeTransaction(
      'cancelAdminAction',
      () => QuatriviumCreditService.cancelAdminAction(id),
      t('cancelAdminDone')
    );
  };

  const confirmAdminAction = async (id: number) => {
    return executeTransaction(
      'confirmAdminAction',
      () => QuatriviumCreditService.confirmAdminAction(id),
      t('confirmAdminDone')
    );
  };

  const proposeAddAdmin = async (address: string) => {
    return executeTransaction(
      'addAdmin',
      () => QuatriviumCreditService.proposeAddAdmin(address),
      t('adminTimelockProposed')
    );
  };

  const proposeRemoveAdmin = async (address: string) => {
    return executeTransaction(
      'removeAdmin',
      () => QuatriviumCreditService.proposeRemoveAdmin(address),
      t('adminTimelockProposed')
    );
  };

  const proposeFeeCollector = async (address: string) => {
    return executeTransaction(
      'setFeeCollector',
      () => QuatriviumCreditService.proposeFeeCollector(address),
      t('adminTimelockProposed')
    );
  };

  const proposeFundador = async (address: string) => {
    return executeTransaction(
      'setFundador',
      () => QuatriviumCreditService.proposeFundador(address),
      t('adminTimelockProposed')
    );
  };

  const proposeOwner = async (address: string) => {
    return executeTransaction(
      'setOwner',
      () => QuatriviumCreditService.proposeOwner(address),
      t('adminTimelockProposed')
    );
  };

  const proposeRequiredConfirmations = async (required: number) => {
    return executeTransaction(
      'setRequiredConfirmations',
      () => QuatriviumCreditService.proposeRequiredConfirmations(required),
      t('adminTimelockProposed')
    );
  };

  const proposeSetTokenConfig = async (token: string, feed: string, enabled: boolean) => {
    return executeTransaction(
      'setTokenConfig',
      () => QuatriviumCreditService.proposeSetTokenConfig(token, feed, enabled),
      t('adminTimelockProposed')
    );
  };

  const executeAdminAction = async (id: number) => {
    return executeTransaction(
      'executeAdminAction',
      () => QuatriviumCreditService.executeAdminAction(id),
      t('executeAdminDone')
    );
  };

  const liquidarDeudor = async (debtorAddress: string, tokenAddress: string) => {
    return executeTransaction(
      'liquidarDeudor',
      () => QuatriviumCreditService.liquidar(debtorAddress, tokenAddress),
      t('liquidarDone')
    );
  };

  const marcarMorosoSiVencido = async (debtorAddress: string) => {
    return executeTransaction(
      'marcarMorosoSiVencido',
      () => QuatriviumCreditService.marcarMorosoSiVencido(debtorAddress),
      t('adminTimelockProposed')
    );
  };

  return {
    isLoading,
    currentAction,
    executeTransaction,
    registrarHumano,
    solicitarPrestamo,
    cobrarBonoHito,
    donarProyecto,
    canjearFama,
    canjearFamaRed,
    cobrarBonoRacha,
    pagarPrestamo,
    pagarCuotas,
    depositarLiquidez,
    retirarLiquidez,
    retirarComisiones,
    retirarComisionesToken,
    cancelAdminAction,
    executeAdminAction,
    confirmAdminAction,
    proposeAddAdmin,
    proposeRemoveAdmin,
    proposeFeeCollector,
    proposeRequiredConfirmations,
    proposeSetTokenConfig,
    proposeFundador,
    proposeOwner,
    liquidarDeudor,
    marcarMorosoSiVencido,
  };
};
