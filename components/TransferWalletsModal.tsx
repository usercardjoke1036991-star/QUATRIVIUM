import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScreenScroll } from '../hooks/useScreenScroll';
import { parseUnits, type Eip1193Provider } from 'ethers';
import { useAccount, useAppKit, useProvider } from '@reown/appkit-react-native';
import { getEthersSignerFromProvider } from '../web3Config';
import { enviarBnb, enviarToken, loadAppWallet } from '../services/appWallet';
import { hasLinkedExternalWallet, loadRequiredExternalWallet } from '../services/linkedWallet';
import { recordMovement } from '../services/movementHistory';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useFundsConfirm } from './FundsConfirmHost';
import { formatAddress, parsePositiveDecimal } from '../utils/formatters';
import { humanizeTxError } from '../utils/txErrors';
import { ensureExternalWalletOnAppChain } from '../utils/walletChain';
import { copyText } from '../utils/copyText';
import { openWalletConnect } from '../utils/openWalletConnect';
import { BrandLogo } from './BrandLogo';
import { LinkWalletForm } from './LinkWalletForm';
import type { Token } from '../constants/tokens';
import { AppText, AppTextInput } from './AppText';

interface TransferWalletsModalProps {
  visible: boolean;
  mode: 'in' | 'out';
  walletAddress: string;
  tokenBalance: string;
  bnbBalance: string;
  selectedToken: Token;
  isLoading: boolean;
  onClose: () => void;
  onSent: () => void;
}

export const TransferWalletsModal: React.FC<TransferWalletsModalProps> = ({
  visible,
  mode,
  walletAddress,
  tokenBalance,
  bnbBalance,
  selectedToken,
  isLoading,
  onClose,
  onSent,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { scrollHeight, scrollRef, frameRef, scrollY, keyboardPad } = useScreenScroll(visible);
  const { confirmFunds } = useFundsConfirm();
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { provider } = useProvider();
  const [linked, setLinked] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'token' | 'bnb'>('token');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    loadRequiredExternalWallet(walletAddress)
      .then((stored) => {
        if (!live) return;
        setLinked(stored && hasLinkedExternalWallet(stored) ? stored : '');
      })
      .catch(() => {
        if (live) setLinked('');
      });
    return () => {
      live = false;
    };
  }, [visible, walletAddress, address, isConnected]);

  const close = () => {
    setAmount('');
    setAsset('token');
    onClose();
  };

  const send = async (direction: 'in' | 'out') => {
    if (busy) return;
    const parsed = parsePositiveDecimal(amount);
    if (!parsed) {
      Alert.alert(t('amount'), t('invalidAmount'));
      return;
    }
    if (!linked) {
      Alert.alert(t('linkWalletTitle'), t('linkWalletNeedFunds'));
      return;
    }
    const decimals = asset === 'bnb' ? 18 : selectedToken.decimals;
    try {
      if (direction === 'out') {
        const available = parseUnits(
          asset === 'bnb' ? bnbBalance || '0' : tokenBalance || '0',
          decimals
        );
        if (parseUnits(parsed, decimals) > available) {
          Alert.alert(t('amount'), t('amountExceedsBalance'));
          return;
        }
      }
    } catch {
      Alert.alert(t('amount'), t('invalidAmount'));
      return;
    }
    const to = direction === 'in' ? walletAddress || '' : linked;
    if (
      !(await confirmFunds('transfer', {
        amount: parsed,
        symbol: asset === 'bnb' ? 'ETH' : 'LUSD',
        destination: to,
        fee: '0.0002 ETH',
      }))
    )
      return;
    setBusy(true);
    try {
      const amountWei = parseUnits(parsed, decimals).toString();
      let from = walletAddress;
      let to = linked;
      if (direction === 'in') {
        if (
          !isConnected ||
          !provider ||
          String(address || '').toLowerCase() !== linked.toLowerCase()
        ) {
          Alert.alert(t('linkWalletTitle'), t('linkWalletMismatch'));
          void openWalletConnect(open);
          return;
        }
        const signer = await getEthersSignerFromProvider(provider as Eip1193Provider);
        if (!signer) {
          Alert.alert(t('error'), t('appWalletNotReady'));
          return;
        }
        from = linked;
        to = walletAddress;
        try {
          await ensureExternalWalletOnAppChain(provider as Eip1193Provider);
        } catch (error) {
          Alert.alert(t('connect'), humanizeTxError(error));
          return;
        }
        if (asset === 'bnb') await enviarBnb(signer, to, amountWei, true);
        else await enviarToken(signer, selectedToken.address, to, amountWei, true);
      } else {
        const signer = await loadAppWallet();
        if (!signer) {
          Alert.alert(t('error'), t('appWalletNotReady'));
          return;
        }
        if (asset === 'bnb') await enviarBnb(signer, to, amountWei);
        else await enviarToken(signer, selectedToken.address, to, amountWei);
      }
      await recordMovement(walletAddress, {
        kind: direction === 'in' ? 'transfer_in' : 'transfer_out',
        from,
        to,
        amountLabel: `${parsed} ${asset === 'bnb' ? 'ETH' : selectedToken.symbol}`,
        tokenSymbol: asset === 'bnb' ? 'ETH' : selectedToken.symbol,
        platform: 'Arbitrum One',
        timestamp: Date.now(),
      });
      Alert.alert(t('ready'), t('appWalletSent'));
      setAmount('');
      onSent();
      close();
    } catch (error) {
      Alert.alert(t('error'), humanizeTxError(error));
    } finally {
      setBusy(false);
    }
  };

  const blocked = busy || isLoading;
  const title = mode === 'in' ? t('appWalletInTitle') : t('appWalletSendTitle');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} accessibilityRole="button">
            <AppText style={[styles.back, { color: colors.primary }]}>{t('settingsBack')}</AppText>
          </TouchableOpacity>
          <AppText style={[styles.title, { color: colors.text }]}>{title}</AppText>
          <View style={styles.spacer} />
        </View>
        <View ref={frameRef} style={{ height: scrollHeight }}>
          <ScrollView
            ref={scrollRef}
            style={{ height: scrollHeight }}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={[
              styles.body,
              keyboardPad > 0 ? { paddingBottom: 24 + keyboardPad } : null,
            ]}
            onScroll={(event) => {
              scrollY.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            {!linked ? (
              <>
                <AppText style={[styles.lead, { color: colors.textMuted }]}>
                  {t('linkWalletNeedFunds')}
                </AppText>
                <LinkWalletForm
                  internalWallet={walletAddress}
                  allowSkip={false}
                  onLinked={(external) => {
                    if (hasLinkedExternalWallet(external)) setLinked(external);
                  }}
                />
              </>
            ) : (
              <View>
                <View style={styles.chosen}>
                  <BrandLogo size={40} />
                  <AppText style={[styles.chosenName, { color: colors.text }]}>
                    {t('appWalletLabel')}
                  </AppText>
                </View>
                <AppText style={[styles.lead, { color: colors.textMuted }]}>
                  {mode === 'in' ? t('appWalletInLead') : t('appWalletSendLead')}
                </AppText>
                <AppText style={[styles.meta, { color: colors.text }]}>
                  {mode === 'in' ? t('yourWallet') : t('appWalletDestination')}{' '}
                  {formatAddress(mode === 'in' ? walletAddress : linked)}
                </AppText>
                {mode === 'in' ? (
                  <>
                    <AppText
                      selectable
                      style={[
                        styles.address,
                        { color: colors.text, backgroundColor: colors.surface },
                      ]}
                    >
                      {walletAddress}
                    </AppText>
                    <TouchableOpacity
                      style={[styles.send, { backgroundColor: colors.connect, marginTop: 12 }]}
                      onPress={() => {
                        void copyText(walletAddress).then((result) => {
                          if (result === 'copied') Alert.alert(t('ready'), t('addressCopied'));
                          else if (result === 'failed') Alert.alert(t('wallet'), walletAddress);
                        });
                      }}
                    >
                      <AppText style={styles.sendText}>{t('copyAddress')}</AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.send, { backgroundColor: colors.primary, marginTop: 8 }]}
                      onPress={() => Share.share({ message: walletAddress }).catch(() => {})}
                    >
                      <AppText style={styles.sendText}>{t('appWalletShare')}</AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.send, { backgroundColor: colors.chip, marginTop: 8 }]}
                      onPress={() => void openWalletConnect(open)}
                    >
                      <AppText style={[styles.sendText, { color: colors.text }]}>
                        {t('connectWallet')}
                      </AppText>
                    </TouchableOpacity>
                  </>
                ) : (
                  <AppText
                    selectable
                    style={[
                      styles.address,
                      { color: colors.text, backgroundColor: colors.surface },
                    ]}
                  >
                    {linked}
                  </AppText>
                )}
                <View style={styles.row}>
                  <TouchableOpacity
                    onPress={() => setAsset('token')}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      asset === 'token' && {
                        borderColor: colors.primary,
                        backgroundColor: colors.chip,
                      },
                    ]}
                  >
                    <AppText style={[styles.chipText, { color: colors.text }]}>
                      {selectedToken.symbol}
                    </AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setAsset('bnb')}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      asset === 'bnb' && {
                        borderColor: colors.primary,
                        backgroundColor: colors.chip,
                      },
                    ]}
                  >
                    <AppText style={[styles.chipText, { color: colors.text }]}>ETH</AppText>
                  </TouchableOpacity>
                </View>
                <AppTextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder={asset === 'bnb' ? '0.0001' : '1'}
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBg,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                />
                <TouchableOpacity
                  disabled={blocked || !amount}
                  onPress={() => void send(mode)}
                  style={[
                    styles.send,
                    { backgroundColor: colors.primary },
                    (blocked || !amount) && { backgroundColor: colors.chip },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <AppText style={styles.sendText}>
                      {mode === 'in' ? t('appWalletInTitle') : t('appWalletSend')}
                    </AppText>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 12,
  },
  back: {
    fontSize: 15,
    fontWeight: '600',
    width: 72,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
  spacer: {
    width: 72,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  meta: {
    fontSize: 13,
    marginBottom: 10,
  },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  chosenName: {
    fontSize: 18,
    fontWeight: '700',
  },
  address: {
    fontFamily: 'monospace',
    fontSize: 13,
    borderRadius: 12,
    padding: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  send: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  sendText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
});
