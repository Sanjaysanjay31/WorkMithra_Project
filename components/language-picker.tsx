import { ALL_LANGS, LangCode, LANGS } from '@/lib/ai';
import { storage } from '@/lib/storage';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const PINNED_KEY = 'workmithra:pinned_langs';

/**
 * Language selector used by the AI assistant: a row of pinned language chips
 * plus a searchable "More" panel with pin/unpin. Owns its own pinned-list
 * persistence so the parent only cares about the selected language.
 */
export default function LanguagePicker({
  lang,
  onSelect,
}: {
  lang: LangCode;
  onSelect: (code: LangCode) => void;
}) {
  const [pinned, setPinned] = useState<LangCode[]>(LANGS.map((l) => l.code));
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.get(PINNED_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) setPinned(arr);
        }
      } catch {}
    })();
  }, []);

  function togglePin(code: LangCode) {
    setPinned((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      storage.set(PINNED_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  const filtered = ALL_LANGS.filter((l) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return l.english.toLowerCase().includes(q) || l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
  });

  return (
    <View>
      <View style={styles.langRow}>
        {ALL_LANGS.filter((l) => pinned.includes(l.code)).map((l) => (
          <TouchableOpacity key={l.code} style={[styles.langChip, lang === l.code && styles.langChipActive]} onPress={() => onSelect(l.code)}>
            <Text style={[styles.langText, lang === l.code && styles.langTextActive]}>{l.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.langChip, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#6F42C1' }]} onPress={() => setShowSearch((v) => !v)}>
          <Ionicons name={showSearch ? 'close' : 'add'} size={11} color="#6F42C1" />
          <Text style={[styles.langText, { color: '#6F42C1' }]}> More</Text>
        </TouchableOpacity>
      </View>

      {showSearch && (
        <View style={styles.langSearchBox}>
          <View style={styles.langSearchInputWrap}>
            <Ionicons name="search" size={14} color="#999" />
            <TextInput
              style={styles.langSearchInput}
              placeholder="Search language (e.g. Bengali, Marathi)"
              placeholderTextColor="#999"
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <View style={styles.langGrid}>
            {filtered.map((l) => {
              const isPinned = pinned.includes(l.code);
              const isActive = lang === l.code;
              return (
                <View key={l.code} style={styles.langGridItem}>
                  <TouchableOpacity
                    style={[styles.langChip, isActive && styles.langChipActive]}
                    onPress={() => onSelect(l.code)}
                  >
                    <Text style={[styles.langText, isActive && styles.langTextActive]}>
                      {l.label} <Text style={{ opacity: 0.6, fontSize: 10 }}>({l.english})</Text>
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => togglePin(l.code)} style={styles.pinBtn}>
                    <Ionicons name={isPinned ? 'pin' : 'pin-outline'} size={14} color={isPinned ? '#10b981' : '#999'} />
                  </TouchableOpacity>
                </View>
              );
            })}
            {filtered.length === 0 && <Text style={styles.langEmpty}>No language matches &quot;{query}&quot;</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  langChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#f0f0f0' },
  langChipActive: { backgroundColor: '#6F42C1' },
  langText: { fontSize: 11, fontWeight: '600', color: '#333' },
  langTextActive: { color: '#fff' },
  langSearchBox: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 8, marginBottom: 8 },
  langSearchInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  langSearchInput: { flex: 1, fontSize: 12, color: '#333', paddingVertical: 4 },
  langGrid: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  langGridItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingRight: 4 },
  pinBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  langEmpty: { fontSize: 11, color: '#999', padding: 8 },
});
