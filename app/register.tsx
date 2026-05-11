import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { storage } from '@/lib/storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const { width } = Dimensions.get('window');
// Use 10.0.2.2 for Android emulator to reach localhost on host machine
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export default function RegisterScreen() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    otp: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({
    name: '',
    phone: '',
    email: '',
    otp: '',
    password: '',
    confirmPassword: '',
  });

  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showPassword, setShowPassword] = useState(false);

  const handleSendOtp = async () => {
    if (!formData.email) {
      setMessage({ type: 'error', text: 'Please enter your email first' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      console.log(`Sending OTP via: ${BASE_URL}/send-otp`);
      const res = await fetch(`${BASE_URL}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to send OTP');
      setIsOtpSent(true);
      setMessage({ type: 'success', text: data.message || 'OTP sent to your email' });
      setErrors(prev => ({ ...prev, email: '' }));
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      setMessage({ type: 'error', text: `Connection Error: ${error.message}` });
      setErrors(prev => ({ ...prev, email: error.message }));
    }
  };

  const handleVerifyOtp = async () => {
    if (!formData.otp) {
      setMessage({ type: 'error', text: 'Please enter the OTP' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${BASE_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, otp: formData.otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'OTP verification failed');
      setIsOtpVerified(true);
      setMessage({ type: 'success', text: data.message || 'OTP verified successfully' });
      setErrors(prev => ({ ...prev, otp: '' }));
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      setMessage({ type: 'error', text: `Error: ${error.message}` });
      setErrors(prev => ({ ...prev, otp: error.message }));
    }
  };

  const handleRegister = async () => {
    if (!isOtpVerified) {
      setMessage({ type: 'error', text: 'Please verify your email first' });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      setErrors({ name: '', phone: '', email: '', otp: '', password: '', confirmPassword: '' });
      const payload = {
        full_name: formData.name,
        phone: formData.phone,
        email: formData.email,
        password: formData.password,
      };
      console.log(`Registering via: ${BASE_URL}/register`);
      const res = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        // handle validation errors from FastAPI (422)
        if (res.status === 422 && data && Array.isArray(data.detail)) {
          const fieldErrors: any = { name: '', phone: '', email: '', otp: '', password: '', confirmPassword: '' };
          data.detail.forEach((err: any) => {
            const loc = err.loc || [];
            const field = loc[loc.length - 1];
            // map backend field names to frontend fields
            if (field === 'full_name') fieldErrors.name = err.msg;
            else if (field === 'phone' || field === 'phone_number') fieldErrors.phone = err.msg;
            else if (field === 'email') fieldErrors.email = err.msg;
            else if (field === 'password') fieldErrors.password = err.msg;
            else fieldErrors.name = fieldErrors.name || err.msg;
          });
          setErrors(fieldErrors);
          setMessage({ type: 'error', text: 'Please fix the highlighted fields' });
          setLoading(false);
          return;
        }
        throw new Error(data.detail || 'Registration failed');
      }
      setLoading(false);
      await persistRegistration();
      setMessage({ type: 'success', text: 'Registration successful!' });
      setTimeout(() => {
        router.replace('/switch_role');
      }, 1500);
    } catch (error: any) {
      setLoading(false);
      // Backend unreachable — still save locally so the user can log in
      await persistRegistration();
      setMessage({ type: 'success', text: 'Registered (offline). You can now log in.' });
      setTimeout(() => router.replace('/login'), 1200);
    }
  };

  async function persistRegistration() {
    try {
      await storage.set('workmithra:auth', JSON.stringify({
        phone: formData.phone,
        email: formData.email,
        password: formData.password,
        name: formData.name,
      }));
      await storage.set('workmithra:profile', JSON.stringify({
        full_name: formData.name,
        phone: formData.phone,
        alternate_phone: '',
        location: '',
        pincode: '',
      }));
    } catch {}
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: '', headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#6F42C1" />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <View style={styles.titleContainer}>
              <ThemedText type="title" style={styles.title}>Create Account</ThemedText>
              <Text style={styles.subtitle}>Join WorkMithra and connect with professionals.</Text>
            </View>

            <View style={styles.form}>
              {/* Feedback Message */}
              {message.text ? (
                <View style={[
                  styles.messageContainer, 
                  message.type === 'error' ? styles.errorContainer : styles.successContainer
                ]}>
                  <Ionicons 
                    name={message.type === 'error' ? 'alert-circle' : 'checkmark-circle'} 
                    size={20} 
                    color="white" 
                  />
                  <Text style={styles.messageText}>{message.text}</Text>
                </View>
              ) : null}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <View style={styles.inputWrapper}>
                  <MaterialCommunityIcons name="account-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="John Doe"
                    placeholderTextColor="#adb5bd"
                    value={formData.name}
                    onChangeText={(text) => setFormData({ ...formData, name: text })}
                  />
                </View>
                {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="call-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="+91 9876543210"
                    placeholderTextColor="#adb5bd"
                    keyboardType="phone-pad"
                    value={formData.phone}
                    onChangeText={(text) => setFormData({ ...formData, phone: text })}
                  />
                </View>
                {errors.phone ? <Text style={styles.fieldError}>{errors.phone}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.emailRow}>
                  <View style={[styles.inputWrapper, { flex: 1 }]}>
                    <Ionicons name="mail-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="example@mail.com"
                      placeholderTextColor="#adb5bd"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      value={formData.email}
                      editable={!isOtpVerified}
                      onChangeText={(text) => setFormData({ ...formData, email: text })}
                    />
                  </View>
                  {!isOtpVerified && (
                    <TouchableOpacity 
                      style={[styles.otpButton, isOtpSent && styles.otpButtonSent]} 
                      onPress={handleSendOtp} 
                      disabled={loading || isOtpSent}
                    >
                      <Text style={styles.otpButtonText}>{loading ? '...' : (isOtpSent ? 'Sent' : 'Get OTP')}</Text>
                    </TouchableOpacity>
                  )}
                  {isOtpVerified && (
                    <View style={styles.verifiedBadge}>
                      <Ionicons name="checkmark-circle" size={28} color="#10b981" />
                    </View>
                  )}
                </View>
                {errors.email ? <Text style={styles.fieldError}>{errors.email}</Text> : null}
              </View>

              {isOtpSent && !isOtpVerified && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Enter OTP</Text>
                  <View style={styles.emailRow}>
                    <View style={[styles.inputWrapper, { flex: 1 }]}>
                      <Ionicons name="lock-open-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="6-digit code"
                        placeholderTextColor="#adb5bd"
                        keyboardType="number-pad"
                        maxLength={6}
                        value={formData.otp}
                        onChangeText={(text) => setFormData({ ...formData, otp: text })}
                      />
                    </View>
                    <TouchableOpacity style={styles.verifyButton} onPress={handleVerifyOtp} disabled={loading}>
                      {loading ? <ActivityIndicator color="white" /> : <Text style={styles.verifyButtonText}>Verify</Text>}
                    </TouchableOpacity>
                  </View>
                  {errors.otp ? <Text style={styles.fieldError}>{errors.otp}</Text> : null}
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                  <TextInput 
                    style={styles.input} 
                    placeholder="Create a password" 
                    placeholderTextColor="#adb5bd" 
                    secureTextEntry={!showPassword} 
                    value={formData.password} 
                    onChangeText={(text) => setFormData({ ...formData, password: text })} 
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                    <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#6c757d" />
                  </TouchableOpacity>
                </View>
                {errors.password ? <Text style={styles.fieldError}>{errors.password}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="shield-checkmark-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                  <TextInput 
                    style={styles.input} 
                    placeholder="Confirm your password" 
                    placeholderTextColor="#adb5bd" 
                    secureTextEntry={!showPassword} 
                    value={formData.confirmPassword} 
                    onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })} 
                  />
                </View>
                {errors.confirmPassword ? <Text style={styles.fieldError}>{errors.confirmPassword}</Text> : null}
              </View>

              <TouchableOpacity 
                style={[styles.registerButton, (!isOtpVerified || loading) && styles.disabledButton]} 
                onPress={handleRegister} 
                disabled={!isOtpVerified || loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Text style={styles.registerButtonText}>Create Account</Text>
                    <Ionicons name="checkmark-done" size={20} color="white" />
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.loginContainer}>
                <Text style={styles.loginText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.push('/login')}>
                  <Text style={styles.loginLink}>Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0e6ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 24,
  },
  titleContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6c757d',
    lineHeight: 24,
  },
  fieldError: {
    color: '#FF6B6B',
    marginTop: 6,
    marginLeft: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  form: {
    width: '100%',
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    gap: 8,
  },
  errorContainer: {
    backgroundColor: '#FF6B6B',
  },
  successContainer: {
    backgroundColor: '#10b981',
  },
  messageText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderWidth: 1.5,
    borderColor: '#e9ecef',
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#212529',
  },
  eyeIcon: {
    padding: 8,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  otpButton: {
    backgroundColor: '#6F42C1',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpButtonSent: {
    backgroundColor: '#adb5bd',
  },
  otpButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 13,
  },
  verifiedBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e6fffa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyButton: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 13,
  },
  registerButton: {
    backgroundColor: '#FF6B6B',
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    elevation: 4,
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  disabledButton: {
    backgroundColor: '#adb5bd',
    shadowOpacity: 0,
  },
  registerButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  loginText: {
    fontSize: 14,
    color: '#6c757d',
  },
  loginLink: {
    fontSize: 14,
    color: '#6F42C1',
    fontWeight: 'bold',
  },
});
