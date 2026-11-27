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
import QRCode from 'react-native-qrcode-svg';
import { useScreenScroll } from '../hooks/useScreenScroll';
import { Interface, parseUnits } from 'ethers';
import { enviarBnb, enviarToken, loadAppWallet } from '../services/appWallet';
import { hasLinkedExternalWallet, loadRequiredExternalWallet } from '../services/linkedWallet';
import { recordMovement } from '../services/movementHistory';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useFundsConfirm } from './FundsConfirmHost';
import { quoteNetworkFee } from '../utils/fundsConfirmGate';
import { ERC20_ABI } from '../constants/contractConfig';
import { getProviderWithFallback, isDemoMode } from '../constants/rpcConfig';
import { formatAddress, parsePositiveDecimal } from '../utils/formatters';
import { humanizeTxError } from '../utils/txErrors';
import { copyText } from '../utils/copyText';
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
/**
 * Depositar: muestra la dirección de la billetera de la app (copiar, compartir y QR).
 * Retirar: firma la billetera de la app y el destino es solo la billetera vinculada.
 */
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
  const [linked, setLinked] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'token' | 'bnb'>('token');
  const [busy, setBusy] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
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
  }, [visible, walletAddress]);
  const close = () => {
    setAmount('');
    setAsset('token');
    onClose();
  };
  const send = async () => {
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
      const available = parseUnits(
        asset === 'bnb' ? bnbBalance || '0' : tokenBalance || '0',
        decimals
      );
      if (parseUnits(parsed, decimals) > available) {
        Alert.alert(t('amount'), t('amountExceedsBalance'));
        return;
      }
    } catch {
      Alert.alert(t('amount'), t('invalidAmount'));
      return;
    }
    const to = linked;
    if (
      !(await confirmFunds('transfer', {
        amount: parsed,
        symbol: asset === 'bnb' ? 'ETH' : 'LUSD',
        destination: to,
        fee: await (async () => {
          try {
            const data =
              asset === 'bnb'
                ? '0x'
                : new Interface(ERC20_ABI).encodeFunctionData('transfer', [
                    to,
                    parseUnits(parsed, decimals),
                  ]);
            return quoteNetworkFee(getProviderWithFallback(), {
              from: walletAddress,
              to: asset === 'bnb' ? to : selectedToken.address,
              data,
            });
          } catch {
            return 'no disponible';
          }
        })(),
      }))
    )
      return;
    setBusy(true);
    try {
      const amountWei = parseUnits(parsed, decimals).toString();
      const signer = await loadAppWallet();
      if (!signer) {
        Alert.alert(t('error'), t('appWalletNotReady'));
        return;
      }
      if (asset === 'bnb') await enviarBnb(signer, to, amountWei);
      else await enviarToken(signer, selectedToken.address, to, amountWei);
      await recordMovement(walletAddress, {
        kind: 'transfer_out',
        from: walletAddress,
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
  const receive = (
    <View>
      <View style={styles.chosen}>
        <BrandLogo size={40} />
        <AppText style={[styles.chosenName, { color: colors.text }]}>{t('appWalletLabel')}</AppText>
      </View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>
        {t('appWalletInLead', { symbol: selectedToken.symbol })}
      </AppText>
      <AppText style={[styles.meta, { color: colors.warnText }]}>
        {t(isDemoMode() ? 'linkWalletNetworkDemo' : 'linkWalletNetworkLive')}
      </AppText>
      <View
        collapsable={false}
        renderToHardwareTextureAndroid={false}
        style={styles.qrWrap}
        accessibilityLabel={t('yourWallet')}
      >
        {qrFailed || !walletAddress ? (
          <AppText selectable style={[styles.meta, { color: '#111' }]}>
            {walletAddress}
          </AppText>
        ) : (
          <QRCode
            value={walletAddress}
            size={200}
            ecl="M"
            backgroundColor="#fff"
            color="#111"
            onError={() => setQrFailed(true)}
          />
        )}
      </View>
      <AppText
        selectable
        style={[styles.address, { color: colors.text, backgroundColor: colors.surface }]}
      >
        {walletAddress}
      </AppText>
      <TouchableOpacity
        style={[styles.send, { backgroundColor: colors.connect, marginTop: 12 }]}
        accessibilityRole="button"
        accessibilityLabel={t('copyAddress')}
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
        accessibilityRole="button"
        accessibilityLabel={t('appWalletShare')}
        onPress={() => Share.share({ message: walletAddress }).catch(() => {})}
      >
        <AppText style={styles.sendText}>{t('appWalletShare')}</AppText>
      </TouchableOpacity>
      <AppText style={[styles.meta, { color: colors.textMuted, marginTop: 12 }]}>
        {t('appWalletInGas')}
      </AppText>
    </View>
  );
  const withdraw = !linked ? (
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
        <AppText style={[styles.chosenName, { color: colors.text }]}>{t('appWalletLabel')}</AppText>
      </View>
      <AppText style={[styles.lead, { color: colors.textMuted }]}>{t('appWalletSendLead')}</AppText>
      <AppText style={[styles.meta, { color: colors.text }]}>
        {t('appWalletDestination')} {formatAddress(linked)}
      </AppText>
      <AppText
        selectable
        style={[styles.address, { color: colors.text, backgroundColor: colors.surface }]}
      >
        {linked}
      </AppText>
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
        onPress={() => void send()}
        style={[
          styles.send,
          { backgroundColor: colors.primary },
          (blocked || !amount) && { backgroundColor: colors.chip },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#111" />
        ) : (
          <AppText style={styles.sendText}>{t('appWalletSend')}</AppText>
        )}
      </TouchableOpacity>
    </View>
  );
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
            {mode === 'in' ? receive : withdraw}
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
  qrWrap: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginVertical: 12,
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
