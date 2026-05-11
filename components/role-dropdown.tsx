import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Animated } from 'react-native';
import { platformShadow } from '@/lib/shadow';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

interface RoleDropdownProps {
  title: string;
  type: 'login' | 'register';
}

export function RoleDropdown({ title, type }: RoleDropdownProps) {
  const [expanded, setExpanded] = useState(false);
  const [animation] = useState(new Animated.Value(0));
  const router = useRouter();

  const toggleDropdown = () => {
    const toValue = expanded ? 0 : 1;
    Animated.spring(animation, {
      toValue,
      useNativeDriver: false,
    }).start();
    setExpanded(!expanded);
  };

  const dropdownHeight = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 120],
  });

  const handleRoleSelect = (role: 'worker' | 'client') => {
    setExpanded(false);
    animation.setValue(0);
    if (type === 'login') {
      router.push(`/(tabs)?role=${role}`); // For now, redirect to home
    } else {
      router.push(`/(tabs)?role=${role}&action=register`);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.mainButton, expanded && styles.mainButtonExpanded]} 
        onPress={toggleDropdown}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>{title}</Text>
        <Ionicons 
          name={expanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color="white" 
        />
      </TouchableOpacity>

      <Animated.View style={[styles.dropdown, { height: dropdownHeight, opacity: animation }]}>
        <TouchableOpacity 
          style={styles.option} 
          onPress={() => handleRoleSelect('worker')}
        >
          <Ionicons name="hammer-outline" size={20} color="#6f42c1" />
          <Text style={styles.optionText}>Worker {title}</Text>
        </TouchableOpacity>
        
        <View style={styles.separator} />

        <TouchableOpacity 
          style={styles.option} 
          onPress={() => handleRoleSelect('client')}
        >
          <Ionicons name="person-outline" size={20} color="#6f42c1" />
          <Text style={styles.optionText}>Client {title}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 10,
    zIndex: 100,
  },
  mainButton: {
    backgroundColor: '#6f42c1',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 25,
    borderRadius: 30,
    ...platformShadow('0px 2px 4px rgba(0,0,0,0.2)', '#000', 0, 2, 0.2, 2, 3),
  },
  mainButtonExpanded: {
    backgroundColor: '#ca202b',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  dropdown: {
    backgroundColor: 'white',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
    ...platformShadow('0px 4px 8px rgba(0,0,0,0.3)', '#000', 0, 4, 0.3, 4, 5),
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 25,
  },
  optionText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 15,
    fontWeight: '500',
  },
  separator: {
    height: 1,
    backgroundColor: '#eee',
    marginHorizontal: 20,
  },
});
