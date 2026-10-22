import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Routes } from '../navigation/types';
import { useSession } from '../session/SessionContext';
import { Action, Page, Status, styles } from '../components/Primitives';
import { QUEUED_MESSAGE } from '../fixture/FixtureRepository';
export function OutlineScreen({route, navigation}: NativeStackScreenProps<Routes, 'Outline'>) {
  const {session, state} = useSession(), id = route.params.notebookId, operation = state.operations[id];
  return <Page><Text accessibilityRole="header" style={styles.title}>演示大纲任务</Text>
    <Text style={styles.text}>只体验排队与查看回执，不会发送资料或调用模型。关闭后可以回来查看同一个任务。</Text>
    {!operation && <Action label="将演示任务加入队列" onPress={() => { void session.submitOutline(id); }} />}
    {operation?.status === 'pending' && <Status>正在提交本次演示任务…</Status>}
    {operation?.status === 'unknown' && <Status>提交结果暂不确定。已保留这次操作，不会重复提交。</Status>}
    {operation?.status === 'error' && <Status>演示任务未提交成功。已保留这次操作，不会自动重试。</Status>}
    {operation?.receipt && <><Status>{QUEUED_MESSAGE}</Status><Text style={styles.text}>这只是排队回执，还没有生成内容。</Text>
      <Text selectable style={styles.muted}>回执：{operation.receipt.job_id}</Text>
      <Text style={styles.text}>任务状态：{operation.job?.state ?? operation.receipt.state}</Text>
      <Action label="查看任务状态" busy={state.resumes[id] === 'loading'} onPress={() => { void session.resumeOutline(id); }} />
      {state.resumes[id] === 'error' && <Status>暂时无法读取状态。回执仍保留，可以稍后再查看，不会重新提交。</Status>}</>}
    <Action label="关闭任务" onPress={() => navigation.goBack()} />
  </Page>;
}
