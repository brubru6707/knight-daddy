import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold } from "@expo-google-fonts/ibm-plex-mono";
import { IBMPlexSerif_500Medium } from "@expo-google-fonts/ibm-plex-serif";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/lib/session";
import { ListProvider } from "@/lib/list";
import { AdvancedProvider } from "@/lib/advanced";
import { ThemeProvider, useTheme } from "@/lib/theme";

function Root() {
  const { C, dark } = useTheme();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ground } }} />
    </>
  );
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({ IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold, IBMPlexSerif_500Medium });
  const ready = loaded || !!error; // if a font fails to load, show the app with the system font rather than hang
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ListProvider>
            <AdvancedProvider>
              <Root />
            </AdvancedProvider>
          </ListProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
