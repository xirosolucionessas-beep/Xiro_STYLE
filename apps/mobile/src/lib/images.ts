import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

const MAX_WIDTH = 1600;

export interface PickedImage {
  uri: string;
  width: number;
}

export async function pickFromLibrary(limit: number): Promise<PickedImage[]> {
  if (limit <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map((asset) => ({ uri: asset.uri, width: asset.width }));
}

/** Devuelve null si el usuario niega el permiso de cámara. */
export async function takePhoto(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets[0]) return null;
  return { uri: result.assets[0].uri, width: result.assets[0].width };
}

export type CameraResult = { status: 'ok'; image: PickedImage } | { status: 'denied' } | { status: 'cancelled' };

/** Como `takePhoto`, pero distingue "permiso denegado" de "el usuario canceló" para poder explicarlo bien. */
export async function takePhotoResult(): Promise<CameraResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { status: 'ok', image: { uri: asset.uri, width: asset.width } } : { status: 'cancelled' };
}

/** Reduce a 1600 px de ancho máximo y comprime a JPEG antes de subir (ahorra datos del cliente y espacio del servidor). */
export async function prepareImage(image: PickedImage): Promise<string> {
  const context = ImageManipulator.manipulate(image.uri);
  if (image.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}

export async function toFormData(uri: string, field = 'photo'): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, 'photo.jpg');
  } else {
    form.append(field, { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  return form;
}

export async function uploadableImage(image: PickedImage, field = 'photo'): Promise<FormData> {
  return toFormData(await prepareImage(image), field);
}
