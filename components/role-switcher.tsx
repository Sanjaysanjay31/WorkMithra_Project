import { ThemedText } from '@/components/themed-text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

interface RoleSwitcherProps {
  currentRole: 'user' | 'worker';
  userId: number;
  onRoleChange?: (newRole: 'user' | 'worker') => void;
}

export const RoleSwitcher: React.FC<RoleSwitcherProps> = ({
  currentRole,
  userId,
  onRoleChange,
}) => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRoleSwitch = async (newRole: 'user' | 'worker') => {
    if (newRole === currentRole) {
      Alert.alert('Info', `You are already a ${newRole}`);
      return;
    }

    setLoading(true);
    try {
      // API call would go here
      // const response = await fetch(`/api/switch-role/${userId}`, {
      //   method: 'POST',
      //   body: JSON.stringify({ role: newRole }),
      // });
      
      setTimeout(() => {
        setLoading(false);
        Alert.alert(
          'Success',
          `Role switched to ${newRole}`,
          [{ text: 'OK', onPress: () => {
            setVisible(false);
            onRoleChange?.(newRole);
          }}]
        );
      }, 1000);
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Failed to switch role');
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.switchButton}
        onPress={() => setVisible(true)}
      >
        <View style={styles.roleIndicator}>
          {currentRole === 'worker' ? (
            <MaterialCommunityIcons name="hammer-wrench" size={16} color="white" />
          ) : (
            <Ionicons name="person" size={16} color="white" />
          )}
        </View>
        <Text style={styles.roleText}>{currentRole.toUpperCase()}</Text>
        <Ionicons name="chevron-down" size={16} color="#6F42C1" />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                Switch Role
              </ThemedText>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <Ionicons name="close" size={24} color="#212529" />
              </TouchableOpacity>
            </View>

            {/* User Role Option */}
            <TouchableOpacity
              style={[
                styles.roleOption,
                currentRole === 'user' && styles.roleOptionActive,
              ]}
              onPress={() => handleRoleSwitch('user')}
              disabled={loading}
            >
              <View style={styles.roleOptionIcon}>
                <Ionicons name="person" size={24} color="#FF6B6B" />
              </View>
              <View style={styles.roleOptionContent}>
                <Text style={styles.roleOptionTitle}>User</Text>
                <Text style={styles.roleOptionDesc}>
                  Find and hire skilled workers
                </Text>
              </View>
              {currentRole === 'user' && (
                <View style={styles.activeBadge}>
                  <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                </View>
              )}
            </TouchableOpacity>

            {/* Worker Role Option */}
            <TouchableOpacity
              style={[
                styles.roleOption,
                currentRole === 'worker' && styles.roleOptionActive,
              ]}
              onPress={() => handleRoleSwitch('worker')}
              disabled={loading}
            >
              <View style={styles.roleOptionIcon}>
                <MaterialCommunityIcons name="hammer-wrench" size={24} color="#4ECDC4" />
              </View>
              <View style={styles.roleOptionContent}>
                <Text style={styles.roleOptionTitle}>Worker</Text>
                <Text style={styles.roleOptionDesc}>
                  Offer skills and earn money
                </Text>
              </View>
              {currentRole === 'worker' && (
                <View style={styles.activeBadge}>
                  <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                </View>
              )}
            </TouchableOpacity>

            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#6F42C1" />
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0e6ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  roleIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6F42C1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6F42C1',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#e9ecef',
  },
  roleOptionActive: {
    backgroundColor: '#f0e6ff',
    borderColor: '#6F42C1',
  },
  roleOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  roleOptionContent: {
    flex: 1,
  },
  roleOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 4,
  },
  roleOptionDesc: {
    fontSize: 13,
    color: '#6c757d',
  },
  activeBadge: {
    marginLeft: 12,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
