import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, Modal, View, Text, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

const { width, height } = Dimensions.get('window');

export function AIAssistant() {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.fab} 
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="sparkles" size={24} color="white" />
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent={true}
        visible={visible}
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={80} style={styles.blurContainer}>
            <View style={styles.modalContent}>
              <View style={styles.header}>
                <ThemedText type="subtitle" style={styles.headerTitle}>WorkMithra AI Assistant</ThemedText>
                <TouchableOpacity onPress={() => setVisible(false)}>
                  <Ionicons name="close-circle" size={32} color="#6f42c1" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scrollContent}>
                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>How to use this app?</ThemedText>
                  <ThemedText style={styles.cardText}>
                    1. Choose if you are a Worker (looking for work) or a Client (looking for help).
                  </ThemedText>
                  <ThemedText style={styles.cardText}>
                    2. Register with your details.
                  </ThemedText>
                  <ThemedText style={styles.cardText}>
                    3. Connect with people nearby for quick jobs!
                  </ThemedText>
                </ThemedView>

                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>Voice Help</ThemedText>
                  <ThemedText style={styles.cardText}>
                    Tap the microphone icon to talk to me. I can help you find jobs or workers just by listening!
                  </ThemedText>
                  <TouchableOpacity style={styles.voiceButton}>
                    <Ionicons name="mic" size={40} color="white" />
                    <Text style={styles.voiceButtonText}>Tap to Speak</Text>
                  </TouchableOpacity>
                </ThemedView>

                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>AI Backend Configuration</ThemedText>
                  <ThemedText style={styles.cardText}>
                    Note: To enable full AI chat, get a free API key from Google AI Studio (Gemini Flash). 
                    It's free and perfect for this assistant!
                  </ThemedText>
                </ThemedView>
              </ScrollView>
            </View>
          </BlurView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1000,
  },
  fab: {
    backgroundColor: '#6f42c1',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  blurContainer: {
    height: height * 0.7,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
  },
  modalContent: {
    flex: 1,
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    color: '#6f42c1',
  },
  scrollContent: {
    flex: 1,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  cardTitle: {
    marginBottom: 10,
    color: '#333',
  },
  cardText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#555',
    marginBottom: 5,
  },
  voiceButton: {
    backgroundColor: '#ca202b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 30,
    marginTop: 10,
  },
  voiceButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});
