// Polyfills: deben cargarse antes que cualquier otro módulo.
import './utils/earlyShims';
import 'react-native-get-random-values';
import '@react-native-async-storage/async-storage';

import { registerRootComponent } from 'expo';

import App from './App';

require('./polyfills.js');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
