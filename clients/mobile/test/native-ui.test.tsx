import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Dimensions } from 'react-native';
import * as SafeArea from 'react-native-safe-area-context';
import App from '../src/App';
import { FixtureSession } from '../src/session/FixtureSession';
import { FixtureRepository, DEMO_BANNER, QUEUED_MESSAGE, SAVED_MESSAGE } from '../src/fixture/FixtureRepository';

beforeEach(() => { Dimensions.set({window:{width:390,height:844,scale:1,fontScale:1},screen:{width:390,height:844,scale:1,fontScale:1}}); });

async function workspace() {
  fireEvent.press(await screen.findByLabelText('打开工作台 Public synthetic workspace'));
  await screen.findByText('资料');
}
async function editor() {
  await workspace();
  fireEvent.press(screen.getByLabelText('编辑笔记 Synthetic revision example'));
  return screen.findByLabelText('笔记正文');
}
test('native fixture flow keeps public text separate from empty sources and queue from output', async () => {
  render(<App />); await workspace();
  expect(screen.getByText('还没有资料。可以先读一段独立的公开示例。')).toBeTruthy();
  fireEvent.press(screen.getByText('阅读公开示例'));
  expect(await screen.findByText('公开合成文本 · 非 PDF · 不属于服务端资料版本')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('返回工作台'));
  fireEvent.press(await screen.findByText('演示大纲任务'));
  fireEvent.press(screen.getByText('将演示任务加入队列'));
  expect(await screen.findByText(QUEUED_MESSAGE)).toBeTruthy();
  expect(screen.getByText('这只是排队回执，还没有生成内容。')).toBeTruthy();
  fireEvent.press(screen.getByText('关闭任务')); fireEvent.press(await screen.findByText('演示大纲任务'));
  expect(await screen.findByText(QUEUED_MESSAGE)).toBeTruthy();
  fireEvent.press(screen.getByText('查看任务状态'));
  expect(await screen.findByText('任务状态：queued')).toBeTruthy();
});
test('back and width change preserve draft; successful save is explicitly ephemeral', async () => {
  const s = new FixtureSession(); render(<App session={s} />); const input = await editor();
  fireEvent.changeText(input,'我的新笔记');
  act(() => { Dimensions.set({window:{width:1024,height:768,scale:1,fontScale:1},screen:{width:1024,height:768,scale:1,fontScale:1}}); });
  expect(screen.getByLabelText('工作台侧栏')).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText('笔记正文').props.value).toBe('我的新笔记'));
  for (const [width, fontScale] of [[768,1],[390,1],[1024,2]]) {
    act(() => { Dimensions.set({window:{width:width!,height:844,scale:1,fontScale:fontScale!},screen:{width:width!,height:844,scale:1,fontScale:fontScale!}}); });
    expect(screen.getByLabelText('笔记正文').props.value).toBe('我的新笔记');
  }
  fireEvent.press(screen.getByLabelText('返回工作台'));
  fireEvent.press(await screen.findByLabelText('编辑笔记 Synthetic revision example'));
  expect((await screen.findByLabelText('笔记正文')).props.value).toBe('我的新笔记');
  fireEvent.press(screen.getByText('保存本次演示笔记')); expect(await screen.findByText(SAVED_MESSAGE)).toBeTruthy();
  expect(screen.getByLabelText('保存本次演示笔记')).toBeDisabled();
});
test.each(['unknown','conflict'] as const)('%s note result preserves text and never says saved', async saveMode => {
  render(<App session={new FixtureSession(() => new FixtureRepository({saveMode}))} />);
  fireEvent.changeText(await editor(),'请保留'); fireEvent.press(screen.getByText('保存本次演示笔记'));
  expect(await screen.findByText(saveMode==='unknown'?'保存结果暂不确定。草稿仍在这里，请勿重复提交。':'版本有变化，草稿已保留。此演示不会自动覆盖或合并。')).toBeTruthy();
  expect(screen.getByLabelText('笔记正文').props.value).toBe('请保留'); expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
});
test('settings is separate and reset requires confirmation', async () => {
  const s = new FixtureSession(); const confirm = jest.spyOn(Alert,'alert'); render(<App session={s} />);
  await screen.findByText('Public synthetic workspace'); expect(screen.queryByText('重置演示')).toBeNull();
  fireEvent.press(screen.getByLabelText('打开设置')); fireEvent.press(await screen.findByText('重置演示'));
  expect(confirm).toHaveBeenCalledWith('重置演示？',expect.stringContaining('草稿'),expect.any(Array));
  expect(s.getSnapshot().epoch).toBe(0); expect(screen.getByText(DEMO_BANNER)).toBeTruthy(); confirm.mockRestore();
});
test('wide landing uses one sidebar index and a calm main welcome', async () => {
  Dimensions.set({window:{width:1024,height:768,scale:1,fontScale:1},screen:{width:1024,height:768,scale:1,fontScale:1}});
  render(<App />);
  await screen.findByLabelText('打开工作台 Public synthetic workspace');
  expect(screen.getAllByLabelText('打开工作台 Public synthetic workspace')).toHaveLength(1);
  expect(screen.getByText('从侧栏选择一个工作台，开始阅读与记录。')).toBeTruthy();
});
test('empty and failed list are readable, and read-only retry can recover', async () => {
  const repo = new FixtureRepository();
  const list = jest.spyOn(repo,'listNotebooks').mockRejectedValueOnce(new Error('fixture failure')).mockResolvedValue([]);
  render(<App session={new FixtureSession(() => repo)} />);
  expect(await screen.findByText('暂时没能打开演示列表。')).toBeTruthy();
  fireEvent.press(screen.getByText('重新读取列表'));
  expect(await screen.findByText('这里还没有工作台。')).toBeTruthy(); expect(list).toHaveBeenCalledTimes(2);
});
test('loading list has accessible progress and does not invent notebooks', async () => {
  const repo = new FixtureRepository(); let finish!: (items: {id:string;name:string}[]) => void;
  repo.listNotebooks = () => new Promise(resolve => {finish=resolve;});
  render(<App session={new FixtureSession(() => repo)} />);
  expect(screen.getByLabelText('正在读取演示工作台')).toBeTruthy();
  expect(screen.queryByText('Public synthetic workspace')).toBeNull();
  await act(async () => {finish([]);});
  expect(screen.getByText('这里还没有工作台。')).toBeTruthy();
});
test('missing note content is not silently saved empty; explicit writing enables save', async () => {
  const initial = await new FixtureRepository().getWorkspace('notebook:synthetic'); delete initial.notes[0]!.content;
  render(<App session={new FixtureSession(() => new FixtureRepository({workspace:initial}))} />);
  const input = await editor();
  expect(screen.getByText('这份记录没有提供正文。输入文字后才能保存，不会把缺失正文当作空笔记。')).toBeTruthy();
  expect(screen.getByLabelText('保存本次演示笔记')).toBeDisabled();
  fireEvent.changeText(input,'明确写下的新正文'); expect(screen.getByLabelText('保存本次演示笔记')).toBeEnabled();
});
test('unknown outline survives dismiss without a retry or generated result', async () => {
  const repo = new FixtureRepository({submitMode:'unknown'}), submit = jest.spyOn(repo,'submitOutline');
  render(<App session={new FixtureSession(() => repo)} />); await workspace();
  fireEvent.press(screen.getByText('演示大纲任务')); fireEvent.press(screen.getByText('将演示任务加入队列'));
  expect(await screen.findByText('提交结果暂不确定。已保留这次操作，不会重复提交。')).toBeTruthy();
  fireEvent.press(screen.getByText('关闭任务')); fireEvent.press(await screen.findByText('演示大纲任务'));
  expect(screen.queryByText('将演示任务加入队列')).toBeNull(); expect(screen.queryByText(QUEUED_MESSAGE)).toBeNull(); expect(submit).toHaveBeenCalledTimes(1);
});
test('confirmed reset clears drafts and returns to list, cancellation keeps everything', async () => {
  const s = new FixtureSession(), confirm = jest.spyOn(Alert,'alert');
  await s.openWorkspace('notebook:synthetic'); s.openNote('note:synthetic'); s.editNote('note:synthetic','保留或明确清除');
  render(<App session={s} />);
  await screen.findByText('Public synthetic workspace');
  fireEvent.press(screen.getByLabelText('打开设置')); fireEvent.press(await screen.findByText('重置演示'));
  const buttons = confirm.mock.calls.at(-1)?.[2]; expect(buttons?.[0]?.style).toBe('cancel'); expect(s.getSnapshot().epoch).toBe(0);
  expect(s.getSnapshot().drafts['note:synthetic']?.content).toBe('保留或明确清除');
  await act(async () => {buttons?.[1]?.onPress?.();});
  expect(s.getSnapshot().epoch).toBe(1); expect(s.getSnapshot().drafts).toEqual({});
  expect(await screen.findByLabelText('打开工作台 Public synthetic workspace')).toBeTruthy(); confirm.mockRestore();
});

test('wide sidebar owns the nonzero top inset without padding the native-header root', async () => {
  Dimensions.set({window:{width:1024,height:768,scale:1,fontScale:1},screen:{width:1024,height:768,scale:1,fontScale:1}});
  const insets = jest.spyOn(SafeArea, 'useSafeAreaInsets').mockReturnValue({top:44,bottom:34,left:0,right:0});
  try {
    const rendered = render(<App />);
    await screen.findByLabelText('打开工作台 Public synthetic workspace');
    expect(screen.getByLabelText('工作台侧栏')).toHaveStyle({paddingTop:44});
    // The native-stack header, not the app root, remains the main pane's top owner.
    expect(rendered.UNSAFE_getAllByType(SafeArea.SafeAreaView).map(view => view.props.edges))
      .toEqual([['bottom', 'left', 'right']]);
  } finally {
    insets.mockRestore();
  }
});
