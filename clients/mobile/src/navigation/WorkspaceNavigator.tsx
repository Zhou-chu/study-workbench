import React, { useEffect } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Routes } from './types';
import { useSession } from '../session/SessionContext';
import { Action, Page, styles } from '../components/Primitives';
import { NotebookListScreen } from '../screens/NotebookListScreen';
import { WorkspaceScreen } from '../screens/WorkspaceScreen';
import { ReaderScreen } from '../screens/ReaderScreen';
import { NoteEditorScreen } from '../screens/NoteEditorScreen';
import { OutlineScreen } from '../screens/OutlineScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
const Stack = createNativeStackNavigator<Routes>();
export function WorkspaceNavigator() {
  const {session, state} = useSession();
  const {width, fontScale} = useWindowDimensions();
  const {top} = useSafeAreaInsets();
  const navigation = useNavigationContainerRef<Routes>();
  // At large font sizes, prefer full-width controls over a cramped sidebar.
  const wide = width >= 840 && width / Math.max(fontScale, 1) >= 600;
  useEffect(() => { void session.loadList(); }, [session, state.epoch]);
  return <NavigationContainer key={state.epoch} ref={navigation}>
    <View style={{flex: 1, flexDirection: 'row'}}>
      {/* Only the sidebar is outside the native header's top-inset ownership. */}
      {wide && <View style={{width: 280, paddingTop: top, borderRightWidth: 1, borderRightColor: '#D9E2DC'}} accessibilityLabel="工作台侧栏">
        <NotebookListScreen sidebar onOpen={notebookId => navigation.navigate('Workspace', {notebookId})} />
      </View>}
      <View key="main" style={{flex: 1, minWidth: 0}}>
        <Stack.Navigator screenOptions={{headerBackTitle: '返回', headerTintColor: '#203B36', contentStyle: {backgroundColor: '#FAF9F5'}}}>
          <Stack.Screen name="Notebooks" options={{title: '学习工作台'}}>
            {({navigation: nav}) => wide ? <Page><Text accessibilityRole="header" style={styles.title}>给思考留一点空间</Text><Text style={styles.text}>从侧栏选择一个工作台，开始阅读与记录。</Text><Action label="打开设置" onPress={() => nav.navigate('Settings')} /></Page> : <NotebookListScreen onOpen={notebookId => nav.navigate('Workspace', {notebookId})} onSettings={() => nav.navigate('Settings')} />}
          </Stack.Screen>
          <Stack.Screen name="Workspace" component={WorkspaceScreen} options={{title: '工作台'}} />
          <Stack.Screen name="Reader" component={ReaderScreen} options={{title: '公开文本'}} />
          <Stack.Screen name="Note" component={NoteEditorScreen} options={{title: '笔记'}} />
          <Stack.Screen name="Outline" component={OutlineScreen} options={{title: '任务回执', presentation: 'modal'}} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{title: '设置'}} />
        </Stack.Navigator>
      </View>
    </View>
  </NavigationContainer>;
}
