import Avatar from '@/components/avatar';
import BottomNav from '@/components/bottom-nav';
import { authFetch, expectJson, getAuth } from '@/lib/api';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

type PaymentHistoryItem = {
  id: number;
  booking_id: number;
  amount: number;
  payment_status: string;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
  payment_proof_image: string | null;
  client_name?: string;
};

type WithdrawalItem = {
  id: number;
  amount: number;
  status: 'pending' | 'success' | 'failed';
  admin_note?: string | null;
  requested_at: string | null;
  processed_at: string | null;
};

type BankAccount = {
  bank_name?: string;
  account_number?: string;
  ifsc_code?: string;
  upi_id?: string;
  account_holder_name?: string;
};

type BankDetails = {
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  upi_id: string;
  account_holder_name: string;
};

const EMPTY_BANK: BankDetails = {
  bank_name: '', account_number: '', ifsc_code: '', upi_id: '', account_holder_name: '',
};

export default function WorkerPaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<PaymentHistoryItem[]>([]);
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawalItem[]>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [bankDetails, setBankDetails] = useState<BankDetails>(EMPTY_BANK);
  const [editingBank, setEditingBank] = useState(false);
  const [bankForm, setBankForm] = useState<BankDetails>(EMPTY_BANK);
  const [savingBank, setSavingBank] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);
  // History tabs: Received (client payments) vs Withdraw (payout requests).
  const [historyTab, setHistoryTab] = useState<'received' | 'withdraw'>('received');

  // Balance = received - (successful withdrawals + pending requests).
  // Pending is deducted immediately so the worker can't double-request.
  const totalWithdrawn = withdrawHistory
    .filter((w) => w.status === 'success' || w.status === 'pending')
    .reduce((sum, w) => sum + w.amount, 0);
  const balance = totalReceived - totalWithdrawn;

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    let wid = 0;
    try {
      const auth = await getAuth();
      if (auth?.id) wid = Number(auth.id);
    } catch {}
    if (!wid) { setLoading(false); return; }

    // Load payment history
    try {
      // GET all completed bookings for this worker, then fetch their payments
      const res = await authFetch(`/bookings/?worker_id=${wid}&status=completed`);
      if (res.ok) {
        const bookings: any[] = await res.json();
        // For simplicity, aggregate from the bookings response
        // (a real app would have a /payments/worker/summary endpoint)
        let received = 0;
        const items: PaymentHistoryItem[] = [];
        for (const b of bookings) {
          const pRes = await authFetch(`/payments/booking/${b.id}`);
          if (pRes.ok) {
            const p = await pRes.json();
            if (p && p.payment_status === 'paid') {
              received += Number(p.amount || 0);
              items.push({
                id: p.id,
                booking_id: b.id,
                amount: Number(p.amount || 0),
                payment_status: p.payment_status,
                payment_method: p.payment_method || null,
                paid_at: p.paid_at || null,
                created_at: p.created_at || '',
                payment_proof_image: p.payment_proof_image || null,
                client_name: b.user?.full_name || 'Client',
              });
            }
          }
        }
        setTotalReceived(received);
        setHistory(items);
      }
    } catch (e) {
      console.warn('Failed to load payment history', e);
    }

    // Load bank details from backend
    try {
      const baRes = await authFetch('/payments/bank-account');
      if (baRes.ok) {
        const ba: BankAccount | null = await baRes.json();
        if (ba) setBankDetails({
          bank_name: ba.bank_name || '',
          account_number: ba.account_number || '',
          ifsc_code: ba.ifsc_code || '',
          upi_id: ba.upi_id || '',
          account_holder_name: ba.account_holder_name || '',
        });
      }
    } catch (e) {
      console.warn('Failed to load bank details', e);
    }

    // Load withdrawal history from backend
    try {
      const wRes = await authFetch('/payments/withdraw/history');
      if (wRes.ok) {
        const wData: WithdrawalItem[] = await wRes.json();
        setWithdrawHistory(wData);
      }
    } catch (e) {
      console.warn('Failed to load withdrawal history', e);
    }

    setLoading(false);
  }

  async function handleWithdraw() {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount to withdraw.');
      return;
    }
    if (amt > balance) {
      Alert.alert('Insufficient balance', `You have ${fmt(balance)} available. Please enter a lower amount.`);
      return;
    }
    try {
      const res = await authFetch('/payments/withdraw', {
        method: 'POST',
        json: { amount: amt },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Withdrawal request failed');
      }
      const newRequest: WithdrawalItem = await res.json();
      setWithdrawHistory((prev) => [newRequest, ...prev]);
      // Optimistic update: balance already reflects the pending deduction on the frontend.
      setShowWithdrawModal(false);
      setWithdrawAmount('');
      Alert.alert(
        'Withdrawal requested',
        `₹${amt.toFixed(2)} will be transferred to your registered account within 2-3 business days.`,
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not submit withdrawal request.');
    }
  }

  async function saveBankDetails() {
    setSavingBank(true);
    try {
      const res = await authFetch('/payments/bank-account', {
        method: 'PUT',
        json: {
          bank_name: bankForm.bank_name,
          account_number: bankForm.account_number,
          ifsc_code: bankForm.ifsc_code,
          upi_id: bankForm.upi_id,
          account_holder_name: bankForm.account_holder_name,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Could not save bank details');
      }
      setBankDetails(bankForm);
      setEditingBank(false);
      Alert.alert('Saved', 'Your bank details have been saved securely.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save bank details. Please try again.');
    } finally {
      setSavingBank(false);
    }
  }

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}><ActivityIndicator size="large" color="#6F42C1" /></View>
        <BottomNav currentRoute="payments" role="worker" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Payments', headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <View style={styles.frame}>
          <Text style={styles.pageTitle}>Payments</Text>

          {/* Summary cards */}
          <View style={styles.cardsRow}>
            <View style={[styles.summaryCard, styles.receivedCard]}>
              <Text style={styles.cardLabel}>Total Received</Text>
              <Text style={styles.cardAmount}>{fmt(totalReceived)}</Text>
            </View>
            <View style={[styles.summaryCard, styles.withdrawnCard]}>
              <Text style={styles.cardLabel}>Total Withdrawn</Text>
              <Text style={styles.cardAmount}>{fmt(totalWithdrawn)}</Text>
            </View>
          </View>

          <View style={[styles.summaryCard, styles.balanceCard]}>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Current Balance</Text>
              <Text style={styles.balanceAmount}>{fmt(balance)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.withdrawBtn, (balance <= 0 || !bankDetails.account_number) && styles.withdrawBtnDisabled]}
              disabled={balance <= 0 || !bankDetails.account_number}
              onPress={() => {
                if (!bankDetails.account_number || !bankDetails.ifsc_code) {
                  Alert.alert(
                    'Bank details required',
                    'Please add your bank account details before requesting a withdrawal.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Add Bank Details', onPress: () => setEditingBank(true) },
                    ],
                  );
                  return;
                }
                setShowWithdrawModal(true);
              }}
            >
              <Ionicons name="wallet-outline" size={16} color="#fff" />
              <Text style={styles.withdrawBtnText}>Withdraw</Text>
            </TouchableOpacity>
          </View>

          {/* Bank details */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Bank / UPI Details</Text>
              <TouchableOpacity onPress={() => { setBankForm(bankDetails); setEditingBank(true); }}>
                <Text style={styles.editLink}>{editingBank ? 'Cancel' : 'Edit'}</Text>
              </TouchableOpacity>
            </View>

            {editingBank ? (
              <View style={styles.bankForm}>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Account Holder Name</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bankForm.account_holder_name}
                    onChangeText={(v) => setBankForm((f) => ({ ...f, account_holder_name: v }))}
                    placeholder="As per bank records"
                    placeholderTextColor="#aaa"
                    autoCapitalize="words"
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Bank Name</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bankForm.bank_name}
                    onChangeText={(v) => setBankForm((f) => ({ ...f, bank_name: v }))}
                    placeholder="e.g. HDFC Bank"
                    placeholderTextColor="#aaa"
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Account Number</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bankForm.account_number}
                    onChangeText={(v) => setBankForm((f) => ({ ...f, account_number: v }))}
                    placeholder="Your account number"
                    placeholderTextColor="#aaa"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>IFSC Code</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bankForm.ifsc_code}
                    onChangeText={(v) => setBankForm((f) => ({ ...f, ifsc_code: v }))}
                    placeholder="e.g. HDFC0001234"
                    placeholderTextColor="#aaa"
                    autoCapitalize="characters"
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>UPI ID (optional)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bankForm.upi_id}
                    onChangeText={(v) => setBankForm((f) => ({ ...f, upi_id: v }))}
                    placeholder="e.g. yourname@upi"
                    placeholderTextColor="#aaa"
                    keyboardType="email-address"
                  />
                </View>
                <TouchableOpacity
                  style={styles.saveBankBtn}
                  disabled={savingBank}
                  onPress={() => void saveBankDetails()}
                >
                  {savingBank
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.saveBankText}>Save Details</Text>}
                </TouchableOpacity>
              </View>
            ) : (bankDetails.account_number || bankDetails.upi_id) ? (
              <View style={styles.bankDisplay}>
                {bankDetails.account_holder_name ? (
                  <View style={styles.bankRow}><Text style={styles.bankKey}>Name</Text><Text style={styles.bankVal}>{bankDetails.account_holder_name}</Text></View>
                ) : null}
                {bankDetails.bank_name ? (
                  <View style={styles.bankRow}><Text style={styles.bankKey}>Bank</Text><Text style={styles.bankVal}>{bankDetails.bank_name}</Text></View>
                ) : null}
                {bankDetails.account_number ? (
                  <View style={styles.bankRow}><Text style={styles.bankKey}>A/C</Text><Text style={styles.bankVal}>****{String(bankDetails.account_number).slice(-4)}</Text></View>
                ) : null}
                {bankDetails.ifsc_code ? (
                  <View style={styles.bankRow}><Text style={styles.bankKey}>IFSC</Text><Text style={styles.bankVal}>{bankDetails.ifsc_code}</Text></View>
                ) : null}
                {bankDetails.upi_id ? (
                  <View style={styles.bankRow}><Text style={styles.bankKey}>UPI</Text><Text style={styles.bankVal}>{bankDetails.upi_id}</Text></View>
                ) : null}
              </View>
            ) : (
              <TouchableOpacity style={styles.addBankBtn} onPress={() => setEditingBank(true)}>
                <Ionicons name="add-circle-outline" size={18} color="#6F42C1" />
                <Text style={styles.addBankText}>Add bank account or UPI</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* History — Received / Withdraw tabs */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>History</Text>
            <View style={styles.historyTabRow}>
              <TouchableOpacity
                style={[styles.historyTabBtn, historyTab === 'received' && styles.historyTabBtnActive]}
                onPress={() => setHistoryTab('received')}
              >
                <Text style={[styles.historyTabText, historyTab === 'received' && styles.historyTabTextActive]}>
                  Received ({history.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.historyTabBtn, historyTab === 'withdraw' && styles.historyTabBtnActive]}
                onPress={() => setHistoryTab('withdraw')}
              >
                <Text style={[styles.historyTabText, historyTab === 'withdraw' && styles.historyTabTextActive]}>
                  Withdraw ({withdrawHistory.length})
                </Text>
              </TouchableOpacity>
            </View>

            {historyTab === 'received' ? (
              history.length === 0 ? (
                <Text style={styles.emptyText}>No payments received yet.</Text>
              ) : (
                history.map((item) => (
                  <View key={item.id} style={styles.historyItem}>
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyClient}>{item.client_name}</Text>
                      <Text style={styles.historyDate}>
                        {item.paid_at ? new Date(item.paid_at).toLocaleDateString('en-IN') : new Date(item.created_at).toLocaleDateString('en-IN')}
                      </Text>
                      <Text style={styles.historyMethod}>
                        {item.payment_method === 'razorpay' ? 'Razorpay' : item.payment_method || 'Online'}
                        {item.payment_proof_image ? ' · Proof uploaded' : ''}
                      </Text>
                      {/* Client's payment proof — tap the thumbnail for the full image. */}
                      {item.payment_proof_image ? (
                        <TouchableOpacity
                          style={styles.proofRow}
                          activeOpacity={0.8}
                          onPress={() => setViewImage(item.payment_proof_image!)}
                        >
                          <Image source={{ uri: item.payment_proof_image }} style={styles.proofThumb} />
                          <Text style={styles.proofLink}>
                            <Ionicons name="expand-outline" size={11} color="#6F42C1" /> Tap to view full proof
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={styles.historyRight}>
                      <Text style={styles.historyAmount}>+{fmt(item.amount)}</Text>
                      <View style={styles.paidBadge}><Text style={styles.paidBadgeText}>Paid</Text></View>
                    </View>
                  </View>
                ))
              )
            ) : (
              withdrawHistory.length === 0 ? (
                <Text style={styles.emptyText}>No withdrawal requests yet.</Text>
              ) : (
                withdrawHistory.map((item) => (
                  <View key={item.id} style={styles.historyItem}>
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyClient}>Withdrawal</Text>
                      <Text style={styles.historyDate}>
                        {item.requested_at ? new Date(item.requested_at).toLocaleDateString('en-IN') : ''}
                      </Text>
                      <Text style={styles.historyMethod}>
                        {item.status === 'pending' ? '⏳ Awaiting processing' :
                         item.status === 'failed' ? `❌ Failed${item.admin_note ? `: ${item.admin_note}` : ''}` :
                         item.admin_note || 'Disbursed'}
                      </Text>
                    </View>
                    <View style={styles.historyRight}>
                      <Text style={[styles.historyAmount, { color: '#b91c1c' }]}>-{fmt(item.amount)}</Text>
                      <View style={[
                        styles.paidBadge,
                        item.status === 'pending' && { backgroundColor: '#fee2e2' },
                        item.status === 'success' && { backgroundColor: '#dcfce7' },
                        item.status === 'failed' && { backgroundColor: '#fee2e2' },
                      ]}>
                        <Text style={[
                          styles.paidBadgeText,
                          item.status === 'pending' && { color: '#991b1b' },
                          item.status === 'success' && { color: '#166534' },
                          item.status === 'failed' && { color: '#991b1b' },
                        ]}>
                          {item.status === 'pending' ? 'Pending' : item.status === 'success' ? 'Success' : 'Failed'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )
            )}
          </View>
        </View>
      </ScrollView>

      {/* Withdraw modal */}
      <Modal visible={showWithdrawModal} transparent animationType="fade" onRequestClose={() => setShowWithdrawModal(false)}>
        <View style={styles.modalOverlay}>
          {/* Inside a Modal the window pans (same as ai-assistant) — 'padding' lifts the card exactly above the keyboard. */}
          <KeyboardAvoidingView behavior="padding" style={{ width: '100%', maxWidth: 340, justifyContent: 'center' }}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Withdraw Funds</Text>
              <Text style={styles.modalSub}>
                Available balance: {fmt(balance)}
                {'\n'}
                {bankDetails.upi_id
                  ? `UPI: ${bankDetails.upi_id}`
                  : `A/c: ****${bankDetails.account_number?.slice(-4)} · ${bankDetails.ifsc_code}`}
              </Text>
              <View style={styles.amountRow}>
                <Text style={styles.rupee}>₹</Text>
                <TextInput
                  style={styles.amountInput}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                  autoFocus
                />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setShowWithdrawModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalConfirm]} onPress={() => void handleWithdraw()}>
                  <Text style={styles.modalConfirmText}>Request</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewImage} transparent animationType="fade" onRequestClose={() => setViewImage(null)}>
        <TouchableOpacity style={styles.imageModalBackdrop} activeOpacity={1} onPress={() => setViewImage(null)}>
          {viewImage ? <Image source={{ uri: viewImage }} style={styles.imageModalImg} resizeMode="contain" /> : null}
          <View style={styles.imageModalCloseRow}>
            <TouchableOpacity style={styles.imageModalClose} onPress={() => setViewImage(null)}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <BottomNav currentRoute="payments" role="worker" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8f7fc' },
  frame: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pageTitle: { fontSize: 22, fontWeight: '800', color: '#333', marginBottom: 16, textAlign: 'center' },

  cardsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  summaryCard: { flex: 1, borderRadius: 14, padding: 14, ...platformShadow('0px 2px 8px rgba(0,0,0,0.08)', '#000', 0, 2, 0.08, 4, 2) },
  receivedCard: { backgroundColor: '#dcfce7' },
  withdrawnCard: { backgroundColor: '#fff1f2' },
  balanceCard: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#6F42C1' },
  cardLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardAmount: { fontSize: 18, fontWeight: '800', color: '#166534' },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  balanceLabel: { fontSize: 14, fontWeight: '700', color: '#333' },
  balanceAmount: { fontSize: 20, fontWeight: '800', color: '#6F42C1' },
  withdrawBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#6F42C1', borderRadius: 10, paddingVertical: 10, gap: 6 },
  withdrawBtnDisabled: { backgroundColor: '#ccc' },
  withdrawBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  section: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 12, ...platformShadow('0px 1px 4px rgba(0,0,0,0.06)', '#000', 0, 1, 0.06, 2, 1) },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#333' },
  editLink: { fontSize: 13, fontWeight: '700', color: '#6F42C1' },

  bankForm: { gap: 10 },
  fieldRow: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#555' },
  fieldInput: { backgroundColor: '#f8f8f8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#333', borderWidth: 1, borderColor: '#eee' },
  saveBankBtn: { backgroundColor: '#6F42C1', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  saveBankText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  bankDisplay: { gap: 6 },
  bankRow: { flexDirection: 'row', gap: 8 },
  bankKey: { fontSize: 12, fontWeight: '700', color: '#888', width: 50 },
  bankVal: { fontSize: 13, color: '#333', fontWeight: '600', flex: 1 },

  addBankBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addBankText: { fontSize: 13, fontWeight: '700', color: '#6F42C1' },

  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  historyLeft: { flex: 1 },
  historyClient: { fontSize: 14, fontWeight: '700', color: '#333' },
  historyDate: { fontSize: 12, color: '#888', marginTop: 2 },
  historyMethod: { fontSize: 11, color: '#aaa', marginTop: 2 },
  historyRight: { alignItems: 'flex-end', gap: 4 },
  historyAmount: { fontSize: 15, fontWeight: '800', color: '#166534' },
  paidBadge: { backgroundColor: '#dcfce7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  paidBadgeText: { fontSize: 10, fontWeight: '800', color: '#166534' },
  emptyText: { fontSize: 13, color: '#999', textAlign: 'center', paddingVertical: 20 },

  // History tabs (Received / Withdraw)
  historyTabRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4, marginTop: 10, marginBottom: 4 },
  historyTabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  historyTabBtnActive: { backgroundColor: '#6F42C1' },
  historyTabText: { fontSize: 12, fontWeight: '700', color: '#666' },
  historyTabTextActive: { color: '#fff' },

  // Payment-proof thumbnail in Received history (tap for full image)
  proofRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f5f0fb', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#e6dbf5' },
  proofThumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: '#e9ecef' },
  proofLink: { flex: 1, color: '#6F42C1', fontWeight: '700', fontSize: 11 },

  // Withdraw modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#333', textAlign: 'center' },
  modalSub: { fontSize: 13, color: '#6F42C1', textAlign: 'center', marginTop: 4, marginBottom: 16, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 12, paddingHorizontal: 14, marginBottom: 16, borderWidth: 1, borderColor: '#eee', overflow: 'hidden' },
  rupee: { fontSize: 24, fontWeight: '800', color: '#10b981', marginRight: 4 },
  amountInput: { flex: 1, fontSize: 24, fontWeight: '800', color: '#333', paddingVertical: 12, minWidth: 0 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  modalCancel: { backgroundColor: '#f0f0f0' },
  modalCancelText: { color: '#666', fontWeight: '700', fontSize: 14 },
  modalConfirm: { backgroundColor: '#6F42C1' },
  modalConfirmText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Full-screen image viewer
  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  imageModalImg: { width: '95%', height: '80%' },
  imageModalCloseRow: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'flex-end', padding: 16, paddingTop: 48 },
  imageModalClose: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8 },
});
