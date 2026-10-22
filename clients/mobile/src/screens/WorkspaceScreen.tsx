import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Routes } from '../navigation/types';
import { useSession } from '../session/SessionContext';
import { Action, Heading, Page, styles } from '../components/Primitives';
export function WorkspaceScreen({ route, navigation }: NativeStackScreenProps<Routes, 'Workspace'>) {
  const { session, state } = useSession();
  useEffect(() => { void session.openWorkspace(route.params.notebookId); }, [session, route.params.notebookId]);
  const workspace = state.workspace.data;
  if (state.notebookId !== route.params.notebookId || state.workspace.status === 'loading' || state.workspace.status === 'idle') {
    return <Page><ActivityIndicator accessibilityLabel="正在读取工作台" /></Page>;
  }
  if (state.workspace.status === 'error' || !workspace) return <Page><Text style={styles.text}>暂时没能打开这个工作台。你的演示草稿仍然保留。</Text>
    <Action label="重新读取工作台" onPress={() => { void session.openWorkspace(route.params.notebookId); }} /></Page>;
  return <Page><Text accessibilityRole="header" style={styles.title}>{workspace.notebook.name}</Text>
    <Heading>资料</Heading>
    {workspace.sources.length === 0 ? <Text style={styles.text}>还没有资料。可以先读一段独立的公开示例。</Text> : workspace.sources.map(source =>
      <View key={source.source_id} style={styles.card}><Text style={styles.text}>{source.title ?? '未提供资料标题'}</Text>
        <Text selectable style={styles.muted}>{source.source_id} · {source.versions.length} 个版本（此演示未提供可读正文）</Text></View>)}
    <Action label="阅读公开示例" onPress={() => navigation.navigate('Reader')} />
    <Heading>笔记</Heading>
    {workspace.notes.length === 0 && <Text style={styles.text}>还没有笔记。此演示暂不支持新建。</Text>}
    {workspace.notes.map(note => <View key={note.id} style={styles.card}><Text style={styles.heading}>{note.title ?? '未命名笔记'}</Text>
      <Text style={styles.muted}>版本 {state.drafts[note.id]?.expectedRevision ?? note.revision}</Text>
      <Action label={`编辑笔记 ${note.title ?? '未命名笔记'}`} onPress={() => { session.openNote(note.id); navigation.navigate('Note', {noteId: note.id}); }} /></View>)}
    <Heading>整理思路</Heading><Text style={styles.text}>试一试任务回执。不会连接模型，也不会生成大纲。</Text>
    <Action label="演示大纲任务" onPress={() => navigation.navigate('Outline', {notebookId: workspace.notebook.id})} />
    <Heading>保留的记录</Heading><Text style={styles.muted}>任务 {workspace.jobs.length} · 对话 {workspace.turns.length} · 历史 {workspace.legacy_history.length}</Text>
    {workspace.jobs.map((job, index) => <Text key={index} selectable style={styles.muted}>{typeof job.job_id === 'string' ? job.job_id : '未提供任务标识'} · {typeof job.state === 'string' ? job.state : '未提供状态'}</Text>)}
    <Text style={styles.muted}>这些记录仅供查看，不提供历史重放。未知字段原样保留，不推断生成结果。</Text>
  </Page>;
}
