// Native runtime only: these JS tests are NOT device/navigation gesture acceptance.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-screens', () => {
  const actual = jest.requireActual('react-native-screens');
  const React = require('react');
  const {View} = require('react-native');
  return {...actual,
    Screen: View, ScreenContainer: View, ScreenStack: View,
    ScreenStackItem: React.forwardRef((props, ref) => React.createElement(View, {...props, ref})),
    ScreenStackHeaderConfig: View, ScreenStackHeaderSubview: View,
    ScreenStackHeaderBackButtonImage: View,
  };
});
