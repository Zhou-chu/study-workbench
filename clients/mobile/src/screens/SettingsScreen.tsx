import React from 'react';
import { Alert, Text } from 'react-native';
import { useSession } from '../session/SessionContext';
import { Action, Heading, Page, styles } from '../components/Primitives';
export function SettingsScreen() {
  const {session} = useSession();
  return <Page><Heading>关于这次演示</Heading>
    <Text style={styles.text}>所有内容都在内存中。没有连接服务、账号或模型；重启后恢复初始示例。</Text>
    <Text style={styles.muted}>原生构建、真机、读屏与键盘体验尚待验收。此源码演示不提供服务器配置或登录。</Text>
    <Heading>重新开始</Heading><Text style={styles.text}>重置会清除本次演示的草稿、保存结果和任务回执。</Text>
    <Action label="重置演示" onPress={() => Alert.alert('重置演示？', '本次演示的草稿、保存结果和任务回执都会清除，无法撤销。', [
      {text: '保留，继续学习', style: 'cancel'}, {text: '清除并重置', style: 'destructive', onPress: () => session.reset()},
    ])} /></Page>;
}
