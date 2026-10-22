import React from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useSession } from '../session/SessionContext';
import { Action, FixtureBanner, styles } from '../components/Primitives';
export function NotebookListScreen({ onOpen, sidebar = false, onSettings }: {onOpen: (id: string) => void; sidebar?: boolean; onSettings?: () => void}) {
  const { session, state } = useSession();
  return <View style={styles.page}>
    {!sidebar && <FixtureBanner />}
    <FlatList contentContainerStyle={styles.content} data={state.list.data ?? []} keyExtractor={item => item.id}
      ListFooterComponent={onSettings ? <Action label="打开设置" onPress={onSettings} /> : <View />}
      ListHeaderComponent={<View style={{gap: 12}}><Text accessibilityRole="header" style={styles.title}>开始今天的学习</Text>
        <Text style={styles.muted}>读一点，记一点。这里的示例可以放心试用。</Text></View>}
      ListEmptyComponent={state.list.status === 'loading' ? <ActivityIndicator accessibilityLabel="正在读取演示工作台" /> :
        state.list.status === 'error' ? <View style={{gap: 12}}><Text style={styles.text}>暂时没能打开演示列表。</Text><Action label="重新读取列表" onPress={() => { void session.loadList(); }} /></View> :
        <Text style={styles.text}>这里还没有工作台。</Text>}
      renderItem={({item}) => <View style={styles.card}><Text style={styles.heading}>{item.name}</Text>
        <Action label={`打开工作台 ${item.name}`} onPress={() => onOpen(item.id)} /></View>}
      ItemSeparatorComponent={() => <View style={{height: 16}} />} />
  </View>;
}
