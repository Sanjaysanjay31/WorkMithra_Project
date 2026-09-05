import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { UploadFilePart } from '@/lib/upload';

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
    // MediaTypeOptions is deprecated — mediaTypes now takes MediaType strings.
    mediaTypes: ['images'],
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

export type PickedImage = {
  /** Ready-to-upload part for uploadMultipart (web File or native uri part). */
  part: UploadFilePart;
  /** Local preview URL (web blob: URL or native file uri). */
  preview: string;
};

/**
 * Cross-platform pick: web file input or native image library, normalized to
 * one UploadFilePart plus a preview URL. Returns null when the user cancels.
 * Uploads must still go through uploadMultipart (XHR) — global fetch rejects
 * { uri, name, type } parts on native with "Unsupported FormDataPart".
 */
export async function pickImageWithPreview(
  fallbackName = 'photo.jpg',
): Promise<PickedImage | null> {
  if (Platform.OS === 'web') {
    const file = await pickImageWeb();
    if (!file) return null;
    return { part: file, preview: URL.createObjectURL(file) };
  }
  const asset = await pickImageNative();
  if (!asset) return null;
  const name = asset.fileName || asset.uri.split('/').pop() || fallbackName;
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime =
    asset.mimeType ||
    (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  return { part: { uri: asset.uri, name, type: mime }, preview: asset.uri };
}
