import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type NativePickedAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export function pickImageWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    let settled = false;
    input.onchange = () => {
      settled = true;
      resolve(input.files?.[0] || null);
    };
    // Some browsers don't fire onchange if user cancels — best-effort fallback.
    setTimeout(() => { if (!settled) resolve(null); }, 60_000);
    input.click();
  });
}

export async function pickImageNative(): Promise<NativePickedAsset | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library permission denied');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    // No crop/edit screen — the user picks a photo and it is used as-is.
    // (allowsEditing:true forced an OS crop UI over every pick, which users
    // found confusing; round avatars are handled by the Avatar component's
    // container, not by cropping the source image.)
    allowsEditing: false,
    quality: 0.85,
  });
  if (res.canceled) return null;
  const a = res.assets?.[0];
  if (!a) return null;
  return { uri: a.uri, fileName: a.fileName, mimeType: a.mimeType };
}
