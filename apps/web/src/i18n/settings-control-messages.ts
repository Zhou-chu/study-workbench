export const settingsControlMessages = {
  en: {
    required: 'Enter a value for', invalid: 'Check this field:', modalities: 'Select at least one model type.',
    retry: 'Retry loading settings', failed: 'Could not load', loading: 'Loading',
    providers: 'provider information', credentials: 'saved configurations', models: 'registered models', defaults: 'default model assignments', setup: 'encryption status',
    dependent: 'Related actions stay unavailable until this information loads. You can still add a configuration when its prerequisites are ready.',
    unsupported: 'This provider is not supported by this app version. Update the app before adding a configuration.',
    notSent: 'The configuration was not sent. Check the fields and try again.',
    uncertain: 'The save could not be confirmed. Refresh and check saved configurations before trying again.',
    wholeNumber: 'Use a whole number of zero or greater.',
  },
  zh: {
    required: '请填写', invalid: '请检查：', modalities: '请至少选择一种模型类型。',
    retry: '重新加载设置', failed: '无法加载', loading: '正在加载',
    providers: '服务商信息', credentials: '已保存的配置', models: '已注册模型', defaults: '默认模型分配', setup: '加密状态',
    dependent: '相关操作需等待这些信息加载成功。添加配置的必要信息就绪后，仍可添加配置。',
    unsupported: '当前应用版本暂不支持此服务商，请更新应用后再添加配置。',
    notSent: '配置尚未发送，请检查填写内容后重试。',
    uncertain: '无法确认此次保存结果，请刷新并检查已保存的配置后再决定是否重试。',
    wholeNumber: '请输入大于或等于零的整数。',
  }
} as const;
export const settingsControlCopy = (locale: string) => settingsControlMessages[locale.startsWith('zh') ? 'zh' : 'en'];
