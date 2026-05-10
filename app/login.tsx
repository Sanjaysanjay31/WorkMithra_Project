import { AIAssistant } from '@/components/ai-assistant';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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

// Use 10.0.2.2 for Android emulator to reach localhost on host machine
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export default function LoginScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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

    // Check locally-registered credentials first (works offline)
    try {
      const cached = await storage.get('workmithra:auth');
      if (cached) {
        const auth = JSON.parse(cached);
        const idMatch = identifier === auth.phone || identifier === auth.email;
        if (idMatch && password === auth.password) {
          setLoading(false);
          router.replace('/switch_role');
          return;
        }
      }
    } catch {}
    try {
      console.log(`Connecting to: ${BASE_URL}/login`);
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      let data: any = {};
      try { data = await response.json(); } catch {}

      if (response.ok) {
        setLoading(false);
        router.replace('/switch_role');
      } else {
        setLoading(false);
        notify('Login failed', data.detail || `Server responded with ${response.status}`);
      }
    } catch (error: any) {
      setLoading(false);
      const proceed = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.confirm(`Unable to reach backend at ${BASE_URL}.\n\nContinue in offline/demo mode?`)
        : false;
      if (proceed) {
        router.replace('/switch_role');
      } else {
        notify('Connection Error', `Unable to connect to server at ${BASE_URL}. Please ensure backend is running.`);
      }
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Login', headerShown: false }} />
      <AIAssistant />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                <Text style={styles.registerText}>Don't have an account? </Text>
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
    elevation: 4,
    shadowColor: '#6F42C1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  disabledButton: {
    backgroundColor: '#adb5bd',
    shadowOpacity: 0,
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
