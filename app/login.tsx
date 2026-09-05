import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BASE_URL } from '@/lib/api';
import { loginRequest } from '@/lib/auth-api';
import { ensurePushSetup } from '@/lib/push';
import { platformNoShadow, platformShadow } from '@/lib/shadow';
import { ensureSocket } from '@/lib/socket';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

export default function LoginScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'worker'>('user');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const notify = (title: string, msg?: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(msg ? `${title}\n\n${msg}` : title);
    } else {
      Alert.alert(title, msg);
    }
  };

  const handleLogin = async () => {
    if (!identifier || !password) {
      notify('Error', 'Please enter your email/phone and password');
      return;
    }
    setLoading(true);

    try {
      const data = await loginRequest(identifier, password, role);

      // A login is only valid if the server returned both a user id and a
      // token — never fall back to a guessed id.
      if (!data.user?.id || !data.access_token) {
        setLoading(false);
        notify('Login failed', 'Server response was missing credentials. Please try again.');
        return;
      }
      setLoading(false);
      // Trust the role the server returns for this account, not the toggle
      // the user picked — picking "Worker" with a client account must not
      // store a worker session.
      const serverRole = data.user.role === 'worker' ? 'worker' : 'user';
      try {
        const isEmail = identifier.includes('@');
        const authData = {
           id: data.user.id,
           phone: !isEmail ? identifier : (data.user.phone || undefined),
           email: isEmail ? identifier : (data.user.email || undefined),
           token: data.access_token,
           role: serverRole,
        };
        await storage.set('workmithra:auth', JSON.stringify(authData));
      } catch (e) {
        // If the session can't be persisted, navigating would just bounce the
        // user back to /login (the auth guard reads the token from storage).
        // Fail loudly here instead of silently stranding them.
        console.warn('Failed to persist session', e);
        notify('Login failed', 'Could not save your session on this device. Please try again.');
        return;
      }
      // Connect the realtime socket for the session now that the token is
      // persisted. ensureSocket() no-ops if anything is missing.
      ensureSocket();
      // Ask for notification permission + register the push token while the
      // login success is fresh — the OS prompt makes sense in this moment.
      void ensurePushSetup();
      if (serverRole === 'user') {
        router.replace('/homePage');
      } else {
        router.replace('/worker_dashboard');
      }
    } catch (error: any) {
      setLoading(false);
      // Always log the URL the phone actually tried — it appears in the Metro
      // terminal and instantly shows stale-env problems (e.g. 127.0.0.1 baked
      // into the bundle means Metro was started before the .env fix, from the
      // wrong folder, or without cache clear).
      console.warn('Login request failed', { url: `${BASE_URL}/login`, error: String(error?.message || error) });
      if (error?.name === 'AuthApiError') {
        notify('Login failed', error.message);
      } else {
        notify('Connection Error', 'Unable to reach the server. Please check your connection and ensure the backend is running.');
      }
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Login', headerShown: false }} />
      {/* Same as ai-assistant: window pans, KAV 'padding' lifts inputs above the keyboard. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#6F42C1" />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <View style={styles.titleContainer}>
              <ThemedText type="title" style={styles.title}>Welcome Back!</ThemedText>
              <Text style={styles.subtitle}>Glad to see you again. Login to your account.</Text>
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email or Phone</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="example@mail.com"
                    placeholderTextColor="#adb5bd"
                    autoCapitalize="none"
                    value={identifier}
                    onChangeText={setIdentifier}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={20} color="#6c757d" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your password"
                    placeholderTextColor="#adb5bd"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                    <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#6c757d" />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => router.push('/forgot-password')}
                style={styles.forgotPassword}
              >
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.loginButton, loading && styles.disabledButton]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Text style={styles.loginButtonText}>Login</Text>
                    <Ionicons name="arrow-forward" size={20} color="white" />
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.registerContainer}>
                <Text style={styles.registerText}>Don&apos;t have an account? </Text>
                <TouchableOpacity onPress={() => router.push('/register')}>
                  <Text style={styles.registerLink}>Register Now</Text>
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
    marginBottom: 40,
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
  inputGroup: {
    marginBottom: 20,
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
    paddingVertical: 14,
    fontSize: 16,
    color: '#212529',
  },
  eyeIcon: {
    padding: 8,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 32,
  },
  forgotPasswordText: {
    color: '#6F42C1',
    fontWeight: '600',
    fontSize: 14,
  },
  loginButton: {
    backgroundColor: '#6F42C1',
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...platformShadow('0px 4px 16px rgba(111,66,193,0.3)', '#6F42C1', 0, 4, 0.3, 8, 4),
  },
  disabledButton: {
    backgroundColor: '#adb5bd',
    ...platformNoShadow,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  registerText: {
    fontSize: 14,
    color: '#6c757d',
  },
  registerLink: {
    fontSize: 14,
    color: '#6F42C1',
    fontWeight: 'bold',
  },
});
