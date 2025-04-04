import { useCallback, useMemo } from 'react';
import {
  selectAppData,
  selectAppDataByPath,
  selectPermissions,
  selectPolls,
  selectSessionStore,
  selectTrackByID,
  useHMSActions,
  useHMSStore,
  useHMSVanillaStore,
} from '@100mslive/react-sdk';
import { UserPreferencesKeys, useUserPreferences } from '../hooks/useUserPreferences';
import { APP_DATA, POLL_STATE, SESSION_STORE_KEY, UI_SETTINGS } from '../../common/constants';

/**
 * fields saved related to UI settings in store's app data can be
 * accessed using this hook. key is optional if not passed
 * the whole UI settings object is returned. Usage -
 * 1. val = useUiSettings("isAudioOnly");
 *    console.log(val); // false
 * 2. val = useUISettings();
 *    console.log(val); // {isAudioOnly: false}
 * @param {string | undefined} uiSettingKey
 */
export const useUISettings = uiSettingKey => {
  const uiSettings = useHMSStore(selectAppDataByPath(APP_DATA.uiSettings, uiSettingKey));
  return uiSettings;
};

/**
 * fields saved related to UI settings in store's app data can be
 * accessed using this hook. key is optional if not passed
 * the whole UI settings object is returned. Usage -
 * [val, setVal] = useUiSettings("isAudioOnly");
 * console.log(val); // false
 * setVal(true);
 * @param {string} uiSettingKey
 */
export const useSetUiSettings = uiSettingKey => {
  const value = useUISettings(uiSettingKey);
  const setValue = useSetAppData({
    key1: APP_DATA.uiSettings,
    key2: uiSettingKey,
  });
  return [value, setValue];
};

export const useIsHLSStartedFromUI = () => {
  return useHMSStore(selectAppData(APP_DATA.hlsStarted));
};

export const useIsRTMPStartedFromUI = () => {
  return useHMSStore(selectAppData(APP_DATA.rtmpStarted));
};

export const useAuthToken = () => {
  return useHMSStore(selectAppData(APP_DATA.authToken));
};

export const useUrlToEmbed = () => {
  return useHMSStore(selectAppData(APP_DATA.embedConfig))?.url;
};

export const usePDFConfig = () => {
  return useHMSStore(selectAppData(APP_DATA.pdfConfig));
};

export const useResetPDFConfig = () => {
  const [, setPDFConfig] = useSetAppDataByKey(APP_DATA.pdfConfig);
  return useCallback(() => setPDFConfig(), [setPDFConfig]);
};

export const useResetEmbedConfig = () => {
  const [, setEmbedConfig] = useSetAppDataByKey(APP_DATA.embedConfig);
  return () => setEmbedConfig();
};

export const usePinnedTrack = () => {
  const pinnedTrackId = useHMSStore(selectAppData(APP_DATA.pinnedTrackId));
  return useHMSStore(selectTrackByID(pinnedTrackId));
};

export const useSpotlightPeerIds = () => useHMSStore(selectSessionStore(SESSION_STORE_KEY.SPOTLIGHT));

export const useSubscribedNotifications = notificationKey => {
  const notificationPreference = useHMSStore(selectAppDataByPath(APP_DATA.subscribedNotifications, notificationKey));
  return notificationPreference;
};

export const useIsNotificationDisabled = () => {
  const notificationPreference = useHMSStore(selectAppDataByPath(APP_DATA.disableNotifications));
  return notificationPreference;
};

export const useSetSubscribedNotifications = notificationKey => {
  const value = useSubscribedNotifications(notificationKey);
  const setValue = useSetAppData({
    key1: APP_DATA.subscribedNotifications,
    key2: notificationKey,
  });
  return [value, setValue];
};

export const useIsCaptionEnabled = () => {
  const isCaptionEnabled = useHMSStore(selectAppDataByPath(APP_DATA.caption));
  return isCaptionEnabled;
};

export const useSetIsCaptionEnabled = () => {
  const [value, setValue] = useSetAppDataByKey(APP_DATA.caption);
  return [value, setValue];
};

export const useSubscribeChatSelector = chatSelectorKey => {
  const chatSelectorPreference = useHMSStore(selectAppDataByPath(APP_DATA.chatSelector, chatSelectorKey));
  return chatSelectorPreference;
};

export const useSetSubscribedChatSelector = chatSelectorKey => {
  const value = useSubscribeChatSelector(chatSelectorKey);
  const setValue = useSetAppData({
    key1: APP_DATA.chatSelector,
    key2: chatSelectorKey,
  });
  return [value, setValue];
};

export const useSetAppDataByKey = appDataKey => {
  const value = useHMSStore(selectAppData(appDataKey));
  const actions = useHMSActions();
  const setValue = useCallback(
    value => {
      actions.setAppData(appDataKey, value);
    },
    [actions, appDataKey],
  );
  return [value, setValue];
};

const useSetAppData = ({ key1, key2 }) => {
  const actions = useHMSActions();
  const store = useHMSVanillaStore();
  const [, setPreferences] = useUserPreferences(UserPreferencesKeys.UI_SETTINGS);
  const setValue = useCallback(
    value => {
      if (!key1) {
        return;
      }
      actions.setAppData(
        key1,
        key2
          ? {
              [key2]: value,
            }
          : value,
        true,
      );
      const appData = store.getState(selectAppData());
      setPreferences({
        ...appData.uiSettings,
        [UI_SETTINGS.isAudioOnly]: undefined,
        subscribedNotifications: appData.subscribedNotifications,
      });
    },
    [actions, key1, key2, store, setPreferences],
  );
  return setValue;
};

export const useShowPolls = () => {
  const permissions = useHMSStore(selectPermissions);
  const polls = useHMSStore(selectPolls);

  const showPolls = useMemo(() => {
    return permissions?.pollWrite || (permissions?.pollRead && polls?.length > 0);
  }, [permissions?.pollRead, permissions?.pollWrite, polls?.length]);

  return { showPolls };
};

export const usePollViewState = () => {
  const [pollState, setPollState] = useSetAppDataByKey(APP_DATA.pollState);

  const setPollView = useCallback(
    view => {
      setPollState({
        [POLL_STATE.pollInView]: pollState?.pollInView,
        [POLL_STATE.view]: view,
      });
    },
    [pollState?.pollInView, setPollState],
  );

  return {
    setPollState,
    setPollView,
    pollInView: pollState?.pollInView,
    view: pollState?.view,
  };
};

export const useIsNoiseCancellationEnabled = () => {
  const isNoiseCancellationEnabled = useHMSStore(selectAppDataByPath(APP_DATA.noiseCancellation));
  return isNoiseCancellationEnabled;
};
export const useSetNoiseCancellation = () => {
  const [isNoiseCancellationEnabled, setNoiseCancellationEnabled] = useSetAppDataByKey(APP_DATA.noiseCancellation);
  return [isNoiseCancellationEnabled, setNoiseCancellationEnabled];
};
