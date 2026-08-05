import React                 from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator }              from '@react-navigation/stack';
import { StatusBar }                         from 'expo-status-bar';
import { SafeAreaProvider }                  from 'react-native-safe-area-context';
import { GestureHandlerRootView }            from 'react-native-gesture-handler';

import HomeScreen            from './src/screens/HomeScreen';
import FileUploadScreen      from './src/screens/FileUploadScreen';
import AnalysisPreviewScreen from './src/screens/AnalysisPreviewScreen';
import ScannerScreen         from './src/screens/ScannerScreen';
import ResultsScreen         from './src/screens/ResultsScreen';
import ApprovalScreen        from './src/screens/ApprovalScreen';
import HistoryScreen         from './src/screens/HistoryScreen';
import { ErrorBoundary }     from './src/components/ErrorBoundary';
import { colors }            from './src/theme/colors';
import { RootStackParamList }from './src/types/navigation';

const Stack = createStackNavigator<RootStackParamList>();

const NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg_primary,
    card:       colors.bg_secondary,
    text:       colors.text_primary,
    border:     colors.border,
  },
};

export default function App() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="light" backgroundColor={colors.bg_primary} />
          <NavigationContainer theme={NAV_THEME}>
            <Stack.Navigator screenOptions={{ headerShown: false, animationEnabled: true }}>
              <Stack.Screen name="Home"            component={HomeScreen} />
              <Stack.Screen name="FileUpload"      component={FileUploadScreen} />
              <Stack.Screen name="AnalysisPreview" component={AnalysisPreviewScreen} />
              <Stack.Screen name="Scanner"         component={ScannerScreen} />
              <Stack.Screen name="Results"         component={ResultsScreen} />
              <Stack.Screen name="Approval"        component={ApprovalScreen} />
              <Stack.Screen name="History"         component={HistoryScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
