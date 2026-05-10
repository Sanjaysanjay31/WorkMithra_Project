import { AIAssistant } from '@/components/ai-assistant';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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

  const handleRoleSelection = async (role: 'user' | 'worker') => {
    setLoading(true);
    try {
      // Mocking role assignment API call
      setTimeout(() => {
        setLoading(false);
        // Navigate to the HomePage for users, tabs for workers
        if (role === 'user') {
          router.replace('/homePage');
        } else {
          router.replace('/(tabs)');
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
      <AIAssistant />
      
      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Choose Your Role</ThemedText>
          <ThemedText style={styles.subtitle}>How do you want to use WorkMithra today?</ThemedText>
        </View>

        <View style={styles.optionsContainer}>
          {/* User Role Option */}
          <TouchableOpacity
            style={styles.roleCard}
            onPress={() => handleRoleSelection('user')}
            disabled={loading}
          >
            <View style={[styles.iconContainer, { backgroundColor: '#f0e6ff' }]}>
              <Ionicons name="person" size={40} color="#6F42C1" />
            </View>
            <View style={styles.roleInfo}>
              <Text style={styles.roleTitle}>I am a User</Text>
              <Text style={styles.roleDescription}>I want to find and hire skilled workers for my tasks.</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#adb5bd" />
          </TouchableOpacity>

          {/* Worker Role Option */}
          <TouchableOpacity
            style={styles.roleCard}
            onPress={() => handleRoleSelection('worker')}
            disabled={loading}
          >
            <View style={[styles.iconContainer, { backgroundColor: '#ffe8e8' }]}>
              <MaterialCommunityIcons name="hammer-wrench" size={40} color="#FF6B6B" />
            </View>
            <View style={styles.roleInfo}>
              <Text style={styles.roleTitle}>I am a Worker</Text>
              <Text style={styles.roleDescription}>I want to offer my skills and find work opportunities.</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#adb5bd" />
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#6F42C1" />
            <Text style={styles.loadingText}>Setting up your profile...</Text>
          </View>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 48,
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
  optionsContainer: {
    gap: 20,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 20,
  },
  roleInfo: {
    flex: 1,
  },
  roleTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 4,
  },
  roleDescription: {
    fontSize: 14,
    color: '#6c757d',
    lineHeight: 20,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6F42C1',
    fontWeight: '600',
  },
});
