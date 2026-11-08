import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { referralPersonMatches } from '../utils/referralSearch';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { useReferralNetwork } from '../hooks/useReferralNetwork';
import {
  fillReferralTimestamps,
  loadReferralChildren,
  type ReferralChild,
} from '../services/referralNetwork';
import {
  clampReferralPage,
  referralPageCount,
  sliceReferralPage,
  visibleReferralPages,
} from '../utils/referralPages';
import { ReferralBranch } from './ReferralBranch';
import {
  isBranchOpen,
  normalizeBranchKey,
  toggleBranchOpen,
  uniqueBranchAddresses,
} from '../utils/referralTree';
import { AppIcon } from './icons';
import { ProfileAvatar } from './ProfileAvatar';
import { useUserProfile } from '../profile/ProfileContext';
import { labelForProfile } from '../services/userProfile';
import { formatRankLabel, getRankForLevel } from '../constants/ranks';
import { AppText, AppTextInput } from './AppText';
import { SponsorPoolButton } from './SponsorPoolButton';

interface ReferralHistoryProps {
  walletAddress: string;
  enabled: boolean;
  variant?: 'board' | 'people';
  onOpenPeople?: () => void;
}

function formatDay(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString();
}

export const ReferralHistory: React.FC<ReferralHistoryProps> = ({
  walletAddress,
  enabled,
  variant = 'board',
  onOpenPeople,
}) => {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { data, isLoading, error, refetch } = useReferralNetwork(walletAddress, enabled);
  const { lookup, refreshDirectory } = useUserProfile();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [branches, setBranches] = useState<Record<string, ReferralChild[]>>({});
  const [loadingBranch, setLoadingBranch] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [stamps, setStamps] = useState<
    Record<string, { registeredAt: number; lastEarnAt: number }>
  >({});
  const stamped = useRef(new Set<string>());

  const filteredDirects = useMemo(() => {
    if (variant !== 'people') return data.directs;
    return data.directs.filter((node) =>
      referralPersonMatches(query, {
        name: labelForProfile(lookup(node.address), node.code),
        code: node.code,
        address: node.address,
      })
    );
  }, [variant, data.directs, query, lookup]);

  const totalPages = referralPageCount(filteredDirects.length);
  const safePage = clampReferralPage(page, totalPages);
  const pageNodes = useMemo(
    () => (variant === 'people' ? sliceReferralPage(filteredDirects, safePage) : []),
    [variant, filteredDirects, safePage]
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    const wallets = uniqueBranchAddresses([
      ...pageNodes.map((node) => node.address),
      ...Object.values(branches).flatMap((people) => people.map((person) => person.address)),
    ]);
    if (wallets.length) refreshDirectory(wallets).catch(() => {});
  }, [pageNodes, branches, refreshDirectory]);

  const openGroup = (address: string) => {
    const key = normalizeBranchKey(address);
    if (!key) return;
    setOpen((current) => toggleBranchOpen(current, address));
    if (branches[key] || loadingBranch[key]) return;
    setLoadingBranch((current) => ({ ...current, [key]: true }));
    void loadReferralChildren(address)
      .then((people) => {
        setBranches((current) => ({ ...current, [key]: people }));
      })
      .catch(() => {
        // Sin caché vacía: el siguiente toque vuelve a pedir el grupo.
      })
      .finally(() => {
        setLoadingBranch((current) => ({ ...current, [key]: false }));
      });
  };

  useEffect(() => {
    if (variant !== 'people' || !pageNodes.length) return;
    const missing = pageNodes.filter((node) => !stamped.current.has(node.address.toLowerCase()));
    if (!missing.length) return;
    let cancelled = false;
    fillReferralTimestamps(missing)
      .then((got) => {
        if (cancelled) return;
        setStamps((current) => {
          const next = { ...current };
          for (const [key, value] of got) {
            stamped.current.add(key);
            next[key] = value;
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [variant, pageNodes]);

  const board = (
    <View style={[styles.board, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.boardRow}>
        <AppText style={[styles.boardLabel, { color: colors.text }]}>
          {t('referralEarnCommissions')}
        </AppText>
        <AppText style={[styles.boardValue, { color: colors.primary }]}>
          {data.commissionTotalLabel}
        </AppText>
      </View>
      <View style={styles.boardRow}>
        <AppText style={[styles.boardLabel, { color: colors.text }]}>
          {t('referralEarnBonus')}
        </AppText>
        <AppText style={[styles.boardValue, { color: colors.primary }]}>
          {data.bonusTotalLabel}
        </AppText>
      </View>
      <View style={[styles.boardRow, styles.boardTotal]}>
        <AppText style={[styles.boardLabel, styles.boardTotalText, { color: colors.text }]}>
          {t('referralEarnGrand')}
        </AppText>
        <AppText style={[styles.boardValue, styles.boardTotalText, { color: colors.primary }]}>
          {data.totalEarnedLabel}
        </AppText>
      </View>
    </View>
  );

  if (variant === 'board') {
    return (
      <View>
        {isLoading && <ActivityIndicator color="#146C2E" style={styles.spinner} />}
        {error && <AppText style={styles.warn}>{t('referralLoadError')}</AppText>}
        {data.partial ? (
          <AppText style={[styles.warn, { color: colors.warnText }]}>
            {t('referralHistoryPartial')}
          </AppText>
        ) : null}
        {board}
        {onOpenPeople ? (
          <TouchableOpacity
            onPress={onOpenPeople}
            style={[
              styles.openPeople,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('referralPeopleOpen')}
          >
            <AppIcon name="people" size={18} color={colors.primary} />
            <View style={styles.openPeopleText}>
              <AppText style={[styles.openPeopleTitle, { color: colors.text }]}>
                {t('referralPeopleOpen')}
              </AppText>
              <AppText style={[styles.openPeopleHint, { color: colors.textMuted }]}>
                {t('referralDirects', { count: data.directs.length })}
              </AppText>
            </View>
            <AppIcon name="history" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.refresh}
          onPress={refetch}
          accessibilityRole="button"
          accessibilityLabel={t('referralRefresh')}
        >
          <AppIcon name="refresh" size={16} color="#146C2E" />
          <AppText style={styles.refreshText}>{t('referralRefresh')}</AppText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      {isLoading && <ActivityIndicator color="#146C2E" style={styles.spinner} />}
      {error && <AppText style={styles.warn}>{t('referralLoadError')}</AppText>}
      {data.partial ? (
        <AppText style={[styles.warn, { color: colors.warnText }]}>
          {t('referralHistoryPartial')}
        </AppText>
      ) : null}
      {board}
      <SponsorPoolButton debtors={data.directs.map((node) => node.address)} />
      {!error && (
        <>
          <View
            style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <AppIcon name="search" size={18} color={colors.textMuted} />
            <AppTextInput
              value={query}
              onChangeText={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder={t('referralSearchPlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { color: colors.text }]}
              accessibilityLabel={t('referralSearchPlaceholder')}
            />
            {query ? (
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  setPage(1);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('referralSearchClear')}
              >
                <AppIcon name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          <AppText style={[styles.summary, { color: colors.textMuted }]}>
            {t('referralDirects', { count: filteredDirects.length })}
          </AppText>
          {totalPages > 1 ? (
            <AppText style={[styles.pageMeta, { color: colors.textMuted }]}>
              {t('referralPageOf', { page: String(safePage), pages: String(totalPages) })}
            </AppText>
          ) : null}

          {filteredDirects.length === 0 ? (
            isLoading ? null : (
              <AppText style={[styles.empty, { color: colors.textMuted }]}>
                {query ? t('referralSearchEmpty') : t('referralNone')}
              </AppText>
            )
          ) : (
            pageNodes.map((node) => {
              const expanded = isBranchOpen(open, node.address);
              const person = lookup(node.address);
              const name = labelForProfile(person, node.code);
              const stamp = stamps[node.address.toLowerCase()];
              const registered = formatDay(stamp?.registeredAt || node.registeredAt);
              const lastEarn = formatDay(stamp?.lastEarnAt || node.lastEarnAt);
              const kids = branches[node.address.toLowerCase()] || node.children;
              const busy = Boolean(loadingBranch[node.address.toLowerCase()]);
              return (
                <View
                  key={node.address}
                  style={[
                    styles.card,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.personRow}
                    onPress={() => openGroup(node.address)}
                    accessibilityRole="button"
                    accessibilityLabel={name}
                  >
                    <ProfileAvatar
                      profile={person}
                      wallet={node.address}
                      size={48}
                      publicView
                      level={node.level || 1}
                      rankName={t(getRankForLevel(node.level || 1).nameKey)}
                      showRankLabel
                    />
                    <View style={styles.personText}>
                      <AppText style={[styles.name, { color: colors.text }]}>{name}</AppText>
                      <AppText style={[styles.meta, { color: colors.textMuted }]}>
                        {formatRankLabel(
                          getRankForLevel(node.level || 1),
                          t(getRankForLevel(node.level || 1).nameKey)
                        )}
                      </AppText>
                      {name !== node.code ? (
                        <AppText style={[styles.code, { color: colors.textMuted }]}>
                          {node.code}
                        </AppText>
                      ) : null}
                      <AppText style={[styles.meta, { color: colors.textMuted }]}>
                        {registered
                          ? t('referralRegisteredOn', { date: registered })
                          : t('referralDatePending')}
                      </AppText>
                      <AppText style={styles.split}>
                        {t('referralEarnFromOne', {
                          commission: node.commissionLabel,
                          bonus: node.bonusLabel,
                        })}
                      </AppText>
                      <AppText style={styles.earned}>
                        {t('referralEarnedWith', { amount: node.earnedLabel })}
                      </AppText>
                      <AppText style={[styles.meta, { color: colors.textMuted }]}>
                        {lastEarn
                          ? t('referralLastEarnOn', { date: lastEarn })
                          : t('referralNoEarnYet')}
                      </AppText>
                      <AppText style={[styles.meta, { color: colors.primary }]}>
                        {expanded && !busy
                          ? t('referralTheirCount', { count: kids.length })
                          : t('referralGroupHint')}
                      </AppText>
                    </View>
                  </TouchableOpacity>
                  {expanded ? (
                    <View style={styles.children}>
                      <AppText style={styles.childTitle}>{t('referralTheirNetwork')}</AppText>
                      {busy ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : (
                        <ReferralBranch
                          people={kids}
                          depth={2}
                          open={open}
                          branches={branches}
                          loading={loadingBranch}
                          onToggle={openGroup}
                        />
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}

          {totalPages > 1 ? (
            <View style={styles.pager}>
              <TouchableOpacity
                disabled={safePage <= 1}
                onPress={() => setPage(safePage - 1)}
                style={[
                  styles.pageChip,
                  { borderColor: colors.border },
                  safePage <= 1 && styles.pageDisabled,
                ]}
              >
                <AppText style={[styles.pageChipText, { color: colors.text }]}>{'‹'}</AppText>
              </TouchableOpacity>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pageRow}
              >
                {visibleReferralPages(safePage, totalPages).map((item, index) =>
                  item === 'gap' ? (
                    <AppText
                      key={`gap-${index}`}
                      style={[styles.pageGap, { color: colors.textMuted }]}
                    >
                      …
                    </AppText>
                  ) : (
                    <TouchableOpacity
                      key={item}
                      onPress={() => setPage(item)}
                      style={[
                        styles.pageChip,
                        {
                          borderColor: colors.border,
                          backgroundColor: item === safePage ? colors.primary : colors.surface,
                        },
                      ]}
                    >
                      <AppText
                        style={[
                          styles.pageChipText,
                          { color: item === safePage ? colors.onPrimary : colors.text },
                        ]}
                      >
                        {String(item)}
                      </AppText>
                    </TouchableOpacity>
                  )
                )}
              </ScrollView>
              <TouchableOpacity
                disabled={safePage >= totalPages}
                onPress={() => setPage(safePage + 1)}
                style={[
                  styles.pageChip,
                  { borderColor: colors.border },
                  safePage >= totalPages && styles.pageDisabled,
                ]}
              >
                <AppText style={[styles.pageChipText, { color: colors.text }]}>{'›'}</AppText>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity style={styles.refresh} onPress={refetch}>
            <AppIcon name="refresh" size={16} color="#146C2E" />
            <AppText style={styles.refreshText}>{t('referralRefresh')}</AppText>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  board: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  boardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  boardTotal: {
    marginTop: 2,
    marginBottom: 0,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e6f3eb',
  },
  boardLabel: {
    fontSize: 13,
    flex: 1,
  },
  boardValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  boardTotalText: {
    fontSize: 15,
    fontWeight: '800',
  },
  openPeople: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  openPeopleText: {
    flex: 1,
  },
  openPeopleTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  openPeopleHint: {
    fontSize: 12,
    marginTop: 2,
  },
  spinner: {
    marginVertical: 12,
  },
  summary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#146C2E',
    marginBottom: 6,
  },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  pageMeta: {
    fontSize: 12,
    marginBottom: 10,
  },
  empty: {
    fontSize: 12,
    color: '#3d5c48',
  },
  card: {
    borderWidth: 1,
    borderColor: '#d7eadf',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personText: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '800',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  split: {
    marginTop: 4,
    fontSize: 12,
    color: '#3d5c48',
  },
  earned: {
    marginTop: 2,
    fontSize: 13,
    color: '#146C2E',
    fontWeight: '700',
  },
  meta: {
    marginTop: 2,
    fontSize: 12,
    color: '#3d5c48',
  },
  children: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e6f3eb',
  },
  childTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#145c32',
    marginBottom: 4,
  },
  child: {
    fontSize: 12,
    color: '#333',
    flex: 1,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  pageRow: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  pageChip: {
    minWidth: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pageChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pageGap: {
    fontSize: 16,
    paddingHorizontal: 4,
  },
  pageDisabled: {
    opacity: 0.35,
  },
  warn: {
    fontSize: 12,
    color: '#b42318',
  },
  refresh: {
    marginTop: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  refreshText: {
    color: '#146C2E',
    fontWeight: '700',
    fontSize: 13,
  },
});
