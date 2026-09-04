import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { isValidationErrors, registerRequest, sendOtp, verifyOtp } from '@/lib/auth-api';
import { platformNoShadow, platformShadow } from '@/lib/shadow';
import { storage } from '@/lib/storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

type FieldErrors = {
  name: string;
  phone: string;
  email: string;
  otp: string;
  password: string;
  confirmPassword: string;
};

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
  const [errors, setErrors] = useState<FieldErrors>({
    name: '',
    phone: '',
    email: '',
    otp: '',
    password: '',
    confirmPassword: '',
  });

  const [role, setRole] = useState<'user' | 'worker'>('user');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  // Short-lived proof (from /verify-otp) that this email passed the OTP
  // challenge. Sent with /register; the backend refuses signups without it.
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showPassword, setShowPassword] = useState(false);

  // Post-success redirect is delayed so the success message is visible; clear
  // the timer if the user navigates away before it fires.
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  const handleSendOtp = async () => {
    if (!formData.email) {
      setMessage({ type: 'error', text: 'Please enter your email first' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const data = await sendOtp(formData.email);
      setIsOtpSent(true);
      setMessage({ type: 'success', text: data.message || 'OTP sent to your email' });
      setErrors(prev => ({ ...prev, email: '' }));
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Failed to send OTP' });
      setErrors(prev => ({ ...prev, email: error?.message || 'Failed to send OTP' }));
    } finally {
      setLoading(false);
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
      const data = await verifyOtp(formData.email, formData.otp);
      setIsOtpVerified(true);
      setVerifyToken(data.verify_token || null);
      setMessage({ type: 'success', text: data.message || 'OTP verified successfully' });
      setErrors(prev => ({ ...prev, otp: '' }));
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'OTP verification failed' });
      setErrors(prev => ({ ...prev, otp: error?.message || 'OTP verification failed' }));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!isOtpVerified) {
      setMessage({ type: 'error', text: 'Please verify your email first' });
      return;
    }
    if (!verifyToken) {
      // Verified flag is set but the proof token is missing/expired — make
      // them redo the OTP step rather than sending a doomed request.
      setIsOtpVerified(false);
      setIsOtpSent(false);
      setFormData({ ...formData, otp: '' });
      setMessage({ type: 'error', text: 'Verification expired — please request a new OTP' });
      return;
    }
    // Same 8-character minimum the backend enforces (PASSWORD_MIN_LENGTH) —
    // catching it here gives an instant, readable error instead of a 422.
    if (formData.password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
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
      await registerRequest({
        full_name: formData.name,
        phone: formData.phone,
        email: formData.email,
        password: formData.password,
        role: role,
        verify_token: verifyToken,
      });
      await persistRegistration();
      setMessage({ type: 'success', text: 'Registration successful!' });
      redirectTimer.current = setTimeout(() => {
        router.replace('/login');
      }, 1500);
    } catch (error: any) {
      // Map FastAPI 422 validation errors to per-field messages.
      const detail: unknown = error?.detail;
      if (error?.name === 'AuthApiError' && error.status === 422 && isValidationErrors(detail)) {
        const fieldErrors: FieldErrors = { name: '', phone: '', email: '', otp: '', password: '', confirmPassword: '' };
        detail.forEach((err) => {
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
        return;
      }
      // The verify token only lives ~10 minutes. If it expired while the user
      // filled in the form, /register rejects it — unlock the OTP step so they
      // can request a fresh one. Otherwise the screen is a deadlock: the email
      // field is locked and the Get-OTP button is hidden once verified.
      const msg: string = error?.message || '';
      const verifyExpired =
        error?.name === 'AuthApiError' &&
        error.status === 400 &&
        /expired or invalid|request a new otp/i.test(msg);
      if (verifyExpired) {
        setIsOtpVerified(false);
        setIsOtpSent(false);
        setVerifyToken(null);
        setFormData((f) => ({ ...f, otp: '' }));
        setMessage({ type: 'error', text: 'Verification expired — request a new OTP, then create your account.' });
        return;
      }
      // No offline fallback: a registration that never reached the server is
      // not a real account, and login requires the server. Surface the error.
      setMessage({ type: 'error', text: error?.message || 'Registration failed. Please check your connection and try again.' });
    } finally {
      setLoading(false);
    }
  };

  async function persistRegistration() {
    try {
      // Prefill the profile form for convenience. NEVER persist the password —
      // credentials belong only in the backend. The session token is issued at
      // login and stored under workmithra:auth by the login screen, so we don't
      // write that key here (there is no id/token yet at registration).
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
      {/* Same as ai-assistant: window pans, KAV 'padding' lifts inputs above the keyboard. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
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
              <View style={styles.roleContainer}>
                <TouchableOpacity 
                  style={[styles.roleButton, role === 'user' && styles.roleButtonActive]}
                  onPress={() => setRole('user')}
                >
                  <Ionicons name="person" size={18} color={role === 'user' ? '#fff' : '#6F42C1'} />
                  <Text style={[styles.roleText, role === 'user' && styles.roleTextActive]}>User</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.roleButton, role === 'worker' && styles.roleButtonActive]}
                  onPress={() => setRole('worker')}
                >
                  <Ionicons name="briefcase" size={18} color={role === 'worker' ? '#fff' : '#6F42C1'} />
                  <Text style={[styles.roleText, role === 'worker' && styles.roleTextActive]}>Worker</Text>
                </TouchableOpacity>
              </View>

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
                      onChangeText={(text) => {
                        // Editing the email invalidates any OTP already sent to
                        // the previous address — force the user to request a new one.
                        setFormData({ ...formData, email: text, otp: '' });
                        if (isOtpSent) setIsOtpSent(false);
                        setVerifyToken(null);
                      }}
                    />
                  </View>
                  {!isOtpVerified && (
                    <TouchableOpacity 
                      style={[styles.otpButton, isOtpSent && styles.otpButtonSent]} 
                      onPress={handleSendOtp} 
                      disabled={loading}
                    >
                      <Text style={styles.otpButtonText}>{loading ? '...' : (isOtpSent ? 'Resend' : 'Get OTP')}</Text>
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
  roleContainer: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 6,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  roleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  roleButtonActive: {
    backgroundColor: '#6F42C1',
  },
  roleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6F42C1',
  },
  roleTextActive: {
    color: '#fff',
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
    ...platformShadow('0px 4px 16px rgba(255,107,107,0.3)', '#FF6B6B', 0, 4, 0.3, 8, 4),
  },
  disabledButton: {
    backgroundColor: '#adb5bd',
    ...platformNoShadow,
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
