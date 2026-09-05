import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BookingStatus } from '@/lib/booking-status';

export type BookingStatusBadgeProps = {
  status: BookingStatus;
  isPast?: boolean;
  paymentResult?: 'success' | 'failed' | string;
};

export function getStatusBadgeConfig(
  status: BookingStatus,
  isPast: boolean = false,
  paymentResult?: string,
): { bg: string; fg: string; label: string } {
  if (status === 'completed') return { bg: '#dcfce7', fg: '#166534', label: '✓ Completed' };
  if (status === 'rejected') return { bg: '#fee2e2', fg: '#991b1b', label: '✗ Rejected' };
  if (status === 'unpaid') return { bg: '#fee2e2', fg: '#991b1b', label: '⚠ Unpaid' };
  if (status === 'not_completed' || status === 'client_not_completed') {
    return { bg: '#fee2e2', fg: '#991b1b', label: '⏱ Not completed' };
  }
  if (status === 'not_completed_pending_review') {
    return { bg: '#ffedd5', fg: '#9a3412', label: '⏱ Not completed · review pending' };
  }
  if (status === 'work_completed') {
    return { bg: '#dbeafe', fg: '#1e40af', label: '🔧 Work marked complete' };
  }
  if (status === 'work_reported') {
    return { bg: '#ede9fe', fg: '#5b21b6', label: '📋 Work report submitted' };
  }
  if (status === 'client_confirmed') {
    return { bg: '#fef3c7', fg: '#92400e', label: '👁 Work confirmed' };
  }
  if (status === 'payment_completed') {
    if (paymentResult === 'success') return { bg: '#d1fae5', fg: '#065f46', label: '💰 Payment done' };
    return { bg: '#d1fae5', fg: '#065f46', label: '💰 Payment completed' };
  }
  if (status === 'payment_proof_submitted') {
    return { bg: '#d1fae5', fg: '#065f46', label: '📤 Proof submitted' };
  }
  if (status === 'awaiting_payment') {
    if (paymentResult === 'success') return { bg: '#dcfce7', fg: '#166534', label: '✅ Paid' };
    if (paymentResult === 'failed') return { bg: '#fee2e2', fg: '#991b1b', label: '❌ Payment failed' };
    return { bg: '#fef3c7', fg: '#92400e', label: '💳 Pay pending' };
  }
  if (isPast) {
    if (status === 'pending') return { bg: '#f3f4f6', fg: '#6b7280', label: '✗ Not accepted' };
    return { bg: '#ffedd5', fg: '#9a3412', label: '⏱ Not completed' };
  }
  if (status === 'pending') return { bg: '#fef3c7', fg: '#92400e', label: '⏳ Pending' };
  return { bg: '#dbeafe', fg: '#1e40af', label: '⏳ Upcoming' };
}

export default function BookingStatusBadge({
  status,
  isPast = false,
  paymentResult,
}: BookingStatusBadgeProps) {
  const config = getStatusBadgeConfig(status, isPast, paymentResult);

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.badgeText, { color: config.fg }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
