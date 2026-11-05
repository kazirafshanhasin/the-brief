import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { EAS_PROJECT_ID } from "./config";

// Show notifications while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Android needs channels before the permission prompt can appear (Android 13+). */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("digest", {
    name: "Scheduled briefings",
    description: "Your top three stories at the times you choose",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync("breaking", {
    name: "Breaking news",
    description: "Major, verified developments in your countries and topics",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

/** Ask for permission (if needed) and return this device's Expo push token. */
export async function registerForPush(): Promise<PushResult> {
  if (!Device.isDevice) return { ok: false, reason: "Notifications need a physical phone, not a simulator." };
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    granted = asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (!granted) return { ok: false, reason: "Notifications are turned off for The Brief in your phone’s settings." };
  try {
    const token = await Notifications.getExpoPushTokenAsync(EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined);
    return { ok: true, token: token.data };
  } catch {
    return { ok: false, reason: "Couldn’t reach the notification service. Try again when you’re online." };
  }
}
