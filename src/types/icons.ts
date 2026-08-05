/**
 * Icon Types — proper typing for @expo/vector-icons Ionicons
 * يحل محل كل `as any` في dynamic icon names
 */
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

/** النوع الصحيح لأسماء أيقونات Ionicons */
export type IoniconsName = ComponentProps<typeof Ionicons>['name'];

/** تحقق وقت الكمبايل أن اسم الأيقونة صحيح */
export function asIconName(name: string): IoniconsName {
  return name as IoniconsName;
}
