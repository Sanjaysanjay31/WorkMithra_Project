import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Dimensions, Image, Animated, Easing, TouchableOpacity, Text } from 'react-native';
import { platformShadow } from '@/lib/shadow';
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
    ...platformShadow('0px 4px 10px rgba(0,0,0,0.3)', '#000', 0, 4, 0.3, 5, 10),
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
    ...platformShadow('0px 2px 4px rgba(0,0,0,0.2)', '#000', 0, 2, 0.2, 2, 3),
  },
  buttonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
  },
});

