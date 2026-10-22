import React from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Routes } from '../navigation/types';
import { useSession } from '../session/SessionContext';
import { Action, Page, Status, styles } from '../components/Primitives';
import { SAVED_MESSAGE } from '../fixture/FixtureRepository';
const messages = {
  clean: '笔记还没有改动。', dirty: '有未保存的改动，返回时草稿仍会保留。', saving: '正在保存本次演示笔记…', saved: SAVED_MESSAGE,
  conflict: '版本有变化，草稿已保留。此演示不会自动覆盖或合并。',
  unknown: '保存结果暂不确定。草稿仍在这里，请勿重复提交。',
  error: '这次没有保存成功，草稿还在。你可以再试一次。',
};
export function NoteEditorScreen({route, navigation}: NativeStackScreenProps<Routes, 'Note'>) {
  const {session, state} = useSession(), draft = state.drafts[route.params.noteId];
  const headerHeight = useHeaderHeight();
  if (!draft) return <Page><Text style={styles.text}>未找到这份演示笔记，请返回工作台重新打开。</Text></Page>;
  return <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
    <Page><Text accessibilityRole="header" style={styles.title}>留下一点想法</Text>
      <Text style={styles.muted}>基于版本 {draft.expectedRevision} · 草稿只在本次演示中保留，重启后重置。</Text>
      {typeof draft.content !== 'string' && <Text style={styles.text}>这份记录没有提供正文。输入文字后才能保存，不会把缺失正文当作空笔记。</Text>}
      <TextInput accessibilityLabel="笔记正文" accessibilityHint="多行编辑。返回工作台会保留本次演示草稿。" multiline
        value={draft.content ?? ''} onChangeText={text => session.editNote(draft.noteId, text)} placeholder="慢慢写下你的想法…"
        textAlignVertical="top" style={[styles.text, styles.card, {minHeight: 220}]} />
      <Status>{messages[draft.status]}</Status>
      <Action label="保存本次演示笔记" busy={draft.status === 'saving'}
        disabled={draft.status !== 'dirty' && draft.status !== 'error'} onPress={() => { void session.saveNote(draft.noteId); }} />
      <Action label="返回工作台" onPress={() => navigation.goBack()} />
    </Page>
  </KeyboardAvoidingView>;
}
