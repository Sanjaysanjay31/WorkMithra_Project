import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width } = Dimensions.get('window');

export default function SwitchRoleScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<'user' | 'worker'>('user');

  const handleRoleSelection = async () => {
    setLoading(true);
    try {
      // Mocking role assignment API call
      setTimeout(() => {
        setLoading(false);
        // Navigate to the HomePage for users, tabs for workers
        if (role === 'user') {
          router.replace('/homePage');
        } else {
          router.replace('/worker_dashboard');
        }
      }, 1000);
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Failed to set role');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Select Role', headerShown: false }} />
      
      <View style={styles.headerTop}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#6F42C1" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Switch Role</ThemedText>
          <ThemedText style={styles.subtitle}>Choose your active profile to continue</ThemedText>
        </View>

        <View style={styles.form}>
          <View style={styles.roleContainer}>
            <TouchableOpacity 
              style={[styles.roleButton, role === 'user' && styles.roleButtonActive]}
              onPress={() => setRole('user')}
            >
              <Ionicons name="person" size={18} color={role === 'user' ? '#fff' : '#6F42C1'} />
              <Text style={[styles.roleText, role === 'user' && styles.roleTextActive]}>Client (User)</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.roleButton, role === 'worker' && styles.roleButtonActive]}
              onPress={() => setRole('worker')}
            >
              <Ionicons name="briefcase" size={18} color={role === 'worker' ? '#fff' : '#6F42C1'} />
              <Text style={[styles.roleText, role === 'worker' && styles.roleTextActive]}>Worker</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            onPress={handleRoleSelection}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Text style={styles.submitButtonText}>Switch Profile</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerTop: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 10,
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
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    marginTop: -80,
  },
  header: {
    marginBottom: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#212529',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#6c757d',
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  roleContainer: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 6,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  roleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  roleButtonActive: {
    backgroundColor: '#6F42C1',
    ...platformShadow('0px 4px 12px rgba(111,66,193,0.25)', '#6F42C1', 0, 4, 0.25, 6, 3),
  },
  roleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6F42C1',
  },
  roleTextActive: {
    color: '#fff',
  },
  submitButton: {
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
  },
  submitButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
