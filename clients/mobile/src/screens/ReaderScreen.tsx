import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Routes } from '../navigation/types';
import { useSession } from '../session/SessionContext';
import { Action, Page, styles } from '../components/Primitives';
export function ReaderScreen({navigation}: NativeStackScreenProps<Routes, 'Reader'>) {
  const {session} = useSession(), asset = session.getPublicText();
  return <Page><Text accessibilityRole="header" style={styles.title}>一小段阅读</Text>
    <Text style={styles.muted}>{asset.label}</Text><Text selectable style={styles.text}>{asset.text}</Text>
    <Text style={styles.muted}>这是独立的公开示例，不会添加到工作台资料中。暂不支持 PDF 阅读。</Text>
    <Action label="返回工作台" onPress={() => navigation.goBack()} /></Page>;
}
