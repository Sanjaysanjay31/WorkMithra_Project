import React, { useState } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

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
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!formData.email) {
      Alert.alert('Error', 'Please enter your email first');
      return;
    }
    setLoading(true);
    try {
      // Mocking API call based on student_module.py logic
      // const response = await fetch(`${API_URL}/send-otp`, {
      //   method: 'POST',
      //   body: JSON.stringify({ email: formData.email, role: 'user' }),
      // });
      
      console.log('Sending OTP to', formData.email);
      setTimeout(() => {
        setIsOtpSent(true);
        setLoading(false);
        Alert.alert('Success', 'OTP sent to your email');
      }, 1500);
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Failed to send OTP');
    }
  };

  const handleVerifyOtp = async () => {
    if (!formData.otp) {
      Alert.alert('Error', 'Please enter the OTP');
      return;
    }
    setLoading(true);
    try {
      // Mocking API call
      console.log('Verifying OTP', formData.otp);
      setTimeout(() => {
        setIsOtpVerified(true);
        setLoading(false);
        Alert.alert('Success', 'Email verified successfully');
      }, 1000);
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Invalid OTP');
    }
  };

  const handleRegister = async () => {
    if (!isOtpVerified) {
      Alert.alert('Error', 'Please verify your email first');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      console.log('Registering user', formData);
      setTimeout(() => {
        setLoading(false);
        Alert.alert('Success', 'Registration successful', [
          { text: 'OK', onPress: () => router.replace('/login') }
        ]);
      }, 2000);
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Registration failed');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Registration', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.form}>
          <ThemedText type="subtitle" style={styles.label}>Name (as per Aadhaar)</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter your full name"
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
          />

          <ThemedText type="subtitle" style={styles.label}>Phone Number</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter your phone number"
            keyboardType="phone-pad"
            value={formData.phone}
            onChangeText={(text) => setFormData({ ...formData, phone: text })}
          />

          <ThemedText type="subtitle" style={styles.label}>Email Address</ThemedText>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Enter your email"
              keyboardType="email-address"
              autoCapitalize="none"
              value={formData.email}
              editable={!isOtpVerified}
              onChangeText={(text) => setFormData({ ...formData, email: text })}
            />
            {!isOtpVerified && (
              <TouchableOpacity 
                style={[styles.otpButton, isOtpSent && styles.otpButtonDisabled]} 
                onPress={handleSendOtp}
                disabled={loading || isOtpSent}
              >
                <Text style={styles.otpButtonText}>{isOtpSent ? 'Sent' : 'Send OTP'}</Text>
              </TouchableOpacity>
            )}
            {isOtpVerified && (
              <Ionicons name="checkmark-circle" size={24} color="green" style={{ marginLeft: 10 }} />
            )}
          </View>

          {isOtpSent && !isOtpVerified && (
            <View style={{ marginTop: 15 }}>
              <ThemedText type="subtitle" style={styles.label}>Enter OTP</ThemedText>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder="6-digit code"
                  keyboardType="number-pad"
                  value={formData.otp}
                  onChangeText={(text) => setFormData({ ...formData, otp: text })}
                />
                <TouchableOpacity 
                  style={styles.otpButton} 
                  onPress={handleVerifyOtp}
                  disabled={loading}
                >
                  <Text style={styles.otpButtonText}>Verify</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <ThemedText type="subtitle" style={styles.label}>Password</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Create a password"
            secureTextEntry
            value={formData.password}
            onChangeText={(text) => setFormData({ ...formData, password: text })}
          />

          <ThemedText type="subtitle" style={styles.label}>Confirm Password</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Confirm your password"
            secureTextEntry
            value={formData.confirmPassword}
            onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })}
          />

          <TouchableOpacity 
            style={[styles.registerButton, (!isOtpVerified || loading) && styles.disabledButton]} 
            onPress={handleRegister}
            disabled={!isOtpVerified || loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.registerButtonText}>Register</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/login')} style={styles.loginLink}>
            <Text style={styles.loginLinkText}>Already have an account? Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  form: {
    marginTop: 10,
  },
  label: {
    marginBottom: 8,
    fontSize: 16,
    color: '#6f42c1',
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  otpButton: {
    backgroundColor: '#6f42c1',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 10,
    marginLeft: 10,
    minWidth: 90,
    alignItems: 'center',
  },
  otpButtonDisabled: {
    backgroundColor: '#adb5bd',
  },
  otpButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  registerButton: {
    backgroundColor: '#ca202b',
    paddingVertical: 15,
    borderRadius: 30,
    alignItems: 'center',
    marginTop: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  disabledButton: {
    backgroundColor: '#adb5bd',
  },
  registerButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loginLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  loginLinkText: {
    color: '#6f42c1',
    fontSize: 16,
    fontWeight: '500',
  },
});
