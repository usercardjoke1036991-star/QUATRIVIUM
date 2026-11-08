// Web3 Polyfills - MUST be imported first
require('./polyfills.js');

// WalletConnect and other crypto polyfills
import '@walletconnect/react-native-compat';
import 'react-native-get-random-values';
import '@react-native-async-storage/async-storage';

import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';

LogBox.ignoreLogs(['User rejected the request', 'Request expired']);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
