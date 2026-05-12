import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

type Step = 'email' | 'otp' | 'password';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const notify = (type: 'error' | 'success', text: string) => setMessage({ type, text });

  async function handleSendOtp() {
    if (!email.trim()) return notify('error', 'Enter your registered email');
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${BASE_URL}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Failed to send OTP');
      notify('success', 'OTP sent to your email');
      setStep('otp');
    } catch (e: any) {
      notify('error', e.message || 'Could not send OTP');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otp.trim()) return notify('error', 'Enter the OTP from your email');
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${BASE_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Invalid OTP');
      notify('success', 'OTP verified');
      setStep('password');
    } catch (e: any) {
      notify('error', e.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!password || !confirmPassword) return notify('error', 'Enter both fields');
    if (password.length < 6) return notify('error', 'Password must be at least 6 characters');
    if (password !== confirmPassword) return notify('error', 'Passwords do not match');
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${BASE_URL}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Reset failed');

      // Update locally cached auth so offline login still works
      try {
        const raw = await storage.get('workmithra:auth');
        const auth = raw ? JSON.parse(raw) : {};
        auth.email = email;
        auth.password = password;
        await storage.set('workmithra:auth', JSON.stringify(auth));
      } catch {}

      notify('success', 'Password reset successful!');
      setTimeout(() => router.replace('/login'), 800);
    } catch (e: any) {
      notify('error', e.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#6F42C1" />
          </TouchableOpacity>

          <Text style={styles.title}>Forgot Password?</Text>
          <Text style={styles.subtitle}>We'll send a one-time code to your registered email.</Text>

          {message && (
            <View style={[styles.banner, message.type === 'error' ? styles.bannerError : styles.bannerSuccess]}>
              <Ionicons name={message.type === 'error' ? 'alert-circle' : 'checkmark-circle'} size={18} color="#fff" />
              <Text style={styles.bannerText}>{message.text}</Text>
            </View>
          )}

          {/* Step 1: Email */}
          <View style={[styles.card, step !== 'email' && styles.cardDone]}>
            <Text style={styles.cardTitle}>1. Email</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color="#6c757d" />
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#adb5bd"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={step === 'email'}
              />
            </View>
            {step === 'email' && (
              <TouchableOpacity style={styles.primaryBtn} onPress={handleSendOtp} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send OTP</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Step 2: OTP */}
          {step !== 'email' && (
            <View style={[styles.card, step === 'password' && styles.cardDone]}>
              <Text style={styles.cardTitle}>2. Enter OTP</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-open-outline" size={18} color="#6c757d" />
                <TextInput
                  style={styles.input}
                  placeholder="6-digit code"
                  placeholderTextColor="#adb5bd"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={step === 'otp'}
                />
              </View>
              {step === 'otp' && (
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.secondaryBtn, { flex: 1, marginRight: 8 }]} onPress={handleSendOtp} disabled={loading}>
                    <Text style={styles.secondaryBtnText}>Resend</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={handleVerifyOtp} disabled={loading}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Step 3: New password */}
          {step === 'password' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>3. New Password</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={18} color="#6c757d" />
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor="#adb5bd"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#6c757d" />
                </TouchableOpacity>
              </View>
              <View style={styles.inputWrap}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#6c757d" />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm new password"
                  placeholderTextColor="#adb5bd"
                  secureTextEntry={!showPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleResetPassword} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Reset Password</Text>}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  scroll: { flexGrow: 1, padding: 20, paddingTop: 50 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0e6ff', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '800', color: '#212529', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#6c757d', marginBottom: 20 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginBottom: 12 },
  bannerError: { backgroundColor: '#FF6B6B' },
  bannerSuccess: { backgroundColor: '#10b981' },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  card: { backgroundColor: '#fafafa', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  cardDone: { opacity: 0.7 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#6F42C1', marginBottom: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e9ecef', borderRadius: 12, paddingHorizontal: 12, marginBottom: 10, gap: 8 },
  input: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#212529' },
  primaryBtn: { backgroundColor: '#6F42C1', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondaryBtn: { backgroundColor: '#f0e6ff', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: '#6F42C1', fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row' },
});
