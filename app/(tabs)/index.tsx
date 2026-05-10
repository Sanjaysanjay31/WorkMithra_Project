import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Dimensions, Image, Animated, Easing, TouchableOpacity, Text } from 'react-native';
import { AIAssistant } from '@/components/ai-assistant';
import { ThemedText } from '@/components/themed-text';
import { useRouter } from 'expo-router';

const { width, height } = Dimensions.get('window');

export default function LandingScreen() {
  const router = useRouter();
  const imageAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Subtle 3D-like scale animation for the hero image
    Animated.loop(
      Animated.sequence([
        Animated.timing(imageAnim, {
          toValue: 1.05,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(imageAnim, {
          toValue: 1,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      {/* AI Assistant Icon - Top Right */}
      <AIAssistant />

      {/* Hero Image Container - 4/5 Height */}
      <View style={styles.imageContainer}>
        <Animated.Image 
          source={require('@/assets/images/worker_client_handshake.png')} 
          style={[styles.heroImage, { transform: [{ scale: imageAnim }] }]}
          resizeMode="cover"
        />
        <View style={styles.overlay}>
          <ThemedText type="title" style={styles.appTitle}>WorkMithra</ThemedText>
          <ThemedText style={styles.tagline}>Connecting Workers & Clients Nearby</ThemedText>
        </View>
      </View>

      {/* Login & Register Buttons - 1/5 Height */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.button} 
          onPress={() => router.push('/login')}
        >
          <Text style={styles.buttonText}>Login</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { marginTop: 15, backgroundColor: '#ca202b' }]} 
          onPress={() => router.push('/register')}
        >
          <Text style={styles.buttonText}>Registration</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  imageContainer: {
    flex: 4,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    padding: 20,
    borderRadius: 25,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  appTitle: {
    color: '#6f42c1',
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  tagline: {
    color: '#333',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    fontWeight: '500',
  },
  footer: {
    flex: 1,
    paddingHorizontal: 48,
    paddingVertical: 16,
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  button: {
    backgroundColor: '#6f42c1',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    alignSelf: 'center',
    width: '80%',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  buttonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
  },
});

