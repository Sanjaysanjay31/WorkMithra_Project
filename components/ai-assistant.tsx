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

              <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>How to use this app?</ThemedText>
                  <ThemedText style={styles.cardText}>1. Pick Worker or Client.</ThemedText>
                  <ThemedText style={styles.cardText}>2. Register your details.</ThemedText>
                  <ThemedText style={styles.cardText}>3. Connect nearby for quick jobs!</ThemedText>
                </ThemedView>

                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>Voice Help</ThemedText>
                  <ThemedText style={styles.cardText}>
                    Tap the mic to talk. I'll help find jobs or workers.
                  </ThemedText>
                  <TouchableOpacity style={styles.voiceButton}>
                    <Ionicons name="mic" size={20} color="white" />
                    <Text style={styles.voiceButtonText}>Tap to Speak</Text>
                  </TouchableOpacity>
                </ThemedView>

                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>AI Backend</ThemedText>
                  <ThemedText style={styles.cardText}>
                    Add a free Gemini Flash API key to enable full AI chat.
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
    width: '100%',
    maxWidth: 360,
    height: '100%',
    maxHeight: 803,
    alignSelf: 'center',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitle: {
    color: '#6f42c1',
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
  },
  scrollContent: {
    flex: 1,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1,
  },
  cardTitle: {
    marginBottom: 4,
    color: '#333',
    fontSize: 13,
    lineHeight: 16,
  },
  cardText: {
    fontSize: 12,
    lineHeight: 15,
    color: '#555',
    marginBottom: 1,
  },
  voiceButton: {
    backgroundColor: '#ca202b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    marginTop: 6,
    alignSelf: 'center',
  },
  voiceButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 6,
  },
});
